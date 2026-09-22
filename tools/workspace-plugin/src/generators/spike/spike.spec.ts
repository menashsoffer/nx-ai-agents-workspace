import { createTestWorkspace } from '../../utils/testing';
import type { Tree } from '@nx/devkit';
import { spikeGenerator } from './spike';

describe('spike generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTestWorkspace();
  });

  it('creates a dated spike folder in the sandbox', async () => {
    await spikeGenerator(tree, {
      name: 'hebrew-fonts',
      date: new Date(2026, 8, 22),
    });

    const file = 'apps/sandbox/src/spikes/2026-09-hebrew-fonts/index.tsx';
    expect(tree.exists(file)).toBe(true);
    expect(tree.read(file, 'utf-8')).toContain('HebrewFontsSpike');
  });
});
