import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CSS_CASES,
  FIXTURE_CASES,
  PLANTED_CASES,
  SYNTAX_CASES,
} from './routing-paths.cases';
import {
  findRoutingPathViolations,
  findTreeViolations,
} from './routing-paths.scanner';

describe('findRoutingPathViolations', () => {
  it.each(FIXTURE_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.tsx', content)).toHaveLength(
      violationCount,
    );
  });
});

describe('findRoutingPathViolations: syntax the scanner must read', () => {
  it.each(SYNTAX_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.tsx', content)).toHaveLength(
      violationCount,
    );
  });
});

describe('findRoutingPathViolations: CSS files', () => {
  it.each(CSS_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.css', content)).toHaveLength(
      violationCount,
    );
  });
});

describe('a file planted in the real source tree', () => {
  let plantedDirectory: string | undefined;

  afterEach(() => {
    if (plantedDirectory)
      rmSync(plantedDirectory, { recursive: true, force: true });
    plantedDirectory = undefined;
  });

  it.each(PLANTED_CASES)(
    '%s',
    (_description, fileName, content, violationCount) => {
      plantedDirectory = mkdtempSync(join(import.meta.dirname, 'planted-'));
      writeFileSync(join(plantedDirectory, fileName), content);

      const plantedViolations = findTreeViolations(import.meta.dirname).filter(
        (violation) => violation.includes(plantedDirectory as string),
      );

      expect(plantedViolations).toHaveLength(violationCount);
    },
  );
});

describe('apps/site/src', () => {
  it('has no routing-path violations', () => {
    expect(findTreeViolations(import.meta.dirname)).toEqual([]);
  });
});
