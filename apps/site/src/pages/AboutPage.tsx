// dry-run scenario 5: an unrelated commit so the finding is reviewed again on a new head.
function DemoNote() {
  return (
    <p>
      <b>הערת בדיקה</b>
    </p>
  );
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
