import { useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { cancelChange } from '../api/account.ts';

/** Withdraws one's own pending request. */
export function CancelChange({ id }: { id: string }) {
  const refresh = useRevalidator();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function cancel() {
    setPending(true);
    setFailed(false);
    try {
      await cancelChange(id);
      await refresh.revalidate();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button variant="quiet" pending={pending} pendingLabel="מבטל…" onClick={() => void cancel()}>
        ביטול הבקשה
      </Button>
      {failed && <span role="alert">הביטול נכשל. יש לנסות שוב.</span>}
    </>
  );
}
