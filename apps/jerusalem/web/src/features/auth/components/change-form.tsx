import { useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { RequiredNote } from '../../../ui/field-parts.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { changeForm } from '../model/account-forms.ts';
import { ROLE_LABELS } from '../model/access-policy.ts';
import { grantLabel, KIND_LABELS } from '../../../data/access-change-labels.ts';
import { askChange, type MyGrant, type Unit } from '../api/account.ts';
import { useAccountForm, type FormState } from './use-account-form.ts';
import styles from './account.module.css';

interface Props {
  units: Unit[];
  grants: MyGrant[];
  /** Kinds that already have a pending request; one of each at a time. */
  busy: ReadonlySet<string>;
  done: () => void;
}
type Kind = 'add_role' | 'remove_role' | 'move_unit' | '';
const KINDS = ['add_role', 'remove_role', 'move_unit'] as const;

function options(entries: [string, string][], empty: string) {
  return [
    <option key="" value="">
      {empty}
    </option>,
    ...entries.map(([value, label]) => (
      <option key={value} value={value}>
        {label}
      </option>
    )),
  ];
}

interface TargetProps extends Omit<Props, 'busy' | 'done'> {
  kind: Kind;
  errors: Record<string, string>;
  typed: Record<string, string>;
}

/** A select keeps its choice through React's form reset; a new key restores the typed one. */
const keyOf = (name: string, typed: Record<string, string>) => `${name}:${typed[name] ?? ''}`;
const typedSelect = (name: string, typed: Record<string, string>) => ({
  name,
  defaultValue: typed[name] ?? '',
});

function Targets({ kind, units, grants, errors, typed }: TargetProps) {
  const names = new Map(units.map((u) => [u.id, u.name]));
  const unitList = units.map((u): [string, string] => [u.id, u.name]);
  const roleList = Object.entries(ROLE_LABELS);
  const grantList = grants.map((g): [string, string] => [g.id, grantLabel(g, names)]);
  return (
    <>
      {kind === 'add_role' && (
        <SelectField
          key={keyOf('role', typed)}
          field={{ label: 'תפקיד', error: errors.role }}
          select={{
            ...typedSelect('role', typed),
            required: true,
            children: options(roleList, 'בחירת תפקיד'),
          }}
        />
      )}
      {(kind === 'add_role' || kind === 'move_unit') && (
        <SelectField
          key={keyOf('unit_id', typed)}
          field={{
            label: kind === 'move_unit' ? 'היחידה החדשה' : 'יחידה',
            ...(kind === 'add_role' && { hint: 'לא נדרשת למנהל מערכת ולמבקר.' }),
            error: errors.unit_id,
          }}
          select={{
            ...typedSelect('unit_id', typed),
            required: kind === 'move_unit',
            children: options(unitList, 'בחירת יחידה'),
          }}
        />
      )}
      {kind === 'remove_role' && (
        <SelectField
          key={keyOf('grant_id', typed)}
          field={{ label: 'התפקיד להסרה', error: errors.grant_id }}
          select={{
            ...typedSelect('grant_id', typed),
            required: true,
            children: options(grantList, 'בחירת תפקיד'),
          }}
        />
      )}
    </>
  );
}

interface KindProps {
  state: FormState;
  free: readonly Exclude<Kind, ''>[];
  pick: (kind: Kind) => void;
}
function KindSelect({ state, free, pick }: KindProps) {
  return (
    <SelectField
      key={keyOf('kind', state.typed)}
      field={{ label: 'מה לבקש', error: state.errors.kind }}
      select={{
        ...typedSelect('kind', state.typed),
        required: true,
        onChange: (e) => {
          pick(e.currentTarget.value as Kind);
        },
        children: options(
          free.map((k) => [k, KIND_LABELS[k]]),
          'בחירה',
        ),
      }}
    />
  );
}

/** The role or unit change request (screens-spec 4.1). */
export function ChangeForm({ units, grants, busy, done }: Props) {
  const refresh = useRevalidator();
  const [kind, setKind] = useState<Kind>('');
  const [state, action, pending] = useAccountForm(changeForm, async (input) => {
    await askChange(input);
    done();
    await refresh.revalidate();
  });
  const free = KINDS.filter((k) => !busy.has(k));
  return (
    <form
      action={action}
      aria-label="בקשה לשינוי תפקיד או יחידה"
      noValidate
      className={styles.form}
    >
      <RequiredNote />
      {state.failure && (
        <Notice tone="error" title="הבקשה לא נשלחה.">
          {state.failure}
        </Notice>
      )}
      <KindSelect state={state} free={free} pick={setKind} />
      <Targets
        kind={kind}
        units={units}
        grants={grants}
        errors={state.errors}
        typed={state.typed}
      />
      <FormField
        field={{ label: 'למה', error: state.errors.reason }}
        input={{ name: 'reason', required: true, defaultValue: state.typed.reason ?? '' }}
      />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="שולח…">
          שליחת הבקשה
        </Button>
      </FormActions>
    </form>
  );
}
