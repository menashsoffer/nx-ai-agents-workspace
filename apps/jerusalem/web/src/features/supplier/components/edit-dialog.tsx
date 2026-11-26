import { useState } from 'react';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { EditForm } from './edit-form.tsx';
import { StatusPanel } from './status-panel.tsx';
import styles from './supplier.module.css';

export const EDIT_DIALOG = 'supplier-edit-dialog';

interface Props {
  data: SupplierDetail;
  editor: boolean;
  admin: boolean;
  today: string;
}

/**
 * Spec section 4.5: one save for the details. The administrator's status action sits apart,
 * under a line and as a quiet link, so it is not pressed instead of save (Menash, 25.11.2026).
 * The dialog closes with the X, Escape or a click outside it.
 */
export function EditDialog({ data, editor, admin, today }: Props) {
  const [confirming, setConfirming] = useState(false);
  const inactive = data.supplier.status === 'inactive';
  const statusButton = admin && (
    <Button
      variant="quiet"
      className={inactive ? '' : (styles.dangerQuiet ?? '')}
      aria-expanded={confirming}
      onClick={() => {
        setConfirming(true);
      }}
    >
      {inactive ? 'סימון כפעיל' : 'סימון כלא פעיל'}
    </Button>
  );
  return (
    <Dialog
      id={EDIT_DIALOG}
      title="עריכת פרטי הספק"
      onClose={() => {
        setConfirming(false);
      }}
    >
      {editor && <EditForm data={data} admin={admin} />}
      {statusButton && <div className={styles.statusZone}>{statusButton}</div>}
      {admin && confirming && (
        <StatusPanel
          data={data}
          today={today}
          cancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </Dialog>
  );
}
