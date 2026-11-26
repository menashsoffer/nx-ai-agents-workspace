import { Link, useLocation, useNavigate } from 'react-router';
import { Button, buttonClass } from '../../../ui/button.tsx';
import { Icon } from '../../../ui/icon.tsx';

/** Set by the catalog card's link, so the back button knows a search page is behind it. */
export interface FromCatalog {
  fromCatalog: true;
}
export function cameFromCatalog(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromCatalog' in state;
}

/**
 * Spec section 3. After a search, going back returns to the same history entry, where the
 * catalog restores its query and filters. Opened from a direct link, it goes to the catalog.
 */
export function BackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  if (!cameFromCatalog(location.state)) {
    return (
      <Link to="/catalog" className={buttonClass('secondary')}>
        <Icon name="back" />
        לאיתור ספקים
      </Link>
    );
  }
  return (
    <Button
      variant="secondary"
      icon="back"
      onClick={() => {
        void navigate(-1);
      }}
    >
      חזרה לתוצאות החיפוש
    </Button>
  );
}
