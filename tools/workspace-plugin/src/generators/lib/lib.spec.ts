import { createTestWorkspace } from '../../utils/testing';
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { libGenerator } from './lib';

describe('lib generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTestWorkspace();
  });

  it('puts shared utils under libs/shared with a prefixed name', async () => {
    await libGenerator(tree, { name: 'dates', type: 'util' });

    const config = readProjectConfiguration(tree, 'shared-dates');
    expect(config.root).toBe('libs/shared/dates');
    expect(config.tags).toEqual(['type:util', 'scope:shared']);
    expect(tree.exists('libs/shared/dates/src/lib/shared-dates.ts')).toBe(
      false,
    );
  });

  it('creates feature libs under libs/ with DOM types', async () => {
    await libGenerator(tree, {
      name: 'booking',
      type: 'feature',
      scope: 'product',
    });

    const config = readProjectConfiguration(tree, 'booking');
    expect(config.root).toBe('libs/booking');
    expect(config.tags).toEqual(['type:feature', 'scope:product']);
    expect(tree.read('libs/booking/tsconfig.lib.json', 'utf-8')).toContain(
      '"dom"',
    );
  });

  it('creates ui libs with default shared scope, DOM types and no .babelrc', async () => {
    await libGenerator(tree, { name: 'widgets', type: 'ui' });

    const config = readProjectConfiguration(tree, 'widgets');
    expect(config.tags).toEqual(['type:ui', 'scope:shared']);
    expect(tree.read('libs/widgets/tsconfig.lib.json', 'utf-8')).toContain(
      '"dom"',
    );
    expect(tree.read('libs/widgets/tsconfig.spec.json', 'utf-8')).toContain(
      '"dom"',
    );
    expect(tree.exists('libs/widgets/.babelrc')).toBe(false);
  });
});
