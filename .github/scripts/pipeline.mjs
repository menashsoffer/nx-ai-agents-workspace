#!/usr/bin/env node
// Deterministic pipeline steps, called from .github/workflows/*.yml.
// Usage: node .github/scripts/pipeline.mjs <command> [args...]
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COPILOT_LOGINS,
  COPILOT_REVIEWER,
  MARKERS,
  STAGE_STATUS,
  branchName,
  buildSecurityReview,
  decideFix,
  emptyState,
  evaluateApproval,
  forbiddenPaths,
  parseSecurityReport,
  parseState,
  patchPaths,
  previewUrl,
  promptVersion,
  renderPrompt,
  renderState,
  selectActionable,
  stageTransition,
  validateSpec,
} from './pipeline-lib.mjs';
import {
  NAME,
  OWNER,
  api,
  editLabels,
  findComment,
  graphql,
  labelsOf,
  list,
  resolveThread,
  reviewThreads,
  setOutput,
  upsertComment,
} from './github.mjs';

const [, , command, ...argv] = process.argv;

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const val = args[++i];
    if (out[key] === undefined) out[key] = val;
    else out[key] = [].concat(out[key], val);
  }
  return out;
}
const many = (v) => (v === undefined ? [] : [].concat(v));
const num = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`Expected a number, got ${v}`);
  return n;
};

// ------------------------------------------------------------ state

function readState(pr) {
  const c = findComment(pr, MARKERS.state);
  return c ? parseState(c.body) : emptyState();
}

function writeState(pr, state) {
  upsertComment(pr, MARKERS.state, renderState(state, labelsOf(pr)));
}

function setStage(number, stage) {
  editLabels(number, stageTransition(labelsOf(number), stage));
}

// ------------------------------------------------------------ commands

