import { useState } from 'react';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { FormField } from '../../../ui/form-field.tsx';
import { IconButton } from '../../../ui/icon-button.tsx';
import { contactLabel } from '../model/contact-order.ts';
import { contactField, removeField } from '../model/edit-form.ts';
import { KindIcon } from './kind-icon.tsx';
import styles from './supplier.module.css';

interface Props {
  item: SupplierDetail['contacts'][number];
  error: string | undefined;
  typed: Record<string, string>;
}

/**
 * One contact in the edit dialog, with a trash can beside it (Menash, 22.11.2026). The can
 * marks the detail for deletion and a second press takes it back. Nothing is deleted until
 * save, which first shows the checks of the deletion (DESIGN.md 6.2: in an edit form, those
 * results are the confirmation).
 */
export function ContactRow({ item, error, typed }: Props) {
  const [removed, setRemoved] = useState(typed[removeField(item.id)] === '1');
  const label = contactLabel(item.kind, item.value);
  const note = `${removeField(item.id)}-note`;
  return (
    // The icon sits beside the label: a phone, a mobile, an envelope (Menash, 22.11).
    <div className={styles.contactRow} data-removed={removed ? '' : undefined}>
      <KindIcon kind={item.kind} value={item.value} />
      <FormField
        field={{ label, error }}
        input={{
          name: contactField(item.id),
          ...(removed ? { 'aria-describedby': note } : {}),
          defaultValue: typed[contactField(item.id)] ?? item.value,
          maxLength: 500,
          readOnly: removed,
        }}
      />
      <IconButton
        icon="trash"
        label={`מחיקת ${label}: ${item.value}`}
        tip={removed ? 'ביטול המחיקה' : `מחיקת ${label}`}
        aria-pressed={removed}
        onClick={() => {
          setRemoved((value) => !value);
        }}
      />
      {removed && (
        <p id={note} className={styles.removedNote}>
          יימחק בשמירה. לחיצה נוספת על הפח מבטלת.
          <input type="hidden" name={removeField(item.id)} value="1" />
        </p>
      )}
    </div>
  );
}
