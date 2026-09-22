import { createTestWorkspace } from '../../utils/testing';
import type { Tree } from '@nx/devkit';
import { spikeGenerator } from './spike';

describe('spike generator', () => {
  let tree: Tree;
  const date = new Date(2026, 8, 22);

  beforeEach(() => {
    tree = createTestWorkspace();
    tree.write('apps/sandbox/package.json', '{"name":"@acme/sandbox"}');
  });

  it('creates a dated spike with separate meta.ts and lazy index.tsx', async () => {
    await spikeGenerator(tree, { name: 'hebrew-fonts', date });

    const dir = 'apps/sandbox/src/spikes/2026-09-hebrew-fonts';
    expect(tree.read(`${dir}/meta.ts`, 'utf-8')).toContain(
      "title: 'hebrew fonts'",
    );
    expect(tree.read(`${dir}/index.tsx`, 'utf-8')).toContain(
      'HebrewFontsSpike',
    );
    expect(tree.read(`${dir}/index.tsx`, 'utf-8')).not.toContain('meta');
  });

  it('rejects a duplicate spike name, even from another month', async () => {
    await spikeGenerator(tree, { name: 'probe', date });
    await expect(
      spikeGenerator(tree, { name: 'probe', date: new Date(2026, 9, 1) }),
    ).rejects.toThrow(/already exists/);
  });

  it('fails clearly when the sandbox app was removed', async () => {
    tree.delete('apps/sandbox/package.json');
    await expect(spikeGenerator(tree, { name: 'probe', date })).rejects.toThrow(
      /No sandbox app/,
    );
  });
});
