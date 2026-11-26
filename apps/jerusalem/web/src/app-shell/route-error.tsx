import { useErrorReport } from './use-error-report.ts';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '../ui/button.tsx';

const NOT_FOUND = 404;

/** Shown instead of a screen that failed, so one broken screen never takes down the page. */
export function RouteError() {
  const error = useRouteError();
  useErrorReport(error, 'root');
  const missing = isRouteErrorResponse(error) && error.status === NOT_FOUND;
  return (
    <main className="shell-main">
      <section className="notice" role="alert">
        <h1 tabIndex={-1}>{missing ? 'הדף לא נמצא' : 'משהו השתבש'}</h1>
        <p>
          {missing
            ? 'הכתובת לא קיימת באתר. אולי הקישור ישן.'
            : 'לא הצלחנו להציג את המסך. נסו לטעון אותו מחדש.'}
        </p>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => {
            window.location.reload();
          }}
        >
          טעינה מחדש
        </Button>
      </section>
    </main>
  );
}
