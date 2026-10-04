import { describe, expect, it } from 'vitest';
import { gatingAdvisories, parseAudit } from './audit.mjs';

const advisory = (overrides = {}) => ({
  github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
  severity: 'high',
  module_name: 'left-pad',
  title: 'Prototype pollution',
  findings: [{ paths: ['.>left-pad'] }],
  ...overrides,
});
const report = (advisories, vulnerabilities = {}) =>
  JSON.stringify({ advisories, metadata: { vulnerabilities } });

describe('D1/D2: parseAudit', () => {
  it('reads advisories', () => {
    expect(parseAudit(report({ 1: advisory() }, { high: 1 }))).toEqual([
      {
        id: 'GHSA-aaaa-bbbb-cccc',
        severity: 'high',
        module: 'left-pad',
        title: 'Prototype pollution',
        paths: ['.>left-pad'],
      },
    ]);
  });

  it('accepts a clean report', () => {
    expect(parseAudit(report({}, { high: 0, critical: 0 }))).toEqual([]);
  });

  it('throws on pnpm error output instead of reporting "no advisories"', () => {
    const error = JSON.stringify({
      error: { code: 'pnpm', message: 'fetch failed' },
    });
    expect(() => parseAudit(error)).toThrow(/pnpm audit failed: fetch failed/);
  });

  it('throws when there is no advisories object', () => {
    expect(() => parseAudit('{}')).toThrow(/no "advisories" object/);
  });

  it('throws when the summary counts vulnerabilities the list does not show', () => {
    expect(() => parseAudit(report({}, { critical: 2 }))).toThrow(
      /counts 2 high\/critical/,
    );
  });
});

describe('gatingAdvisories', () => {
  it('keeps high and critical, minus excepted ids', () => {
    const list = parseAudit(
      report({
        1: advisory(),
        2: advisory({ github_advisory_id: 'GHSA-x', severity: 'critical' }),
        3: advisory({ github_advisory_id: 'GHSA-y', severity: 'moderate' }),
      }),
    );
    expect(
      gatingAdvisories(list, new Set(['GHSA-x'])).map((a) => a.id),
    ).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });
});
