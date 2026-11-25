// commands-owner: split from pipeline-pre.mjs (pure move).
import {
  checkDispositionAuthor,
  parseDispositionComment,
  classifyThreads,
  threadOfComment,
  MARKERS,
  validateDispositions,
  renderDispositionNote,
  isPipelinePr,
  issueFromBranch,
  decideRestart,
  applyLabels,
  decideRestartHint,
  renderRestartHint,
} from '../pipeline-lib.mjs';
import {
  reviewThreads,
  api,
  postComment,
  OWNER,
  NAME,
  resolveThread,
  list,
  editLabels,
} from '../github.mjs';
import {
  botLogin,
  num,
  ownerLogin,
  readState,
  runUrl,
  say,
  writeState,
} from './helpers.mjs';

export const ownerCommands = {
  // /disposition from the pipeline owner (disposition.yml): a top-level PR
  // comment or quote reply (issue_comment created) or a reply inside a
  // finding's review thread (pull_request_review_comment created,
  // COMMENT_KIND=review). The comment arrives through the environment, as
  // data: COMMENT_BODY, COMMENT_USER, COMMENT_USER_TYPE. Invalid commands get
  // one short reply, in the thread for a thread reply. Valid ones resolve the
  // findings' review threads first and then append one record note per
  // finding to the PR conversation; the notes trigger approval.yml, which
  // re-evaluates the gates.
  disposition([pr, commentId]) {
    const n = num(pr);
    const cid = num(commentId);
    const inThread = process.env.COMMENT_KIND === 'review';
    const owner = ownerLogin();
    if (!owner) throw new Error('PIPELINE_OWNER_LOGIN is not set');
    const author = checkDispositionAuthor({
      login: process.env.COMMENT_USER,
      type: process.env.COMMENT_USER_TYPE,
      ownerLogin: owner,
    });
    if (!author.ok) {
      console.log(`disposition: ignored (${author.reason})`);
      return;
    }
    let parsed = parseDispositionComment(process.env.COMMENT_BODY);
    if (parsed.ignore) {
      console.log('disposition: not a command');
      return;
    }
    let threads = null;
    // Where the answer goes: the thread for a thread reply, else the PR.
    let replyTo = null;
    if (inThread) {
      threads = classifyThreads(reviewThreads(n), { botLogin: botLogin() });
      const c = api(`pulls/comments/${cid}`);
      const entry = threadOfComment(threads, {
        commentId: cid,
        inReplyTo: c.in_reply_to_id,
      });
      replyTo = entry?.thread.first?.id ?? c.in_reply_to_id ?? cid;
      parsed = parseDispositionComment(process.env.COMMENT_BODY, {
        thread: { id: entry?.id ?? null },
      });
    }
    const tell = (text) => {
      if (!inThread) return postComment(n, text);
      try {
        return api(`pulls/${n}/comments/${replyTo}/replies`, {
          method: 'POST',
          body: { body: `${MARKERS.dispositionReply}\n${text}` },
        });
      } catch (e) {
        console.error(e.stack ?? e);
        return postComment(n, text);
      }
    };
    const reject = (why) => {
      console.log(`disposition: rejected (${why})`);
      tell(`Not recorded: ${why}.`);
    };
    if (!parsed.ok) return reject(parsed.error);
    const p = api(`pulls/${n}`);
    if (p.state !== 'open' || p.head.repo?.full_name !== `${OWNER}/${NAME}`)
      return reject('the pull request is closed or from a fork');
    const head = p.head.sha;
    threads ??= classifyThreads(reviewThreads(n), { botLogin: botLogin() });
    const checked = validateDispositions({
      commands: parsed.commands,
      findingIds: new Set(
        threads.filter((t) => t.id && !t.thread.isResolved).map((t) => t.id),
      ),
    });
    if (!checked.ok) return reject(checked.error);

    // Validation passed: a failure from here on must not leave the owner
    // without any reply. Tell them once, then fail the job.
    let noteUrl = null;
    try {
      // Resolve first: the record notes are what re-run the gates.
      for (const { id } of parsed.commands)
        for (const t of threads.filter(
          (t) => t.id === id && !t.thread.isResolved,
        ))
          resolveThread(t.thread.id);
      for (const c of parsed.commands) {
        const note = postComment(
          n,
          renderDispositionNote({
            ...c,
            head,
            by: process.env.COMMENT_USER,
            commentId: cid,
          }),
        );
        noteUrl ??= note?.html_url ?? null;
      }
    } catch (e) {
      const url = runUrl();
      try {
        tell(
          `Not recorded: the bot hit an error${url ? `; see ${url}` : ''}. Nothing was changed; post the command again after a fix.`,
        );
      } catch (postError) {
        console.error(postError.stack ?? postError);
      }
      throw e;
    }
    console.log(
      `disposition: recorded ${parsed.commands.map((c) => c.id).join(', ')} at ${head.slice(0, 7)}`,
    );
    if (inThread) {
      // The record is written; a failed courtesy reply must not undo it.
      try {
        tell(`Recorded${noteUrl ? `: see ${noteUrl}` : ''}.`);
      } catch (e) {
        console.error(e.stack ?? e);
      }
    }
  },

  // The owner's /restart <stage> <reason> on an ISSUE (restart.yml,
  // issue_comment created). The comment arrives through the environment, as
  // data: COMMENT_BODY, COMMENT_USER, COMMENT_USER_TYPE. decideRestart
  // checks everything; a comment that cannot be honoured gets one short
  // reply and changes nothing. Accepted: the issue's lifetime counter and
  // attempt list are written FIRST (a crash after that costs a restart,
  // never gives one away), then the restart route note lands on the issue
  // and its stage label is applied.
  restart([number, commentId]) {
    const n = num(number);
    const cid = num(commentId);
    const item = api(`issues/${n}`);
    const fetched = api(`issues/comments/${cid}`);
    const repo = `${OWNER}/${NAME}`;
    const pullRequests = list('pulls?state=open')
      .filter(
        (p) =>
          isPipelinePr({
            author: p.user?.login,
            headRef: p.head?.ref,
            headRepo: p.head?.repo?.full_name,
            repo,
            botLogin: botLogin(),
          }) &&
          issueFromBranch({
            headRef: p.head.ref,
            headRepo: p.head.repo?.full_name,
            repo,
          }) === n,
      )
      .map((p) => ({ number: p.number }));
    const labels = item.labels.map((l) => l.name);
    const decision = decideRestart({
      comment: {
        id: cid,
        body: process.env.COMMENT_BODY,
        login: process.env.COMMENT_USER,
        type: process.env.COMMENT_USER_TYPE,
        createdAt: fetched.created_at,
      },
      ownerLogin: ownerLogin(),
      edited:
        fetched.updated_at !== fetched.created_at ||
        fetched.body !== process.env.COMMENT_BODY,
      issue: {
        number: n,
        state: item.state,
        isPullRequest: Boolean(item.pull_request),
        labels,
      },
      state: readState(n),
      pullRequests,
    });
    console.log(
      `restart: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    if (decision.action === 'ignore') return;
    if (decision.action === 'reply') {
      postComment(
        n,
        decision.limit
          ? decision.reason
          : `Not applied: ${say(decision.reason)}.`,
      );
      return;
    }

    writeState(n, decision.state, applyLabels(labels, decision.edit));
    postComment(n, decision.note);
    editLabels(n, decision.edit);
  },

  // A person moved an item out of stage:needs-attention by hand (restart.yml,
  // label event by a human): one pointer to /restart per parking. The label
  // edit already happened and stays; this changes no budget. EVENT_ACTION
  // and LABEL come from the event, through the environment.
  'restart-hint'([number]) {
    const n = num(number);
    const item = api(`issues/${n}`);
    if (item.state !== 'open') {
      console.log(`restart-hint: skipped (#${n} is closed)`);
      return;
    }
    const decision = decideRestartHint({
      action: process.env.EVENT_ACTION,
      label: process.env.LABEL,
      labels: item.labels.map((l) => l.name),
      comments: list(`issues/${n}/comments`),
      botLogin: botLogin(),
    });
    console.log(
      `restart-hint: ${decision.post ? 'posting' : `skipped (${decision.reason})`}`,
    );
    if (decision.post) postComment(n, renderRestartHint());
  },
};
