// Path-traversal probes that must never resolve to a sibling directory
// whose name starts with the served root's own directory name. Each probe
// builds a request path suffix from a sibling directory name and a file
// name inside it; `createPagesServer` must answer with 400 or 404, never
// with that sibling file's content.
export const TRAVERSAL_PROBES = [
  {
    name: 'encoded parent reference and slashes (..%2f)',
    buildPath: (siblingName, fileName) => `..%2f${siblingName}%2f${fileName}`,
  },
  {
    name: 'percent-encoded dots (%2e%2e/)',
    buildPath: (siblingName, fileName) => `%2e%2e/${siblingName}/${fileName}`,
  },
  {
    name: 'double percent-encoded dots (%252e%252e/)',
    buildPath: (siblingName, fileName) =>
      `%252e%252e/${siblingName}/${fileName}`,
  },
  {
    name: 'encoded backslash parent reference (..%5c)',
    buildPath: (siblingName, fileName) => `..%5c${siblingName}%5c${fileName}`,
  },
  {
    name: 'embedded NUL byte (%00)',
    buildPath: (siblingName, fileName) => `${siblingName}/${fileName}%00`,
  },
];
