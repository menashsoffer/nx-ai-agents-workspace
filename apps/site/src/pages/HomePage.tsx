import { Button } from '@starter/ui';

export function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">
        <bdi dir="ltr" lang="en">
          NX AI Pipeline
        </bdi>
      </h1>
      <p className="text-muted">
        זהו דף הבית של האתר. מחליפים את התוכן הזה בתוכן של הפרויקט.
      </p>
      <Button>התחילו כאן</Button>
    </section>
  );
}
