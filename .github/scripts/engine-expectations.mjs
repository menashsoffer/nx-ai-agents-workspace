// The task's expected result, for the `exact-content` check: fenced blocks
// in the issue body whose info string is `expected <path>`, e.g.
//
//   ```expected SANDBOX_PROBE.md
//   # Sandbox probe
//
//   Hello.
//   ```
//
// The block holds the whole file after the change (it ends with a newline).
// The issue is untrusted data: these blocks are only compared with the
// result, never followed as instructions. The check job reads the issue
// from the GitHub API itself, not from the agent's runner.
//
// Pure: no I/O.
import { isPathPattern } from './engine-policy.mjs';

const OPENING = /^(`{3,})expected[ \t]+(\S+)[ \t]*$/;

/** `{ expectations: [{ path, content }], problems }` from an issue body. */
export function parseExpectations(body) {
  const lines = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const expectations = [];
  const problems = [];
  for (let index = 0; index < lines.length; index++) {
    const opening = OPENING.exec(lines[index]);
    if (!opening) continue;
    const [, fence, path] = opening;
    const closing = lines.findIndex(
      (line, later) => later > index && line === fence,
    );
    if (closing === -1) {
      problems.push(`the expected block for ${path} is not closed`);
      break;
    }
    if (!isPathPattern(path) || path.includes('*'))
      problems.push(`not a repository file path: ${path}`);
    else if (expectations.some((expectation) => expectation.path === path))
      problems.push(`${path} is expected twice`);
    else
      expectations.push({
        path,
        content: `${lines.slice(index + 1, closing).join('\n')}\n`,
      });
    index = closing;
  }
  return { expectations, problems };
}