const commands = {
  'render-prompt'(args) {
    const f = flags(args);
    const promptText = readFileSync(f.prompt, 'utf8');
    const context = Object.fromEntries(
      many(f.context).map((kv) => [
        kv.slice(0, kv.indexOf('=')),
        kv.slice(kv.indexOf('=') + 1),
      ]),
    );
    context['prompt version'] = `${f.prompt}@${promptVersion(promptText)}`;
    const data = many(f.data).map((kv) => {
      const [name, path] = [
        kv.slice(0, kv.indexOf('=')),
        kv.slice(kv.indexOf('=') + 1),
      ];
      return { name, path, content: readFileSync(path, 'utf8') };
    });
    const prompt = renderPrompt({ promptText, context, data });
    if (f.out) writeFileSync(f.out, prompt);
    if (f.output) setOutput(f.output, prompt);
    setOutput('version', promptVersion(promptText));
  },

  'set-stage'([number, stage]) {
    setStage(num(number), stage);
  },

  'edit-labels'(args) {
    const f = flags(args);
    editLabels(num(f._[0]), { add: many(f.add), remove: many(f.remove) });
  },

  'upsert-comment'([number, markerKey, file]) {
    const marker = MARKERS[markerKey];
    if (!marker) throw new Error(`Unknown marker ${markerKey}`);
    upsertComment(num(number), marker, readFileSync(file, 'utf8'));
  },

  'branch-name'([number]) {
    setOutput('branch', branchName(num(number), process.env.ISSUE_TITLE ?? ''));
  },

  'validate-spec'([file]) {
    const res = validateSpec(readFileSync(file, 'utf8'));
    setOutput('ok', String(res.ok));
    setOutput('missing', res.missing.join(', '));
  },

  'check-patch'([file]) {
    const bad = forbiddenPaths(patchPaths(readFileSync(file, 'utf8')));
    if (bad.length) {
      console.error(`Patch touches protected paths: ${bad.join(', ')}`);
      process.exit(1);
    }
  },

  'init-state'([pr]) {
    const n = num(pr);
    if (findComment(n, MARKERS.state)) return;
    const created = api(`pulls/${n}`).created_at;
    writeState(n, { ...emptyState(), watermark: created });
  },

  'fix-adapter'([pr, outFile]) {
    const n = num(pr);
    const labels = labelsOf(n);
    const state = readState(n);
    const threads = reviewThreads(n);
    const resolvedCommentIds = new Set(
      threads.filter((t) => t.isResolved).flatMap((t) => t.commentIds),
    );
    const { actionable, watermark } = selectActionable({
      reviews: list(`pulls/${n}/reviews`),
      reviewComments: list(`pulls/${n}/comments`),
      resolvedCommentIds,
      state,
    });
    const decision = decideFix({ labels, actionable });
    console.log(
      `fix-adapter: ${decision.action} (${decision.reason ?? `loop ${decision.loop}`})`,
    );
    writeFileSync(outFile, JSON.stringify(actionable, null, 2));
    setOutput('action', decision.action);
    setOutput('loop', String(decision.loop ?? ''));
    if (decision.action === 'noop') return;

    // Record before acting: a rerun with no newer comments is a no-op.
    const next = {
      ...state,
      watermark,
      handled: [
        ...new Set([...state.handled, ...actionable.map((a) => a.key)]),
      ],
    };
    if (decision.action === 'escalate') {
      setStage(n, 'stage:needs-attention');
      upsertComment(
        n,
        MARKERS.notice,
        `**Pipeline stopped: needs attention.** ${decision.reason}; ${actionable.length} new review item(s) remain. A human needs to take over this PR.`,
      );
    } else {
      editLabels(n, stageTransition(labels, 'stage:fixing'));
      editLabels(n, {
        add: decision.add.filter((l) => !l.startsWith('stage:')),
        remove: decision.remove,
      });
    }
    writeState(n, next);
  },

  'fix-reply'([pr, sha, itemsFile]) {
    const n = num(pr);
    const items = JSON.parse(readFileSync(itemsFile, 'utf8'));
    const bot = process.env.PIPELINE_BOT_LOGIN ?? '';
    const autoResolve = new Set([bot, ...COPILOT_LOGINS].filter(Boolean));
    const short = sha.slice(0, 7);
    for (const it of items.filter((i) => i.kind === 'inline')) {
      api(`pulls/${n}/comments/${it.id}/replies`, {
        method: 'POST',
        body: {
          body: `${MARKERS.fixReply}\nAddressed in ${short} (automated fix). Please re-check.`,
        },
      });
    }
    // Resolve only threads opened by bots; human threads stay for the human.
    const ids = new Set(
      items.filter((i) => i.kind === 'inline').map((i) => i.id),
    );
    for (const t of reviewThreads(n)) {
      if (
        !t.isResolved &&
        t.commentIds.some((id) => ids.has(id)) &&
        autoResolve.has(t.authors[0])
      )
        resolveThread(t.id);
    }
    const reviewItems = items.filter((i) => i.kind === 'review');
    if (reviewItems.length) {
      api(`issues/${n}/comments`, {
        method: 'POST',
        body: {
          body: `${MARKERS.fixReply}\nAddressed review feedback from ${reviewItems
            .map((i) => `@${i.author}`)
            .join(', ')} in ${short} (automated fix).`,
        },
      });
    }
  },

  'security-publish'([pr, sha, responseFile, promptVer]) {
    const n = num(pr);
    const head = api(`pulls/${n}`).head.sha;
    if (head !== sha) {
      console.log(`Head moved (${head}); skipping stale review of ${sha}.`);
      return;
    }
    const already = list(`pulls/${n}/reviews`).some((r) =>
      r.body?.includes(`${MARKERS.securityReview} sha=${sha}`),
    );
    if (already) {
      console.log('Security review for this commit already posted.');
      return;
    }
    const status = (state, description) =>
      api(`statuses/${sha}`, {
        method: 'POST',
        body: {
          state,
          context: 'pipeline/security',
          description: description.slice(0, 140),
        },
      });
    const report = parseSecurityReport(readFileSync(responseFile, 'utf8'));
    if (!report.ok) {
      status('error', report.error);
      setStage(n, 'stage:needs-attention');
      upsertComment(
        n,
        MARKERS.notice,
        `**Security review failed:** ${report.error}. A human needs to review this PR.`,
      );
      process.exitCode = 1;
      return;
    }
    const review = buildSecurityReview({
      report,
      sha,
      files: list(`pulls/${n}/files`),
      promptVer,
    });
    const post = (comments) =>
      api(`pulls/${n}/reviews`, {
        method: 'POST',
        body: { commit_id: sha, event: 'COMMENT', body: review.body, comments },
      });
    try {
      post(review.comments);
    } catch {
      // Line mapping rejected: fall back to one actionable body.
      const extra = review.comments.map(
        (c) => `- ${c.path}:${c.line}: ${c.body.replace(/\n\n/g, '\n  ')}`,
      );
      review.body = [
        review.body,
        MARKERS.actionable,
        '#### Findings',
        ...extra,
      ].join('\n\n');
      post([]);
    }
    status(
      review.clean ? 'success' : 'failure',
      review.clean
        ? 'No blocking findings'
        : `${review.blockingCount} blocking finding(s)`,
    );
    setStage(n, 'stage:reviewing');
    setOutput('clean', String(review.clean));
  },

  approval([pr]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    const head = p.head.sha;
    const labels = labelsOf(n);
    const runs = api(
      `commits/${head}/check-runs?check_name=ci&per_page=100`,
    ).check_runs;
    const ci = runs.sort((a, b) => b.id - a.id)[0]?.conclusion ?? null;
    const sec = api(`commits/${head}/statuses?per_page=100`).find(
      (s) => s.context === 'pipeline/security',
    )?.state;
    const unresolved = reviewThreads(n).filter((t) => !t.isResolved).length;
    const copilotReviewedHead = list(`pulls/${n}/reviews`).some(
      (r) => COPILOT_LOGINS.includes(r.user?.login) && r.commit_id === head,
    );
    const state = readState(n);
    const decision = evaluateApproval({
      prState: p.state,
      draft: p.draft,
      labels,
      headSha: head,
      ciConclusion: ci,
      securityState: sec,
      unresolvedThreads: unresolved,
      copilotReviewedHead,
      state,
    });
    console.log(
      `approval: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );

    if (decision.action === 'request-copilot') {
      const saved = process.env.GH_TOKEN;
      if (process.env.COPILOT_GH_TOKEN)
        process.env.GH_TOKEN = process.env.COPILOT_GH_TOKEN;
      try {
        api(`pulls/${n}/requested_reviewers`, {
          method: 'POST',
          body: { reviewers: [COPILOT_REVIEWER] },
        });
      } catch (e) {
        process.env.GH_TOKEN = saved;
        setStage(n, 'stage:needs-attention');
        upsertComment(
          n,
          MARKERS.notice,
          '**Could not request a Copilot review.** Check that Copilot code review is enabled for this repo and that `COPILOT_REVIEW_TOKEN` belongs to a user with Copilot access.',
        );
        throw e;
      } finally {
        process.env.GH_TOKEN = saved;
      }
      writeState(n, { ...state, copilotRequestedFor: head });
    }

    if (decision.action === 'human-approval') {
      setStage(n, 'stage:human-approval');
      if (p.draft)
        graphql(
          `
            mutation ($id: ID!) {
              markPullRequestReadyForReview(input: { pullRequestId: $id }) {
                pullRequest {
                  id
                }
              }
            }
          `,
          { id: p.node_id },
        );
      const url = previewUrl(OWNER, NAME, n);
      upsertComment(
        n,
        MARKERS.humanApproval,
        [
          `### Ready for human approval`,
          `CI is green, the security review is clean, Copilot has reviewed \`${head.slice(0, 7)}\` and all threads are resolved.`,
          `**Preview:** ${url}`,
          `Code owners have been requested for review. Merging is a human decision; no agent can merge.`,
        ].join('\n\n'),
      );
      writeState(n, { ...state, humanApprovalFor: head });
    }
  },

  'linked-issues'([pr]) {
    const data = graphql(
      `
        query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
              closingIssuesReferences(first: 20) {
                nodes {
                  id
                  number
                }
              }
            }
          }
        }
      `,
      { owner: OWNER, name: NAME, number: num(pr) },
    ).repository.pullRequest;
    setOutput('pr_node_id', data.id);
    setOutput(
      'issue_node_ids',
      data.closingIssuesReferences.nodes.map((i) => i.id).join(' '),
    );
  },

  'project-status'(args) {
    const f = flags(args);
    const m = /github\.com\/(users|orgs)\/([^/]+)\/projects\/(\d+)/.exec(
      f['project-url'] ?? '',
    );
    if (!m)
      throw new Error(
        'PROJECT_URL must look like https://github.com/users/<login>/projects/<n>',
      );
    const [, kind, login, number] = m;
    const owner = kind === 'users' ? 'user' : 'organization';
    const status = STAGE_STATUS[f.status] ?? f.status;
    const project = graphql(
      `query($login:String!,$number:Int!){ ${owner}(login:$login){ projectV2(number:$number){ id
        field(name:"Status"){ ... on ProjectV2SingleSelectField { id options{ id name } } } } } }`,
      { login, number: Number(number) },
    )[owner].projectV2;
    const option = project.field?.options.find((o) => o.name === status);
    if (!option)
      throw new Error(
        `Project has no Status option "${status}". Run tools/scripts/pipeline/setup-project.sh.`,
      );
    for (const contentId of many(f['content-id'])
      .flatMap((s) => s.split(' '))
      .filter(Boolean)) {
      const itemId = graphql(
        `
          mutation ($p: ID!, $c: ID!) {
            addProjectV2ItemById(input: { projectId: $p, contentId: $c }) {
              item {
                id
              }
            }
          }
        `,
        { p: project.id, c: contentId },
      ).addProjectV2ItemById.item.id;
      f['item-id'] = [...many(f['item-id']), itemId];
    }
    for (const itemId of many(f['item-id'])) {
      graphql(
        `
          mutation ($p: ID!, $i: ID!, $f: ID!, $o: String!) {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: $p
                itemId: $i
                fieldId: $f
                value: { singleSelectOptionId: $o }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `,
        { p: project.id, i: itemId, f: project.field.id, o: option.id },
      );
      console.log(`Project item ${itemId} -> ${status}`);
    }
  },
};

if (!commands[command]) {
  console.error(
    `Unknown command: ${command}\nCommands: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(2);
}
try {
  await commands[command](argv);
} catch (e) {
  console.error(e.stack ?? e);
  process.exit(1);
}
