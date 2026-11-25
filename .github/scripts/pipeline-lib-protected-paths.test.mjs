// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  FORBIDDEN_PATH_PATTERNS,
  APPROVABLE_PATH_PATTERNS,
  classifyProtectedPaths,
  classifyPatch,
  checkPatch,
  pathSetHash,
  comparePaths,
  COMPARE_FILE_LIMIT,
  protectedOfCompare,
  evaluatePlanApproval,
  PLAN_MAX_FILES,
  allowedTargets,
  classifyPlan,
  renderPlanComment,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import {
  LOCK,
  PKG,
  depFiles,
  filesOf,
  hunk,
  planned,
  withPlan,
} from './pipeline-lib-fixtures.mjs';

test('APPROVABLE_PATH_PATTERNS is a strict subset of FORBIDDEN_PATH_PATTERNS', () => {
  const forbidden = FORBIDDEN_PATH_PATTERNS.map((re) => re.source);
  for (const re of APPROVABLE_PATH_PATTERNS)
    assert.ok(forbidden.includes(re.source), `${re.source} is forbidden too`);
  assert.ok(APPROVABLE_PATH_PATTERNS.length < FORBIDDEN_PATH_PATTERNS.length);
  // Everything approvable is forbidden for an agent patch; the reverse is false.
  const never = [
    '.github/workflows/ci.yml',
    'CODEOWNERS',
    '.github/CODEOWNERS',
    '.pipeline/x',
    '.claude/settings.json',
    '.codex/config.toml',
    'tools/security/src/run.mjs',
    '.npmrc',
    'apps/site/.npmrc',
    '.gitmodules',
  ];
  const approvable = [
    'package.json',
    PKG,
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tools/workspace-plugin/src/generators/app.ts',
    'tools/pipeline-map/src/cli.mjs',
  ];
  const isAny = (patterns, p) => patterns.some((re) => re.test(p));
  for (const p of never) {
    assert.ok(isAny(FORBIDDEN_PATH_PATTERNS, p), p);
    assert.ok(
      !isAny(APPROVABLE_PATH_PATTERNS, p),
      `${p} must not be approvable`,
    );
  }
  for (const p of approvable) {
    assert.ok(isAny(FORBIDDEN_PATH_PATTERNS, p), p);
    assert.ok(isAny(APPROVABLE_PATH_PATTERNS, p), p);
  }
  // near misses are neither
  for (const p of ['apps/site/src/package.json.ts', 'docs/github/x.md'])
    assert.ok(!isAny(FORBIDDEN_PATH_PATTERNS, p), p);
});

test('classifyProtectedPaths: approvable only, mixed, none', () => {
  assert.deepEqual(classifyProtectedPaths([PKG, LOCK, 'apps/site/a.ts']), {
    approvable: [LOCK, PKG].sort(),
    never: [],
    protected: [LOCK, PKG].sort(),
  });
  const mixed = classifyProtectedPaths([PKG, '.github/x.yml', 'a.ts', PKG]);
  assert.deepEqual(mixed.approvable, [PKG]);
  assert.deepEqual(mixed.never, ['.github/x.yml']);
  assert.deepEqual(mixed.protected, ['.github/x.yml', PKG]);
  assert.deepEqual(classifyProtectedPaths(['a.ts', 'docs/x.md']), {
    approvable: [],
    never: [],
    protected: [],
  });
  // Planned paths are also tested in lower case; the stricter reading wins.
  assert.deepEqual(
    classifyProtectedPaths(['.GITHUB/x.yml', 'Package.json'], {
      foldCase: true,
    }),
    {
      approvable: ['Package.json'],
      never: ['.GITHUB/x.yml'],
      protected: ['.GITHUB/x.yml', 'Package.json'],
    },
  );
  assert.deepEqual(classifyProtectedPaths(['Package.json']).protected, []);
});

