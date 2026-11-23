// Guard tests for review.yml (issue #154). Run with: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { REVIEW_CATEGORIES, REVIEW_MAX_FINDINGS } from './review-lib.mjs';

const readWorkflow = (name) =>
  readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

test('review.yml: the agent job is read-only and never holds a write token', () => {
  const workflow = parseYaml(readWorkflow('review.yml'));
  const { review: agent, publish, decide } = workflow.jobs;
  assert.deepEqual(workflow.permissions, {});
  for (const job of [agent, decide])
    for (const [scope, level] of Object.entries(job.permissions))
      assert.equal(level, 'read', `${scope} must be read`);
  const agentText = JSON.stringify(agent);
  assert.ok(!agentText.includes('create-github-app-token'));
  assert.ok(!agentText.includes('PIPELINE_APP_PRIVATE_KEY'));
  assert.deepEqual(
    [...agentText.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]),
    ['CLAUDE_CODE_OAUTH_TOKEN'],
  );
  for (const step of agent.steps.filter((s) =>
    s.uses?.startsWith('actions/checkout@'),
  ))
    assert.equal(step.with['persist-credentials'], false);
  const claude = agent.steps.find((s) => s.id === 'claude');
  const args = claude.with.claude_args;
  assert.ok(args.includes('--allowedTools "Read,Glob,Grep"'));
  for (const tool of ['Bash', 'Edit', 'Write', 'WebFetch'])
    assert.match(args, new RegExp(`--disallowedTools "[^"]*\\b${tool}\\b`));
  // The PR's agent settings and hooks are removed before the agent runs.
  const steps = agent.steps.map((s) => s.run ?? s.id ?? s.uses);
  const drop = steps.findIndex((s) => /rm -rf \.claude/.test(s));
  assert.ok(drop > 0 && drop < steps.indexOf('claude'));
  // Only the publish job writes, and it runs no agent.
  assert.ok(JSON.stringify(publish).includes('create-github-app-token'));
  assert.ok(!JSON.stringify(publish).includes('claude-code-action'));
});

test('review.yml: triggers, the schema and the hand-off trigger in approval.yml', () => {
  const text = readWorkflow('review.yml');
  const workflow = parseYaml(text);
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ['CI'],
    types: ['completed'],
  });
  assert.ok(workflow.on.workflow_dispatch);
  assert.ok(
    workflow.jobs.decide.if.includes("workflow_run.conclusion == 'success'"),
  );
  assert.ok(
    workflow.jobs.decide.if.includes(
      'workflow_run.head_repository.full_name == github.repository',
    ),
  );
  const schema = JSON.parse(/--json-schema '([^']+)'/.exec(text)[1]);
  const item = schema.properties.findings.items;
  assert.equal(schema.properties.findings.maxItems, REVIEW_MAX_FINDINGS);
  assert.deepEqual(item.properties.category.enum, REVIEW_CATEGORIES);
  assert.deepEqual(item.required, [
    'path',
    'line',
    'category',
    'title',
    'scenario',
  ]);
  assert.deepEqual(schema.properties.status.enum, ['clean', 'findings']);
  // A new review outcome note re-evaluates the gates.
  assert.ok(
    readWorkflow('approval.yml').includes(
      "startsWith(github.event.comment.body, '<!-- pipeline:outcome stage=review ')",
    ),
  );
});
