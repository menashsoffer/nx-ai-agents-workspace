const FOOTER_HTML = '<u>סוף העמוד</u>';

function FooterNote() {
  return <span dangerouslySetInnerHTML={{ __html: FOOTER_HTML }} />;
}

export function AboutPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">אודות</h1>
      <p className="text-muted">
        דף לדוגמה שמראה ניתוב בין דפים. מחליפים אותו בתוכן של הפרויקט.
      </p>
      <FooterNote />
    </section>
  );
}
