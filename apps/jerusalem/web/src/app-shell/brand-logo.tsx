/**
 * The product logo: the "שווה לעבוד בירושלים" shield with the city skyline (DESIGN.md 6.1).
 * The file sits in web/public; the site uses a hash router, so the relative path always resolves
 * against the site root. Width and height are the file's own, so the header never shifts.
 */
export function BrandLogo() {
  return (
    <img
      className="shell-logo"
      src="brand/logo.png"
      alt="שווה לעבוד בירושלים"
      width={431}
      height={200}
      decoding="async"
    />
  );
}
