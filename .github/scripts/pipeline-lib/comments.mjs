// comments: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { sameLogin } from './naming.mjs';
import { MARKERS } from './constants.mjs';

// ---------------------------------------------------------------- comments

/**
 * The comment carrying `marker`, written by `author` (the pipeline bot).
 * Anyone can post a comment containing a marker on a public repo, so
 * markers from other authors are never trusted.
 */
export function findMarkerComment(comments, marker, author) {
  if (!author) throw new Error('findMarkerComment needs an author');
  return comments.find(
    (c) => sameLogin(c.user?.login, author) && c.body?.includes(marker),
  );
}

/** Makes `<!-- pipeline... -->` markers in untrusted text inert. */
export const neutraliseMarkers = (text) =>
  String(text ?? '').replace(/<!--(\s*pipeline)/gi, '&lt;!--$1');

/**
 * Issue data for the plan/develop agents. The spec and plan come only from
 * the pipeline bot's own marker comments (the latest of each; a
 * maintainer's edit keeps the bot as author). Every other comment is
 * discussion, with any pipeline markers in it neutralised.
 */
export function issueForAgents({ issue, comments, botLogin }) {
  const fromBot = (marker) =>
    comments
      .filter(
        (c) => sameLogin(c.user?.login, botLogin) && c.body?.includes(marker),
      )
      .at(-1)?.body ?? null;
  const spec = botLogin ? fromBot(MARKERS.spec) : null;
  const plan = botLogin ? fromBot(MARKERS.plan) : null;
  return {
    number: issue.number,
    title: issue.title,
    body: neutraliseMarkers(issue.body),
    author: issue.user?.login,
    labels: (issue.labels ?? []).map((l) =>
      typeof l === 'string' ? l : l.name,
    ),
    spec,
    plan,
    comments: comments
      .filter(
        (c) =>
          !(
            sameLogin(c.user?.login, botLogin) && [spec, plan].includes(c.body)
          ),
      )
      .map((c) => ({
        author: c.user?.login,
        author_association: c.author_association,
        created_at: c.created_at,
        body: sameLogin(c.user?.login, botLogin)
          ? c.body
          : neutraliseMarkers(c.body),
      })),
  };
}
