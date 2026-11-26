import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { decideRequest, INITIAL_DECISION, type DecisionState } from '../api/requests.ts';
import type { CategoryRequest } from '../model/decision.ts';
import { CategoryPicker } from './category-picker.tsx';

export type DecisionKind = 'approved' | 'linked' | 'rejected';
export const DECISIONS: Record<DecisionKind, { action: string; note: string }> = {
  approved: { action: 'אישור כקטגוריה חדשה', note: 'נימוק לאישור' },
  linked: { action: 'קישור לקטגוריה קיימת', note: 'נימוק לקישור' },
  rejected: { action: 'דחייה', note: 'נימוק לדחייה' },
};
export const dialogId = (id: string, kind: DecisionKind) => `category-${kind}-${id}`;

interface Props {
  request: CategoryRequest;
  kind: DecisionKind;
  categories: { id: string; name: string }[];
}
/** What was typed, kept across a failed attempt: React resets the form after each action. */
type State = DecisionState & { attempt: number; note: string; category: string };
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

function useDecision({ request, kind }: Props) {
  return useActionState(
    async (previous: State, form: FormData): Promise<State> => {
      form.set('decision', kind);
      const done = await decideRequest(request.id, form);
      if (done.committed) {
        const dialog = document.getElementById(dialogId(request.id, kind));
        if (dialog instanceof HTMLDialogElement) dialog.close();
      }
      const typed = { note: text(form, 'note'), category: text(form, 'category_id') };
      return { ...done, ...typed, attempt: previous.attempt + 1 };
    },
    { ...INITIAL_DECISION, attempt: 0, note: '', category: '' },
  );
}

/** One decision on a category request. The table keeps a reason with every decision. */
export function DecisionDialog(props: Props) {
  const { request, kind, categories } = props;
  const [state, action, pending] = useDecision(props);
  const title = `${DECISIONS[kind].action}: ${request.proposed_name}`;
  return (
    <Dialog id={dialogId(request.id, kind)} title={title}>
      <form action={action} aria-label={title} noValidate>
        {state.error && <Notice tone="error" title={state.error} />}
        {kind === 'linked' && (
          <CategoryPicker
            key={`category-${String(state.attempt)}`}
            categories={categories}
            chosen={state.category}
            error={state.field.category_id}
          />
        )}
        <FormField
          key={`note-${String(state.attempt)}`}
          field={{
            label: DECISIONS[kind].note,
            hint: 'הנימוק נשמר עם ההחלטה.',
            error: state.field.note,
          }}
          input={{ name: 'note', required: true, maxLength: 2000, defaultValue: state.note }}
        />
        <FormActions>
          <Button type="submit" pending={pending}>
            {DECISIONS[kind].action}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
