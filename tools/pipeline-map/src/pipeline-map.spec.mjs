import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel } from './model.mjs';
import { defaultPaths, generate, run } from './generate.mjs';
import { renderMarkdown, renderMermaid } from './render.mjs';
import {
  parseTriggers,
  parseWorkflow,
  pipelineCalls,
  readWorkflows,
  shellWords,
} from './workflows.mjs';
import * as fakeLib from './fixtures/basic/pipeline-lib.mjs';

const FIXTURE = join(import.meta.dirname, 'fixtures/basic');
const EXPECTED_UNGATED = {
  'stage:new': { kind: 'triage', reason: 'waits for a human' },
  'stage:help': {
    kind: 'human',
    reason: 'a human helps',
    human: 'Human helps',
  },
};
const fixturePaths = (outFile = join(FIXTURE, 'expected.md')) => ({
  workflowsDir: join(FIXTURE, 'workflows'),
  libPath: join(FIXTURE, 'pipeline-lib.mjs'),
  outFile,
  expectedUngated: EXPECTED_UNGATED,
});
const fixtureModel = () =>
  buildModel({
    workflows: readWorkflows(join(FIXTURE, 'workflows')),
    lib: fakeLib,
    expectedUngated: EXPECTED_UNGATED,
  });

describe('fixture tree', () => {
  it('renders the expected map and tables', async () => {
    // Rewrite with: UPDATE_FIXTURES=1 pnpm nx test pipeline-map
    if (process.env.UPDATE_FIXTURES) await run(fixturePaths());
    expect(await generate(fixturePaths())).toBe(
      readFileSync(join(FIXTURE, 'expected.md'), 'utf8'),
    );
  });

  it('derives gates, writes, escalations, events, loops and humans', () => {
    const mermaid = renderMermaid(fixtureModel());
    for (const line of [
      's_stage_ready --> w_build', // label gate
      'w_build --> s_stage_built', // stage write
      'w_build -.-> s_stage_help', // set-stage right after the notice
      'w_review -.-> s_stage_help', // COMMAND_EFFECTS problems
      'w_build -->|"opens PR"| w_review', // gh pr create -> on: pull_request
      'w_review -->|"round 1"| l_fix_loop_1',
      'l_fix_loop_1 -.->|"budget spent"| s_stage_help',
      's_stage_new -->|"human triage"| s_stage_ready',
      's_stage_help --> h_stage_help',
      'h_src_intake --> w_intake', // nothing triggers intake.yml
    ])
      expect(mermaid).toContain(`  ${line}\n`);
    // A normal write is not an escalation.
    expect(mermaid).not.toContain('w_build -.-> s_stage_built');
  });

  it('reports shared markers and the other findings', () => {
    const texts = fixtureModel().findings.map((f) => f.text);
    expect(texts).toContain(
      '`<!-- demo:result -->` is written by 2 workflows: `build.yml`, `review.yml`.',
    );
    expect(texts).toContain('Markers no workflow writes: `unused`.');
    expect(texts).toContain(
      '`stage:ready` is never set by a workflow (a human adds it; it starts the pipeline).',
    );
    expect(texts.join('\n')).toContain(
      'Set but never gated, and not in `EXPECTED_UNGATED`: `stage:built`.',
    );
    expect(texts).toContain(
      '2 workflows escalate straight to `stage:help`: `build.yml`, `review.yml`.',
    );
  });
});

describe('workflow parsing', () => {
  it('accepts `on:` as a string, a list, a map and a quoted key', () => {
    expect(parseTriggers('push')).toEqual([{ event: 'push' }]);
    expect(parseTriggers(['push', 'pull_request'])).toEqual([
      { event: 'push' },
      { event: 'pull_request' },
    ]);
    expect(
      parseTriggers({
        workflow_run: { workflows: ['CI'], types: 'completed' },
        status: null,
      }),
    ).toEqual([
      { event: 'status' },
      { event: 'workflow_run', types: ['completed'], workflows: ['CI'] },
    ]);
    const wf = parseWorkflow(
      'odd.yml',
      [
        '# comment before everything',
        '"on": # quoted key, trailing comment',
        '  issues: { types: [labeled] }',
        'jobs:',
        '  a:',
        "    if: \"github.event.label.name == 'stage:x' || startsWith(github.event.label.name, 'stage:')\"",
        "    # if: github.event.label.name == 'stage:commented-out'",
        '    steps: [{ run: "node pipeline.mjs set-stage 1 stage:y" }]',
      ].join('\n'),
    );
    expect(wf.name).toBe('odd.yml');
    expect(wf.triggers).toEqual([{ event: 'issues', types: ['labeled'] }]);
    expect(wf.gates.labels).toEqual(['stage:x']);
    expect(wf.gates.prefixes).toEqual(['stage:']);
    expect(wf.calls).toEqual([
      { command: 'set-stage', args: ['1', 'stage:y'], step: 1 },
    ]);
  });

  it('reads pipeline.mjs calls through quotes, continuations and comments', () => {
    expect(shellWords(`"a b" 'c' d # e`)).toEqual(['a b', 'c', 'd']);
    expect(shellWords('x "" y > out')).toEqual(['x', '', 'y']);
    expect(
      pipelineCalls(
        [
          'node "$T/.github/scripts/pipeline.mjs" check-patch a.patch',
          'node .github/scripts/pipeline.mjs \\',
          '  upsert-comment "${{ github.event.issue.number }}" notice body.md',
        ].join('\n'),
      ),
    ).toEqual([
      { command: 'check-patch', args: ['a.patch'] },
      {
        command: 'upsert-comment',
        args: ['${{ github.event.issue.number }}', 'notice', 'body.md'],
      },
    ]);
  });
});

describe('--check', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pipeline-map-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('detects a missing, then a stale file', async () => {
    const paths = fixturePaths(join(dir, 'map.md'));
    expect((await run({ ...paths, check: true })).stale).toBe(true);
    await run(paths);
    expect(await run({ ...paths, check: true })).toEqual({
      ok: true,
      stale: false,
      diff: [],
    });
    const text = readFileSync(paths.outFile, 'utf8');
    writeFileSync(paths.outFile, text.replace('`stage:built`', '`stage:old`'));
    const res = await run({ ...paths, check: true });
    expect(res.ok).toBe(false);
    expect(res.diff.join('\n')).toContain('+ ');
  });
});

describe('determinism', () => {
  it('gives identical output on every run and for any input order', async () => {
    expect(await generate(fixturePaths())).toBe(await generate(fixturePaths()));
    const workflows = readWorkflows(join(FIXTURE, 'workflows'));
    const render = (wfs) =>
      renderMarkdown(
        buildModel({
          workflows: wfs,
          lib: fakeLib,
          expectedUngated: EXPECTED_UNGATED,
        }),
      );
    expect(render([...workflows].reverse())).toBe(render(workflows));
  });
});

describe('this repository', () => {
  it('maps the real pipeline from the real sources', async () => {
    const md = await generate(defaultPaths());
    for (const line of [
      's_stage_qualified --> w_spec',
      'w_develop -->|"opens PR"| w_ci',
      'w_ci -->|"on success"| w_security',
      'w_fix -.-> s_stage_needs_attention',
    ])
      expect(md).toContain(`  ${line}\n`);
  });
});
