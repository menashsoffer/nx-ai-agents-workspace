// pipeline-lib/patches: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import { createHash } from 'node:crypto';
import {
  APPROVABLE_PATH_PATTERNS,
  FORBIDDEN_PATH_PATTERNS,
} from './constants.mjs';

// ---------------------------------------------------------------- patches

const C_ESCAPES = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
};

/**
 * Decodes a git C-quoted path (`"a/\327\251 x.md"`, as git writes names
 * with non-ASCII bytes, quotes, backslashes or control characters).
 * Returns null if `text` is not exactly one well-formed quoted string.
 */
export function unquoteCPath(text) {
  const s = String(text);
  if (s.length < 2 || s[0] !== '"' || s.at(-1) !== '"') return null;
  const chars = [...s.slice(1, -1)]; // code points, not UTF-16 units
  const bytes = [];
  const utf8 = new TextEncoder();
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '"') return null;
    if (ch !== '\\') {
      bytes.push(...utf8.encode(ch));
      continue;
    }
    const next = chars[++i];
    if (next === undefined) return null;
    if (/[0-7]/.test(next)) {
      const oct = chars.slice(i, i + 3).join('');
      if (!/^[0-3][0-7]{2}$/.test(oct)) return null;
      bytes.push(parseInt(oct, 8));
      i += 2;
    } else if (next in C_ESCAPES) bytes.push(C_ESCAPES[next]);
    else return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    return null;
  }
}

/** A path token: C-quoted, or taken verbatim. */
const pathToken = (t) => (t.startsWith('"') ? unquoteCPath(t) : t);

