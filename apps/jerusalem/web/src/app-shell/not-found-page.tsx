import { Link, useNavigate } from 'react-router';
import { Button } from '../ui/button.tsx';
import controls from '../ui/control.module.css';

/** screens-spec-he.md 12: for every user, not only admins. */
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <section className="shell-notice">
      <h1 tabIndex={-1}>הדף לא נמצא</h1>
      <p>הכתובת לא קיימת באתר. אולי הקישור ישן.</p>
      <div className="shell-notice-actions">
        <Link to="/catalog" className={controls.button}>
          לאיתור ספקים
        </Link>
        <Button
          variant="quiet"
          onClick={() => {
            void navigate(-1);
          }}
        >
          חזרה
        </Button>
      </div>
    </section>
  );
}
