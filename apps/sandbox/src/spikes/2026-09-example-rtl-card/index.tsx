import { Button } from '@starter/ui';
export default function ExampleRtlCard() {
  return (
    <article className="max-w-sm space-y-3 rounded-xl border border-brand-100 p-5 shadow-sm">
      <h2 className="text-xl font-semibold">סדנה לדוגמה</h2>
      <p className="text-muted">
        טקסט בעברית עם English words ומספרים 2026 כדי לבדוק כיווניות.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary">ביטול</Button>
        <Button>הרשמה</Button>
      </div>
    </article>
  );
}