/** Repo-relative path, or null if it could escape the repo or is empty. */
export function normalizePath(p) {
  if (p === null || p === '' || p.startsWith('/') || p.includes('\0'))
    return null;
  const parts = p.split('/').filter((x) => x !== '' && x !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

/**
 * Splits the `a/<old> b/<new>` part of a `diff --git` header. Either side
 * may be C-quoted; unquoted names may contain spaces, so every split point
 * is tried. Returns [old, new], or null when the header is ambiguous or
 * malformed.
 */
function splitGitHeader(rest) {
  const candidates = [];
  for (let i = rest.indexOf(' '); i !== -1; i = rest.indexOf(' ', i + 1)) {
    const a = pathToken(rest.slice(0, i));
    const b = pathToken(rest.slice(i + 1));
    if (a?.startsWith('a/') && b?.startsWith('b/'))
      candidates.push([a.slice(2), b.slice(2)]);
  }
  if (candidates.length === 1) return candidates[0];
  const same = candidates.filter(([a, b]) => a === b);
  return same.length === 1 ? same[0] : null;
}

/**
 * Paths touched by a `git format-patch` / `git diff` output, from every
 * header git apply reads: `diff --git`, `rename/copy from/to` and
 * `---`/`+++` (any line that looks like one, even inside a hunk or a commit
 * message, so the scan over-collects rather than misses). Handles C-quoted
 * names. Returns `{ paths, errors }`; any unparseable header is an error,
 * and callers must reject the patch (fail closed).
 */
export function patchPaths(patch) {
  const paths = new Set();
  const errors = [];
  const add = (raw, line) => {
    const p = normalizePath(raw);
    if (p === null) errors.push(`unparseable path in: ${line.slice(0, 200)}`);
    else paths.add(p);
  };
  let headers = 0;
  for (const rawLine of String(patch).split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    let m;
    if (line.startsWith('diff --git')) {
      headers++;
      const pair = line.startsWith('diff --git ')
        ? splitGitHeader(line.slice('diff --git '.length))
        : null;
      if (!pair) {
        errors.push(`unparseable header: ${line.slice(0, 200)}`);
        continue;
      }
      add(pair[0], line);
      add(pair[1], line);
    } else if ((m = /^(?:rename|copy) (?:from|to) (.*)$/.exec(line))) {
      add(pathToken(m[1]), line);
    } else if ((m = /^(?:---|\+\+\+) (.*)$/.exec(line))) {
      let v = m[1];
      if (!v.startsWith('"')) v = v.replace(/\t.*$/, '');
      v = pathToken(v);
      if (v === '/dev/null') continue;
      // git apply strips one leading component (-p1): `a/x` -> `x`.
      if (v !== null) v = v.includes('/') ? v.slice(v.indexOf('/') + 1) : v;
      add(v, line);
    }
  }
  if (String(patch).trim() && headers === 0)
    errors.push('no `diff --git` header found');
  return { paths: [...paths], errors };
}

const matches = (patterns, p) => patterns.some((re) => re.test(p));

/**
 * Splits `paths` into the protected ones: `approvable` (the owner can
 * approve them, see APPROVABLE_PATH_PATTERNS) and `never` (only a local
 * session may change them). Both lists are sorted and deduplicated, and
 * `protected` is their union. With `foldCase` a path is also tested in
 * lower case (planned paths: case-insensitive filesystems make `.GITHUB/`
 * the same directory); it is `never` if either spelling is never approvable.
 */
export function classifyProtectedPaths(paths, { foldCase = false } = {}) {
  const never = new Set();
  const approvable = new Set();
  for (const p of paths) {
    const spellings = foldCase ? [p, p.toLowerCase()] : [p];
    if (!spellings.some((x) => matches(FORBIDDEN_PATH_PATTERNS, x))) continue;
    const isNever = spellings.some(
      (x) =>
        matches(FORBIDDEN_PATH_PATTERNS, x) &&
        !matches(APPROVABLE_PATH_PATTERNS, x),
    );
    (isNever ? never : approvable).add(p);
  }
  const sort = (set) => [...set].sort();
  return {
    approvable: sort(approvable),
    never: sort(never),
    protected: sort(new Set([...approvable, ...never])),
  };
}

/** check-patch: rejects forbidden paths and anything it cannot parse. */
export function checkPatch(patch) {
  const { paths, errors } = patchPaths(patch);
  const forbidden = forbiddenPaths(paths);
  return {
    ok: errors.length === 0 && forbidden.length === 0,
    forbidden,
    errors,
  };
}

/**
 * check-patch with the approvable subset told apart. `kind` is
 * - `none`: no protected path;
 * - `approvable`: protected paths, all of them approvable (APPROVABLE_PATH_PATTERNS);
 * - `forbidden`: a never-approvable path, or a header that cannot be
 *   parsed (fail closed).
 * Only develop.yml accepts `approvable`, and only to ask the owner first.
 */
export function classifyPatch(patch) {
  const { paths, errors } = patchPaths(patch);
  const cls = classifyProtectedPaths(paths);
  const kind =
    errors.length || cls.never.length
      ? 'forbidden'
      : cls.approvable.length
        ? 'approvable'
        : 'none';
  return {
    kind,
    protected: cls.protected,
    approvable: cls.approvable,
    never: cls.never,
    errors,
  };
}

export function forbiddenPaths(paths) {
  return paths.filter((p) => matches(FORBIDDEN_PATH_PATTERNS, p));
}

/** sha256 of the sorted, deduplicated path list: the approval's path binding. */
export const pathSetHash = (paths) =>
  createHash('sha256')
    .update([...new Set(paths)].sort().join('\n'))
    .digest('hex');

/**
 * Changed paths from a GitHub compare response's `files`: every filename,
 * plus the previous name of a rename. The compare API lists at most 300
 * files; a list that long may be cut off, so `complete` is false and
 * callers must not trust it (fail closed).
 */
export const COMPARE_FILE_LIMIT = 300;

export function comparePaths(files) {
  const list = Array.isArray(files) ? files : [];
  const paths = new Set();
  for (const f of list) {
    for (const raw of [f?.filename, f?.previous_filename]) {
      if (raw === undefined || raw === null) continue;
      const p = normalizePath(String(raw));
      if (p === null) return { paths: [], complete: false };
      paths.add(p);
    }
  }
  return {
    paths: [...paths].sort(),
    complete: list.length < COMPARE_FILE_LIMIT,
  };
}
