// Traversal probes that must never resolve to the sibling file's content.
// Each path is relative to the base path, built against a fixture root whose
// sibling folder's name starts with the root's own name.
export const TRAVERSAL_PROBE_CASES = [
  ['sibling-prefix, encoded slash', '..%2f<sibling>%2f<file>'],
  ['literal dot-dot segment', '%2e%2e/<sibling>/<file>'],
  ['double-encoded dot-dot segment', '%252e%252e/<sibling>/<file>'],
  ['encoded backslash', '..%5c<sibling>%5c<file>'],
  ['embedded NUL byte', '%00<sibling>/<file>'],
];
