import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">הדף לא נמצא</h1>
      <Link to="/" className="text-brand-600 underline">
        חזרה לדף הבית
      </Link>
    </section>
  );
}
