// dry-run scenario 5: an unrelated commit so the finding is reviewed again on a new head.
const NOTE_HTML = '<b>הערת בדיקה</b>';

function DemoNote() {
  return <p dangerouslySetInnerHTML={{ __html: NOTE_HTML }} />;
}

export function AboutPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">אודות</h1>
      <p className="text-muted">
        דף לדוגמה שמראה ניתוב בין דפים. מחליפים אותו בתוכן של הפרויקט.
      </p>
      <DemoNote />
    </section>
  );
}
