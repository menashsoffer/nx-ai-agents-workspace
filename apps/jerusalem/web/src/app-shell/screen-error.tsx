import { useErrorReport } from './use-error-report.ts';
import {
  Link,
  Navigate,
  isRouteErrorResponse,
  useLocation,
  useRouteError,
  useRevalidator,
} from 'react-router';
import { getAdminSession } from '../data/rpc.ts';
import { getAccess } from '../data/site.ts';
import { signInPath } from './session-watch.ts';
import { audienceOf, mainRole } from './screens.ts';
import { DataError } from '../data/client.ts';
import { describeError } from '../data/errors.ts';
import { Button } from '../ui/button.tsx';
import controls from '../ui/control.module.css';

function CatalogLink({ quiet = false }: { quiet?: boolean }) {
  return (
    <Link to="/catalog" className={quiet ? controls.quiet : controls.button}>
      לאיתור ספקים
    </Link>
  );
}

/** screens-spec-he.md 12: says who the screen is for and what the user's role is. */
function Forbidden({ pathname }: { pathname: string }) {
  const audience = audienceOf(pathname);
  const role = mainRole(getAccess());
  return (
    <section role="alert" className="shell-notice">
      <h1 tabIndex={-1}>אין לך הרשאה למסך הזה</h1>
      <p>
        {audience ? `המסך מיועד ל${audience}.` : 'המסך זמין רק למשתמשים עם תפקיד מתאים.'}
        {role && ` התפקיד שלך: ${role}.`}
      </p>
      <CatalogLink />
    </section>
  );
}

export function ScreenError() {
  const error = useRouteError();
  useErrorReport(error, 'route');
  const location = useLocation();
  const status = error instanceof DataError || isRouteErrorResponse(error) ? error.status : 0;
  // Signed out or never signed in: show the sign-in screen, never an empty page.
  if (status === 401 && !getAdminSession()) return <Navigate to={signInPath(location)} replace />;
  if (status === 403) return <Forbidden pathname={location.pathname} />;
  return <Failed renewed={status === 401} error={error} />;
}

/** Any other failure says why it failed; "נסו שוב" only where trying again can help. */
function Failed({ renewed, error }: { renewed: boolean; error: unknown }) {
  const revalidator = useRevalidator();
  const failure = describeError(error);
  const retry = renewed || failure.retry;
  return (
    <section role="alert" className="shell-notice">
      <h1 tabIndex={-1}>{renewed ? 'החיבור חודש' : 'לא ניתן להציג את המסך'}</h1>
      <p>{renewed ? 'יש לנסות שוב כדי לטעון את המסך.' : failure.text}</p>
      <div className="shell-notice-actions">
        {retry && (
          <Button
            onClick={() => {
              void revalidator.revalidate();
            }}
          >
            נסו שוב
          </Button>
        )}
        <CatalogLink quiet={retry} />
      </div>
    </section>
  );
}
