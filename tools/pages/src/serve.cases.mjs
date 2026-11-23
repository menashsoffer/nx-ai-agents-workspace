// Traversal probes: each builds a request path that tries to reach a file in
// a sibling folder whose name starts with the served root's name.
export const TRAVERSAL_PROBES = [
  ['encoded slash', (sibling, file) => `/..%2f${sibling}%2f${file}`],
  ['encoded dots', (sibling, file) => `/%2e%2e/${sibling}/${file}`],
  ['double-encoded dots', (sibling, file) => `/%252e%252e/${sibling}/${file}`],
  ['encoded backslash', (sibling, file) => `/..%5c${sibling}%5c${file}`],
  ['NUL byte', (sibling, file) => `/${sibling}/${file}%00`],
];
