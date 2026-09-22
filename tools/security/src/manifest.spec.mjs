import { describe, expect, it } from 'vitest';
import { loadManifest } from './fetch-tool.mjs';
import { validateManifest } from './manifest.mjs';

describe('tools.json', () => {
  const manifest = loadManifest();

  it('pins actionlint, gitleaks and zizmor for every supported platform', () => {
    expect(Object.keys(manifest.tools).sort()).toEqual([
      'actionlint',
      'gitleaks',
      'zizmor',
    ]);
    const reviewedDay = new Date(`${manifest.reviewed}T00:00:00Z`);
    expect(validateManifest(manifest, reviewedDay)).toEqual([]);
  });

  it('fails once the last review is older than 120 days', () => {
    const later = new Date(
      Date.parse(`${manifest.reviewed}T00:00:00Z`) + 121 * 86_400_000,
    );
    expect(validateManifest(manifest, later).join('\n')).toMatch(/limit 120/);
  });

  it('reports a missing platform build', () => {
    const broken = structuredClone(manifest);
    delete broken.tools.zizmor.platforms['linux-arm64'];
    const reviewedDay = new Date(`${manifest.reviewed}T00:00:00Z`);
    expect(validateManifest(broken, reviewedDay)).toEqual([
      'zizmor: missing linux-arm64 build.',
    ]);
  });
});
