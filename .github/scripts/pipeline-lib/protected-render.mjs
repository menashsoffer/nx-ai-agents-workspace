// protected-render: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import {
  APPROVE_COMMAND,
  COMMENT_LIMIT,
  HEAD_PREFIX_LENGTH,
  PROTECTED_MIN_REASON,
  PR_BODY_LIMIT,
  REJECT_COMMAND,
  htmlText,
  jsonLine,
  lockLast,
  parseProtectedCommand,
  protectedOfCompare,
} from './protected-approval.mjs';
import { neutraliseMarkers } from './comments.mjs';
import { MARKERS } from './constants.mjs';
import { clean } from './outcomes.mjs';
import { checkDispositionAuthor, fenceFor } from './dispositions.mjs';

/**
 * The approval request the bot posts on the issue for one pushed head:
 * the protected paths with their full diffs (`<details>`, cut only when the
 * comment would pass GitHub's size limit, with a link to `compareUrl`), a
 * summary of the other files, the two commands, and the proposed PR title
 * and body (a trailing json block, read back by parseProtectedRequest).
 * Throws if the change touches a never-approvable path: such a branch
 * must not be offered for approval.
 */
export function renderProtectedRequest({
  head,
  branch,
  compareUrl,
  files,
  title = '',
  body = '',
  maxChars = COMMENT_LIMIT,
}) {
  const changed = protectedOfCompare(files);
  if (!changed.complete) throw new Error('the changed-file list is incomplete');
  if (changed.never.length)
    throw new Error(
      `never-approvable paths: ${changed.never.join(', ')} (not offered)`,
    );
  if (!changed.protected.length) throw new Error('no protected paths');
  const isProtected = (f) =>
    changed.protected.includes(f.filename) ||
    changed.protected.includes(f.previous_filename);
  const protectedFiles = files.filter(isProtected).sort(lockLast);
  const others = files.filter((f) => !isProtected(f));
  const stat = (f) => `+${f.additions ?? 0} −${f.deletions ?? 0}`;
  const code = (p) => `\`${neutraliseMarkers(p).replace(/`/g, '')}\``;
  const head12 = head.slice(0, HEAD_PREFIX_LENGTH);
  const OTHER_LIST_MAX = 40;

  const top = [
    `${MARKERS.protectedApproval} head=${head} paths=${changed.hash} -->`,
    '### Owner approval needed: protected changes',
    `The pipeline pushed ${code(branch)} at \`${head.slice(0, 7)}\` and **did not open a pull request**, because the change touches protected files. Nothing has run on this code yet. Read the diff below, then reply with exactly one of these commands, and nothing else in the comment:`,
    [
      `- Approve: \`${APPROVE_COMMAND} ${head12}\``,
      `- Reject: \`${REJECT_COMMAND} <reason, ${PROTECTED_MIN_REASON}+ characters>\``,
    ].join('\n'),
    'Only the pipeline owner counts, and only for this exact commit and path set. Any later push to the branch makes this request stale.',
    [
      `**Protected paths (${changed.protected.length}):**`,
      ...changed.protected.map((p) => `- ${code(p)}`),
    ].join('\n'),
    others.length
      ? [
          `**Other changed files (${others.length}):**`,
          ...others
            .slice(0, OTHER_LIST_MAX)
            .map((f) => `- ${code(f.filename)} ${stat(f)}`),
          ...(others.length > OTHER_LIST_MAX
            ? [`- … and ${others.length - OTHER_LIST_MAX} more`]
            : []),
        ].join('\n')
      : '',
    '#### Diff of the protected files',
  ]
    .filter(Boolean)
    .join('\n\n');

  const tail = [
    `Full branch diff: ${compareUrl}`,
    '```json',
    jsonLine({
      v: 1,
      title: clean(title, 100),
      body: neutraliseMarkers(String(body ?? '')).slice(0, PR_BODY_LIMIT),
    }),
    '```',
  ].join('\n');

  const section = (f, patch, note = '') => {
    const summary = `<summary><code>${htmlText(neutraliseMarkers(f.filename))}</code> ${stat(f)}${f.previous_filename ? ` (renamed from <code>${htmlText(neutraliseMarkers(f.previous_filename))}</code>)` : ''}</summary>`;
    const fence = fenceFor(patch);
    return [
      `<details>${summary}`,
      '',
      patch ? `${fence}diff\n${patch}\n${fence}` : '',
      note,
      '</details>',
    ]
      .filter((x) => x !== '')
      .join('\n');
  };

  let budget = maxChars - top.length - tail.length - 4 * (files.length + 2);
  const parts = [];
  let cut = false;
  for (const f of protectedFiles) {
    const patch = typeof f.patch === 'string' ? f.patch : '';
    if (!patch) {
      parts.push(
        section(
          f,
          '',
          `_The API returned no diff for this file (binary or very large). See the full branch diff below._`,
        ),
      );
      continue;
    }
    const whole = section(f, patch);
    if (!cut && whole.length <= budget) {
      parts.push(whole);
      budget -= whole.length;
      continue;
    }
    const note =
      '_Truncated: the diff does not fit in one comment. See the full branch diff below._';
    const room = budget - section(f, '', note).length - 40;
    cut = true;
    if (room > 500) {
      const kept = patch.slice(0, room).replace(/\n[^\n]*$/, '');
      parts.push(section(f, kept, note));
      budget = 0;
    } else parts.push(section(f, '', `${note} (not shown)`));
  }
  return [top, ...parts, tail].join('\n\n');
}