const diffHeader = (path) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}`;

test('classifyPatch: none, approvable, forbidden (a never path or an unparseable header)', () => {
  const kind = (patch) => classifyPatch(patch).kind;
  assert.equal(kind(diffHeader('apps/site/a.ts')), 'none');
  assert.equal(kind(''), 'none');
  const dep = diffHeader(PKG) + diffHeader(LOCK);
  const r = classifyPatch(dep);
  assert.equal(r.kind, 'approvable');
  assert.deepEqual(r.approvable, [LOCK, PKG].sort());
  assert.deepEqual(r.never, []);
  // one never-approvable path makes the whole patch forbidden
  const mixed = classifyPatch(dep + diffHeader('.github/workflows/x.yml'));
  assert.equal(mixed.kind, 'forbidden');
  assert.deepEqual(mixed.never, ['.github/workflows/x.yml']);
  assert.equal(kind(diffHeader('tools/security/src/run.mjs')), 'forbidden');
  assert.equal(kind(diffHeader('.npmrc')), 'forbidden');
  // fail closed on what it cannot parse, even next to an approvable path
  assert.equal(kind(dep + 'diff --git nonsense\n'), 'forbidden');
  // a rename out of .github/ into an approvable path still names .github/
  assert.equal(
    kind(
      'diff --git a/.github/x.json b/package.json\nsimilarity index 100%\nrename from .github/x.json\nrename to package.json\n',
    ),
    'forbidden',
  );
  // checkPatch keeps rejecting every protected path (fix.yml, verify, push)
  assert.equal(checkPatch(dep).ok, false);
  assert.deepEqual(checkPatch(dep).forbidden.sort(), [LOCK, PKG].sort());
});

test('pathSetHash and comparePaths', () => {
  assert.equal(pathSetHash(['b', 'a']), pathSetHash(['a', 'b', 'a']));
  assert.notEqual(pathSetHash(['a']), pathSetHash(['a', 'b']));
  assert.match(pathSetHash([]), /^[0-9a-f]{64}$/);
  // renames contribute both names
  const c = comparePaths([
    { filename: 'package.json', previous_filename: '.github/x.json' },
    { filename: 'b.ts' },
  ]);
  assert.deepEqual(c.paths, ['.github/x.json', 'b.ts', 'package.json']);
  assert.equal(c.complete, true);
  // a list at the API's limit may be cut off: not complete
  const many = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => ({
    filename: `f${i}.ts`,
  }));
  assert.equal(comparePaths(many).complete, false);
  assert.equal(comparePaths(many.slice(1)).complete, true);
  // a path that could escape the repo makes the list untrusted
  assert.equal(comparePaths([{ filename: '../x' }]).complete, false);
  const p = protectedOfCompare(depFiles());
  assert.deepEqual(p.protected, [LOCK, PKG].sort());
  assert.equal(p.hash, pathSetHash([PKG, LOCK]));
});

// ---- the plan stage

const planWith = (...files) =>
  withPlan({
    changes: files.map((file) => ({
      project: 'x',
      file,
      change: 'edit',
      lines: 5,
    })),
  });

test('plan stage: approvable protected files pass auto-approval and are reported', () => {
  const ev = evaluatePlanApproval(planWith(PKG, LOCK, 'apps/site/src/app.tsx'));
  assert.equal(ev.approved, true);
  assert.deepEqual(ev.protectedPaths, [LOCK, PKG].sort());
  for (const file of [
    'pnpm-workspace.yaml',
    'tools/workspace-plugin/src/index.ts',
    'tools/pipeline-map/src/cli.mjs',
    'package.json',
  ]) {
    const r = evaluatePlanApproval(planWith(file));
    assert.equal(r.approved, true, file);
    assert.deepEqual(r.protectedPaths, [file]);
  }
  // no key at all when nothing is protected
  assert.equal('protectedPaths' in evaluatePlanApproval(planned()), false);
  // the size limits still apply to them
  assert.equal(
    evaluatePlanApproval(
      withPlan({
        changes: [...filesOf(PLAN_MAX_FILES), planWith(PKG).plan.changes[0]],
      }),
    ).problem,
    'scope_split',
  );
});

test('plan stage: any never-approvable path is still protected_surface', () => {
  const ev = evaluatePlanApproval(
    planWith(PKG, LOCK, '.github/workflows/ci.yml'),
  );
  assert.equal(ev.approved, false);
  assert.equal(ev.problem, 'protected_surface');
  assert.match(ev.details.join(' '), /\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(ev.details.join(' '), /package\.json/);
  assert.equal(
    evaluatePlanApproval(planWith(PKG, 'tools/security/src/run.mjs')).problem,
    'protected_surface',
  );
  assert.equal(
    evaluatePlanApproval(planWith(PKG, '.GITHUB/x.yml')).problem,
    'protected_surface',
  );
  assert.deepEqual(allowedTargets('plan', 'protected_surface'), ['human']);
});

test('plan stage: the outcome and the plan comment tell the owner approval is needed', () => {
  const result = planWith(PKG, LOCK, 'apps/site/src/app.tsx');
  const o = classifyPlan({ jobResult: 'success', raw: JSON.stringify(result) });
  assert.equal(o.result, 'success');
  assert.match(o.summary, /owner approval needed before a PR opens/);
  assert.deepEqual(o.details, [
    `Protected paths (owner approval needed before a PR opens): ${[LOCK, PKG].sort().join(', ')}`,
  ]);
  const comment = renderPlanComment(result, 'plan.md@5');
  assert.match(comment, /## Owner approval/);
  assert.match(comment, /\/approve-protected/);
  assert.match(comment, /`pnpm-lock\.yaml`/);
  // unprotected plans are unchanged: no section, no details
  const plain = classifyPlan({
    jobResult: 'success',
    raw: JSON.stringify(planned()),
  });
  assert.equal(plain.details, undefined);
  assert.doesNotMatch(plain.summary, /owner approval/);
  assert.doesNotMatch(
    renderPlanComment(planned(), 'plan.md@5'),
    /Owner approval/,
  );
  // a never-approvable path is a problem outcome as before
  const bad = classifyPlan({
    jobResult: 'success',
    raw: JSON.stringify(planWith('.github/x.yml')),
  });
  assert.equal(bad.problem, 'protected_surface');
});
