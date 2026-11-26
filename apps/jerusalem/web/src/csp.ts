// The page's Content-Security-Policy. GitHub Pages cannot send HTTP headers, so the build puts
// it in a <meta> tag (see vite.config.mjs). A meta tag cannot carry frame-ancestors or a
// report-only mode; those need a host that sends headers.

/** Allows only this site's own files and the Supabase project the build talks to. */
export function contentSecurityPolicy(supabaseUrl: string): string {
  const api = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${api}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    // The code writes text with textContent only, so no HTML string ever reaches the DOM.
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}
