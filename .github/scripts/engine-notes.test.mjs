// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeFindings,
  developNote,
  encodeFindings,
  enginePromptVersion,
  publishedNote,
  requestNote,
  safeNote,
} from './engine-notes.mjs';
import { runFor } from './engine-test-run.mjs';

const TOKEN = `ghp_${'S'.repeat(36)}`;
const PRIVATE = 'the private address of the owner is 12 Example Street';

test('findings round-trip only through the closed set', () => {
  const findings = [
    { field: 'body', kinds: ['github_token'] },
    { field: 'comments[2].body', kinds: ['aws_access_key', 'jwt'] },
  ];
  const text = encodeFindings(findings);
  assert.equal(
    text,
    'body:github_token,comments[2].body:aws_access_key,comments[2].body:jwt',
  );
  assert.deepEqual(decodeFindings(text), findings);
  for (const forged of [
    '',
    'body:github_token,body:your_password_here',
    `body:${TOKEN}`,
    `${PRIVATE}:github_token`,
    'comments[99999].body:jwt',
    JSON.stringify({ stage: 'develop', summary: PRIVATE }),
    new Array(51).fill('body:jwt').join(','),
  ])
    assert.equal(decodeFindings(forged), null, forged.slice(0, 40));
});

test('regression: a forged request outcome never reaches the note', () => {
  const forged = JSON.stringify({
    stage: 'develop',
    result: 'problem',
    problem: 'needs_secrets_ci_infra',
    summary: PRIVATE,
    details: [`token ${TOKEN}`],
  });
  const note = safeNote(requestNote('develop', forged), {
    promptVersionText: 'develop.md@5',
  });
  const text = JSON.stringify(note);
  assert.ok(!text.includes(TOKEN) && !text.includes(PRIVATE));
  assert.deepEqual(note.details, [
    'secret_in_request: details withheld (the findings did not validate)',
  ]);
  const honest = safeNote(requestNote('plan', 'body:github_token'), {
    promptVersionText: 'plan.md@6',
  });
  assert.deepEqual(honest.details, ['secret_in_request: body (github_token)']);
});

test('the develop note keeps no word of the developer', () => {
  const raw = JSON.stringify({
    status: 'blocked',
    problem: `plan_gap ${PRIVATE}`,
    blocked_reason: `${PRIVATE} ${TOKEN}`,
    pr_title: TOKEN,
  });
  const note = safeNote(
    developNote({ implementResult: 'success', publishResult: 'skipped', raw }),
    {
      promptVersionText: 'develop.md@5',
    },
  );
  const text = JSON.stringify(note);
  assert.ok(!text.includes(TOKEN) && !text.includes(PRIVATE));
  assert.equal(note.problem, 'agent_error');
  const known = developNote({
    raw: JSON.stringify({ status: 'blocked', problem: 'plan_gap' }),
  });
  assert.equal(known.problem, 'plan_gap');
  const forgedResults = developNote({
    implementResult: PRIVATE,
    publishResult: TOKEN,
    raw: '',
  });
  assert.deepEqual(forgedResults.details, [
    'Implement job: failure; publish job: failure.',
  ]);
  assert.equal(developNote({ patchRejected: true }).problem, 'forbidden_path');
});

test('safeNote refuses a note that would hold a secret', () => {
  assert.throws(
    () =>
      safeNote(
        {
          stage: 'develop',
          result: 'problem',
          problem: 'agent_error',
          summary: TOKEN,
        },
        { promptVersionText: 'x.md@1' },
      ),
    /secret-shaped value \(github_token\)/,
  );
  assert.throws(() => publishedNote('7; rm -rf'), /Bad PR number/);
  assert.equal(publishedNote('12').summary, 'Draft PR #12 opened.');
});

test('the prompt version comes from the engine file and must be plain', () => {
  assert.equal(
    enginePromptVersion('develop.md', '---\nversion: 5\n---\n# x'),
    'develop.md@5',
  );
  assert.equal(
    enginePromptVersion('develop.md', `---\nversion: ${TOKEN}${TOKEN}\n---`),
    'develop.md@unknown',
  );
  assert.equal(
    enginePromptVersion('develop.md', 'no front matter'),
    'develop.md@unversioned',
  );
});

test('safe-note CLI: forged findings and developer text do not reach the file', () => {
  const run = runFor({
    repository: 'menashsoffer/pipeline-sandbox',
    repositoryId: 101,
  });
  const prompt = new URL('../prompts/develop.md', import.meta.url).pathname;
  const out = join(run.directory, 'outcome.json');
  const result = join(run.directory, 'result.json');
  writeFileSync(
    result,
    JSON.stringify({ status: 'blocked', problem: 'x', blocked_reason: TOKEN }),
  );
  for (const args of [
    ['--kind', 'request', '--findings', `body:github_token,${PRIVATE}`],
    [
      '--kind',
      'develop',
      '--job-result',
      'success',
      '--publish-result',
      'skipped',
      '--result',
      result,
    ],
  ]) {
    const done = run.run(
      'safe-note',
      '--stage',
      'develop',
      ...args,
      '--prompt',
      prompt,
      '--prompt-name',
      'develop.md',
      '--out',
      out,
    );
    assert.equal(done.status, 0, done.stdout);
    const text = readFileSync(out, 'utf8');
    assert.ok(!text.includes(TOKEN) && !text.includes(PRIVATE));
    assert.match(JSON.parse(text).prompt_version, /^develop\.md@\d+$/);
  }
  const body = join(run.directory, 'pr-body.md');
  writeFileSync(body, `Summary ${TOKEN}\n`);
  const checked = run.run('check-text', '--text', body);
  assert.equal(checked.status, 1);
  assert.match(
    checked.stdout,
    /pr-body\.md holds a secret-shaped value \(github_token\)/,
  );
  assert.ok(!checked.stdout.includes(TOKEN));
});
