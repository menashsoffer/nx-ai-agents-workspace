// The circle at the end of the top bar (screens-spec-he.md 11 and 4.2): signed in, it opens the
// personal area, which holds the details, the requests and sign-out. Signed out, it signs in.
import { Link } from 'react-router';
import { getAdminSession } from '../data/rpc.ts';
import { tokenEmail } from '../data/snapshot.ts';
import { useCatalogSnapshot } from '../data/react-catalog.ts';
import { Icon } from '../ui/icon.tsx';

export function AccountMenu() {
  const access = useCatalogSnapshot()?.access;
  const token = getAdminSession()?.token;
  if (!access || !token) {
    return (
      <Link to="/auth" className="shell-account" aria-label="כניסה למערכת" title="כניסה למערכת">
        <Icon name="person" />
      </Link>
    );
  }
  const initial = tokenEmail(token)?.[0]?.toUpperCase();
  return (
    <Link to="/auth" className="shell-account" aria-label="האזור האישי" title="האזור האישי">
      {initial ?? <Icon name="person" />}
    </Link>
  );
}
