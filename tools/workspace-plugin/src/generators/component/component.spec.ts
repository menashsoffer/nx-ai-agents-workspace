import { createTestWorkspace } from '../../utils/testing';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { componentGenerator } from './component';

describe('component generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTestWorkspace();
    addProjectConfiguration(tree, 'ui', { root: 'libs/ui' });
    tree.write('libs/ui/.storybook/main.ts', '');
    tree.write(
      'libs/ui/src/index.ts',
      "export * from './lib/button/Button';\n",
    );
  });

  it('creates component, story and spec, and exports it', async () => {
    await componentGenerator(tree, { name: 'date-picker' });

    expect(tree.exists('libs/ui/src/lib/date-picker/DatePicker.tsx')).toBe(
      true,
    );
    expect(
      tree.exists('libs/ui/src/lib/date-picker/DatePicker.stories.tsx'),
    ).toBe(true);
    expect(tree.exists('libs/ui/src/lib/date-picker/DatePicker.spec.tsx')).toBe(
      true,
    );
    expect(
      tree.read('libs/ui/src/lib/date-picker/DatePicker.tsx', 'utf-8'),
    ).toContain("from '@acme/shared-utils'");
    expect(tree.read('libs/ui/src/index.ts', 'utf-8')).toContain(
      "export * from './lib/date-picker/DatePicker';",
    );
  });

  it('skips the story when the project has no Storybook', async () => {
    addProjectConfiguration(tree, 'booking', { root: 'libs/booking' });
    tree.write('libs/booking/src/index.ts', 'export {};\n');

    await componentGenerator(tree, { name: 'slot-list', project: 'booking' });

    expect(
      tree.exists('libs/booking/src/lib/slot-list/SlotList.stories.tsx'),
    ).toBe(false);
    expect(tree.read('libs/booking/src/index.ts', 'utf-8')).not.toContain(
      'export {}',
    );
  });
});
