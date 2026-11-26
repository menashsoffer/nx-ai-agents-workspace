import { GoogleLogin } from '../features/auth/components/google-login.tsx';
import { LoginForm } from '../features/auth/components/login-form.tsx';
import styles from '../features/auth/components/auth.module.css';

/** Sign-in for suppliers (spec 6.1): the staff card with words for suppliers. */
export function SupplierAreaLogin() {
  return (
    <section className={styles.card}>
      <span className={styles.dots} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <h1 tabIndex={-1}>האזור האישי לספקי עיריית ירושלים</h1>
      <p className={styles.lead}>אפשר להיכנס עם הדוא״ל שרשום אצלנו לספק, ואז הכניסה מיידית.</p>
      <GoogleLogin />
      <p className={styles.divider}>או בקישור לדוא״ל</p>
      <LoginForm />
    </section>
  );
}
