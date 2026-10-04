import { resolve } from 'node:path';
import {
  COUNT_CASES,
  PROBLEM_CASES,
  REGISTRY_CASES,
  SCOPE_CASES,
  TODAY,
} from './file-length-audit.cases.js';
import {
  countPhysicalLines,
  findFileLengthProblems,
  isLengthChecked,
  measureCommittedFiles,
  readRegistry,
  validateRegistry,
} from './file-length-audit.scanner.js';

const workspaceRoot = resolve(import.meta.dirname, '../../../../..');

describe('countPhysicalLines', () => {
  it.each(COUNT_CASES)('%s', (_description, text, lineCount) => {
    expect(countPhysicalLines(text)).toBe(lineCount);
  });
});

describe('isLengthChecked', () => {
  it.each(SCOPE_CASES)('%s -> %s', (path, isChecked) => {
    expect(isLengthChecked(path)).toBe(isChecked);
  });
});

describe('validateRegistry', () => {
  it.each(REGISTRY_CASES)('%s', (_description, entries, expectedProblems) => {
    const problems = validateRegistry(entries, TODAY);
    expect(problems).toHaveLength(expectedProblems.length);
    expectedProblems.forEach((expected, index) => {
      expect(problems[index]).toContain(expected);
    });
  });
});

describe('findFileLengthProblems', () => {
  it.each(PROBLEM_CASES)(
    '%s',
    (_description, files, registry, expectedProblems) => {
      const problems = findFileLengthProblems(files, registry);
      expect(problems).toHaveLength(expectedProblems.length);
      expectedProblems.forEach((expected, index) => {
        expect(problems[index]).toContain(expected);
      });
    },
  );
});

// The real check: every committed source, test, docs and workflow file is at
// most the hard cap long, unless the owner listed it (and the list is valid and
// has no entry that is no longer needed).
describe('the repository', () => {
  it('has a valid exception registry', () => {
    expect(validateRegistry(readRegistry(workspaceRoot), new Date())).toEqual(
      [],
    );
  });

  it('keeps every committed file within the hard cap or in the registry', () => {
    const registry = readRegistry(workspaceRoot) as Parameters<
      typeof findFileLengthProblems
    >[1];
    const files = measureCommittedFiles(workspaceRoot);

    expect(files.length).toBeGreaterThan(0);
    expect(findFileLengthProblems(files, registry)).toEqual([]);
  });
});