/**
 * What to do with a comment on an issue that might be an approval command.
 * Pure. Returns `{ action }`:
 * - `ignore`: not for us (no owner configured, not a command, a bot);
 * - `reply` + `reason`: a command that cannot be honoured; nothing changes;
 * - `reject` + `reason`;
 * - `approve` + `head`, `paths` (hash), `protectedPaths`.
 * Checks, in order: commenter (owner, a User), one exact command, the
 * comment was not edited, issue open and in stage:awaiting-approval, a
 * request exists, and for approve: the SHA prefix is the latest request's
 * head, some `issue-<n>-` branch still points at that head, the protected
 * path set recomputed from `main...head` hashes to the request's `paths=`,
 * and every recomputed protected path is still approvable.
 *
 * `request` is latestProtectedRequest; `branchHeads` the heads of the
 * issue's branches; `changed` is protectedOfCompare of `main...<request head>`.
 */
export function decideProtectedCommand({
  comment,
  ownerLogin,
  edited = false,
  issue,
  request,
  branchHeads = [],
  changed = null,
}) {
  const reply = (reason) => ({ action: 'reply', reason });
  if (!ownerLogin) return { action: 'ignore', reason: 'no owner configured' };
  const parsed = parseProtectedCommand(comment?.body);
  if (parsed.ignore)
    return { action: 'ignore', reason: 'not an approval command' };
  const author = checkDispositionAuthor({
    login: comment?.login,
    type: comment?.type,
    ownerLogin,
  });
  if (!author.ok) {
    return comment?.type === 'User'
      ? reply(author.reason)
      : { action: 'ignore', reason: author.reason };
  }
  if (!parsed.ok) return reply(parsed.error);
  if (edited)
    return reply('the comment was edited after it was posted; post it again');
  if (issue?.isPullRequest)
    return reply('this is a pull request, not an issue');
  if (issue?.state !== 'open') return reply('the issue is closed');
  if (!issue?.labels?.includes('stage:awaiting-approval'))
    return reply('the issue is not awaiting approval');
  if (!request) return reply('there is no approval request to answer');
  if (parsed.kind === 'reject')
    return { action: 'reject', reason: parsed.reason, head: request.head };
  if (!request.head.startsWith(parsed.prefix))
    return reply(
      `that commit is stale (the latest request is for \`${request.head.slice(0, HEAD_PREFIX_LENGTH)}\`)`,
    );
  if (!branchHeads.includes(request.head))
    return reply(
      'the branch no longer points at the requested commit (it moved or was deleted)',
    );
  if (!changed?.complete)
    return reply('the changed files cannot be listed completely');
  if (changed.hash !== request.paths)
    return reply('the set of protected paths changed since the request');
  if (changed.never.length)
    return reply(
      `these paths can no longer be approved: ${changed.never.join(', ')}`,
    );
  return {
    action: 'approve',
    head: request.head,
    paths: request.paths,
    protectedPaths: changed.protected,
  };
}

/** The PR body of a PR opened after an approval. */
export function renderApprovedPrBody({
  body,
  issue,
  protectedPaths,
  head,
  by,
  promptVer = 'develop.md@unknown',
}) {
  return [
    neutraliseMarkers(String(body ?? '')).slice(0, PR_BODY_LIMIT),
    `Closes #${issue}`,
    [
      '### Protected changes approved by the owner',
      `@${by} approved these paths at \`${String(head).slice(0, 7)}\` before this PR was opened:`,
      ...protectedPaths.map(
        (p) => `- \`${neutraliseMarkers(p).replace(/`/g, '')}\``,
      ),
    ].join('\n'),
    `<sub>Implemented by Claude with prompt ${promptVer}. Draft until the review gates pass. Only a human can approve and merge.</sub>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
