// Run: pnpm test:pipeline
// connector-coexistence.mjs: a workflow that a push of ANY engine branch
// (`issue-<n>-<slug>`) would start is a conflict, whatever its branch
// filter names. The check decides this for the whole branch language, not
// for a few sample names (connector-branch-filters.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  checkCoexistence,
  readWorkflowFolder,
} from './connector-coexistence.mjs';

const connector = readWorkflowFolder(
  fileURLToPath(
    new URL(
      '../../connectors/pipeline-sandbox/.github/workflows/',
      import.meta.url,
    ),
  ),
);
const RUNS_ON_PUSH = /runs on a push of an engine issue-<n>-\* branch/;
const pushConflicts = (push) =>
  checkCoexistence({
    ...connector,
    'other.yml': {
      on: { push },
      jobs: { build: { 'runs-on': 'ubuntu-latest', steps: [] } },
    },
  }).errors.filter((error) => RUNS_ON_PUSH.test(error));

// [push filter, is a conflict]
const PUSH_FILTERS = [
  // a single issue number: no sample name has it
  [{ branches: ['issue-42-*'] }, true],
  [{ branches: ['issue-4?2-*'] }, true],
  [{ branches: ['issue-[0-9]+-*'] }, true],
  [{ branches: ['issue-9999-fix-*'] }, true],
  [{ branches: ['issue-*-docs'] }, true],
  [{ branches: ['*-[a-z]*'] }, true],
  [{ branches: ['**'] }, true],
  [{ branches: ['issue-*', '!issue-4*'] }, true],
  [{ branches: ['main', 'issue-\\4\\2-*'] }, true],
  [{ 'branches-ignore': ['main'] }, true],
  [{ 'branches-ignore': ['issue-1*', 'issue-2*'] }, true],
  [{ 'branches-ignore': ['issue-*', '!issue-77-*'] }, true],
  [{ tags: ['v*'], branches: ['issue-42-*'] }, true],
  [null, true],
  // no engine branch passes
  [{ branches: ['main'] }, false],
  [{ branches: ['issue-0-a'] }, false],
  [{ branches: ['issue-42'] }, false],
  [{ branches: ['issue-42-'] }, false],
  [{ branches: ['issue-42-*/*'] }, false],
  [{ branches: ['issue-0*-*'] }, false],
  [{ branches: ['Issue-42-*'] }, false],
  [{ branches: ['issue-*', '!issue-*'] }, false],
  [{ branches: ['issue-*', '!issue-[1-9]*'] }, false],
  [{ branches: [] }, false],
  [{ 'branches-ignore': ['issue-**'] }, false],
  [{ 'branches-ignore': ['issue-*'] }, false],
  [{ 'branches-ignore': ['issue-[1-9]*-*'] }, false],
  [{ tags: ['issue-*'] }, false],
];

test('push filters: every engine branch counts, not a sample of them', () => {
  for (const [push, isConflict] of PUSH_FILTERS)
    assert.equal(
      pushConflicts(push).length > 0,
      isConflict,
      JSON.stringify(push),
    );
});

test('push filters: create always counts; the conflict names a branch', () => {
  const errors = checkCoexistence({
    ...connector,
    'other.yml': { on: ['create'], jobs: {} },
  }).errors;
  assert.ok(errors.some((error) => RUNS_ON_PUSH.test(error)));
  assert.match(
    pushConflicts({ branches: ['issue-42-*'] }).join(),
    /\(for example issue-42-[a-z0-9]+\)/,
  );
});
