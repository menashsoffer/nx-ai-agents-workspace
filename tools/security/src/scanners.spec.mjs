import { describe, expect, it, vi } from 'vitest';
import { MANIFEST_BLOCKED, runScanners } from './scanners.mjs';

const base = {
  manifest: { tools: {} },
  platformKey: 'linux-x64',
  cwd: '/repo',
  online: false,
};

describe('runScanners', () => {
  it('downloads and runs nothing when the manifest has problems', () => {
    const ensure = vi.fn();
    const spawn = vi.fn();
    const results = runScanners({
      ...base,
      manifestProblems: ['zizmor linux-x64: url must be https.'],
      ensure,
      spawn,
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(results).toEqual([
      { label: 'Binary scanners', problems: [MANIFEST_BLOCKED] },
    ]);
  });

  it('runs every scanner from a valid manifest and reports exit codes', () => {
    const ensure = vi.fn((tool) => `/bin/${tool}`);
    const spawn = vi.fn((binary) => ({
      status: binary === '/bin/zizmor' ? 1 : 0,
    }));
    const results = runScanners({
      ...base,
      manifestProblems: [],
      ensure,
      spawn,
    });
    expect(ensure.mock.calls.map(([tool]) => tool)).toEqual([
      'actionlint',
      'zizmor',
      'gitleaks',
    ]);
    expect(results.map((r) => r.problems)).toEqual([
      [],
      ['zizmor exited with 1'],
      [],
    ]);
  });

  it('fails a scanner whose download is refused, without running it', () => {
    const ensure = vi.fn((tool) => {
      if (tool === 'gitleaks') throw new Error('url must be https');
      return `/bin/${tool}`;
    });
    const spawn = vi.fn(() => ({ status: 0 }));
    const results = runScanners({
      ...base,
      manifestProblems: [],
      ensure,
      spawn,
    });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(results[2].problems).toEqual([
      'gitleaks NOT run: url must be https',
    ]);
  });
});
