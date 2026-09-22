import { createTestWorkspace } from '../../utils/testing';
import { readJson, readProjectConfiguration, type Tree } from '@nx/devkit';
import { appGenerator } from './app';

describe('app generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTestWorkspace();
    tree.write(
      'apps/site/vite.config.mts',
      'defineAppConfig(import.meta.dirname, { port: 4200 })',
    );
  });

  it('creates a tagged RTL app on the next free port', async () => {
    await appGenerator(tree, { name: 'admin-panel' });

    const config = readProjectConfiguration(tree, 'admin-panel');
    expect(config.root).toBe('apps/admin-panel');
    expect(config.tags).toEqual(['type:app', 'scope:dev']);
    expect(tree.exists('apps/admin-panel/project.json')).toBe(false);

    expect(tree.read('apps/admin-panel/vite.config.mts', 'utf-8')).toContain(
      'port: 4201',
    );
    expect(tree.read('apps/admin-panel/index.html', 'utf-8')).toContain(
      'dir="rtl"',
    );
    expect(tree.exists('apps/admin-panel/src/app/nx-welcome.tsx')).toBe(false);

    const pkg = readJson(tree, 'apps/admin-panel/package.json');
    expect(pkg.dependencies['@acme/ui']).toBe('workspace:*');
  });

  it('supports product scope', async () => {
    await appGenerator(tree, { name: 'shop', scope: 'product' });
    expect(readProjectConfiguration(tree, 'shop').tags).toContain(
      'scope:product',
    );
  });
});
