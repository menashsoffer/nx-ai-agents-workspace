// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  classifyThreads,
  COPILOT_REVIEWER,
  evaluateGates,
  renderGatesComment,
  MARKERS,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { BOT, HEAD_A, OWNER_LOGIN, passing } from './pipeline-lib-fixtures.mjs';

// ---------------------------------------------------------------- review threads

test('classifyThreads names Copilot threads and leaves the rest', () => {
  const thread = (id, first, extra = {}) => ({
    id,
    isResolved: false,
    first,
    ...extra,
  });
  const out = classifyThreads([
    thread('T1', { id: 22, author: COPILOT_REVIEWER, body: 'nit' }),
    thread('T2', { id: 33, author: 'alice', body: 'a human thread' }),
    thread('T3', { id: 55, author: BOT, body: 'plain bot comment' }),
    thread('T4', null),
  ]);
  assert.deepEqual(
    out.map((t) => [t.thread.id, t.source, t.id]),
    [
      ['T1', 'copilot', 'C-22'],
      ['T2', 'other', null],
      ['T3', 'other', null],
      ['T4', 'other', null],
    ],
  );
});

test('renderGatesComment lists gates, open findings and dispositions, and escapes their text', () => {
  const gates = evaluateGates({ ...passing, copilotReviewedHead: false });
  const body = renderGatesComment({
    head: HEAD_A,
    gates,
    open: [
      {
        id: 'C-11',
        source: 'Copilot',
        text: 'a.ts:1 <img src=x> | @octocat <!-- pipeline-state -->',
      },
      { id: 'C-22', source: 'Copilot', text: 'b.ts:2 rename' },
    ],
    dispositions: [
      {
        id: 'C-9',
        kind: 'accepted-risk',
        by: OWNER_LOGIN,
        reason: 'x | y @z',
      },
    ],
  });
  assert.ok(body.startsWith(`${MARKERS.gates}\n`));
  assert.ok(body.includes('`pipeline/gates` commit status is **pending**'));
  assert.ok(body.includes('| `C-11` | Copilot |'));
  assert.ok(body.includes('| `C-22` | Copilot |'));
  assert.ok(
    body.includes(
      '/disposition <id> <accepted-risk|false-positive|out-of-scope>',
    ),
  );
  assert.ok(!body.includes('<img'));
  assert.ok(!body.includes('<!-- pipeline-state'));
  assert.ok(!body.includes('@octocat') && !body.includes('@z'));
  assert.ok(
    !/[^\\]\|[^ \n]/.test(
      body.split('C-11` | Copilot')[1].split('\n')[0].slice(3),
    ),
    'pipes in text are escaped',
  );
  const clean = renderGatesComment({
    head: HEAD_A,
    gates: evaluateGates(passing),
  });
  assert.ok(clean.includes('✅') && !clean.includes('Open findings'));
});

test('workflows: /disposition counts only new comments from the owner account', () => {
  const read = (f) =>
    readFileSync(new URL(`../workflows/${f}`, import.meta.url), 'utf8');
  const disposition = read('disposition.yml');
  // Created comments only: an edit never re-runs (or re-authorises) a command.
  assert.match(
    disposition,
    /on:\n {2}issue_comment:\n {4}types: \[created\]\n/,
  );
  assert.ok(
    !/edited|deleted/.test(
      disposition.split('permissions:')[0].replace(/#.*$/gm, ''),
    ),
  );
  // Owner login and a human account, checked against the variable; unset fails closed.
  assert.ok(
    disposition.includes(
      'github.event.comment.user.login == vars.PIPELINE_OWNER_LOGIN',
    ),
  );
  assert.ok(disposition.includes("github.event.comment.user.type == 'User'"));
  assert.ok(disposition.includes("vars.PIPELINE_OWNER_LOGIN != ''"));
  assert.ok(disposition.includes('github.event.issue.pull_request'));
  // Not author_association, not the PR/issue author.
  assert.ok(
    !/author_association|issue\.user|pull_request\.user/.test(disposition),
  );
  // The body reaches the script through the environment, from the event.
  assert.ok(
    disposition.includes('COMMENT_BODY: ${{ github.event.comment.body }}'),
  );
  const run = /run: (node .*)$/m.exec(disposition)[1];
  assert.ok(!run.includes('${{'));
  // The re-evaluation is triggered by the bot's record note only.
  const approval = read('approval.yml');
  assert.match(approval, /issue_comment:\n {4}types: \[created\]/);
  assert.ok(
    approval.includes(
      'github.event.comment.user.login == vars.PIPELINE_BOT_LOGIN',
    ),
  );
  assert.ok(
    approval.includes(
      "startsWith(github.event.comment.body, '<!-- pipeline:disposition')",
    ),
  );
  assert.ok(approval.includes('workflow_run:'));
  assert.ok(approval.includes('permission-statuses: write'));
});

test('workflows: every job that resolves review threads mints its App token with contents: write', () => {
  // resolveReviewThread needs contents: write on an App installation token;
  // pull-requests: write alone crashes with "Resource not accessible".
  const commandsDir = new URL('./pipeline/', import.meta.url);
  const src = readdirSync(commandsDir)
    .filter((f) => /^commands-.*\.mjs$/.test(f))
    .map((f) => readFileSync(new URL(f, commandsDir), 'utf8'))
    .join('\n');
  const commandsThatResolve = [
    ...src.matchAll(
      /^ {2}'?([\w-]+)'?\(\[[^\]]*\]\) \{\n([\s\S]*?)^ {2}\},?$/gm,
    ),
  ]
    .filter(([, , body]) => body.includes('resolveThread('))
    .map(([, name]) => name);
  assert.deepEqual(commandsThatResolve, ['disposition']);
  const dir = new URL('../workflows/', import.meta.url);
  let checked = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const workflow = parseYaml(readFileSync(new URL(file, dir), 'utf8'));
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      const runs = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
      for (const command of commandsThatResolve) {
        if (!new RegExp(`pipeline\\.mjs ${command}( |$)`, 'm').test(runs))
          continue;
        const app = (job.steps ?? []).find((s) =>
          s.uses?.startsWith('actions/create-github-app-token@'),
        );
        assert.equal(
          app?.with?.['permission-contents'],
          'write',
          `${file} job ${jobName} runs \`${command}\` without permission-contents: write`,
        );
        checked += 1;
      }
    }
  }
  assert.equal(checked, commandsThatResolve.length);
});
