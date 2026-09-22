// Thin I/O layer over the `gh` CLI (preinstalled on GitHub-hosted runners).
// Auth comes from GH_TOKEN, set per step by the workflow.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const REPO = process.env.GITHUB_REPOSITORY ?? '';
export const [OWNER, NAME] = REPO.split('/');

function gh(args, input) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

/** REST call. `path` is relative to /repos/<owner>/<repo> unless it starts with '/'. */
export function api(path, { method = 'GET', body } = {}) {
  const url = path.startsWith('/') ? path.slice(1) : `repos/${REPO}/${path}`;
  const args = [
    'api',
    '-X',
    method,
    url,
    '-H',
    'Accept: application/vnd.github+json',
  ];
  if (body !== undefined) args.push('--input', '-');
  const out = gh(args, body === undefined ? undefined : JSON.stringify(body));
  return out.trim() ? JSON.parse(out) : null;
}

/** Paginated GET returning a flat array. */
export function list(path) {
  const url = path.startsWith('/') ? path.slice(1) : `repos/${REPO}/${path}`;
  const sep = url.includes('?') ? '&' : '?';
  const out = gh(['api', '--paginate', '--slurp', `${url}${sep}per_page=100`]);
  return JSON.parse(out).flat();
}

export function graphql(query, variables = {}) {
  const out = gh(
    ['api', 'graphql', '--input', '-'],
    JSON.stringify({ query, variables }),
  );
  const res = JSON.parse(out);
  if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
  return res.data;
}

export function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  const text = String(value);
  if (!file) {
    console.log(`[output] ${name}=${text}`);
    return;
  }
  const delim = `EOF_${randomBytes(12).toString('hex')}`;
  appendFileSync(file, `${name}<<${delim}\n${text}\n${delim}\n`);
}

// ------------------------------------------------------------ helpers

export function labelsOf(number) {
  return api(`issues/${number}`).labels.map((l) => l.name);
}

export function editLabels(number, { add = [], remove = [] }) {
  for (const l of remove) {
    try {
      api(`issues/${number}/labels/${encodeURIComponent(l)}`, {
        method: 'DELETE',
      });
    } catch {
      // already gone
    }
  }
  if (add.length)
    api(`issues/${number}/labels`, { method: 'POST', body: { labels: add } });
}

export function findComment(number, marker) {
  return list(`issues/${number}/comments`).find((c) =>
    c.body?.includes(marker),
  );
}

export function upsertComment(number, marker, body) {
  const full = body.includes(marker) ? body : `${marker}\n${body}`;
  const existing = findComment(number, marker);
  if (existing)
    return api(`issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: { body: full },
    });
  return api(`issues/${number}/comments`, {
    method: 'POST',
    body: { body: full },
  });
}

const THREADS = `
query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ id isResolved comments(first:100){ nodes{ databaseId author{ login } } } }
    } } } }`;

export function reviewThreads(number) {
  const threads = [];
  let after = null;
  do {
    const page = graphql(THREADS, { owner: OWNER, name: NAME, number, after })
      .repository.pullRequest.reviewThreads;
    threads.push(
      ...page.nodes.map((t) => ({
        id: t.id,
        isResolved: t.isResolved,
        commentIds: t.comments.nodes.map((c) => c.databaseId),
        authors: t.comments.nodes.map((c) => c.author?.login),
      })),
    );
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
}

export function resolveThread(threadId) {
  graphql(
    `
      mutation ($id: ID!) {
        resolveReviewThread(input: { threadId: $id }) {
          thread {
            id
          }
        }
      }
    `,
    { id: threadId },
  );
}
