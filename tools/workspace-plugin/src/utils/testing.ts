import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { writeJson, type Tree } from '@nx/devkit';

/** An in-memory workspace shaped like this repo: pnpm workspaces + TS project references. */
export function createTestWorkspace(): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'prettier' });
  writeJson(tree, 'package.json', { name: '@acme/source', private: true });
  tree.write(
    'pnpm-workspace.yaml',
    'packages:\n  - "apps/*"\n  - "libs/*"\n  - "libs/*/*"\n  - "tools/*"\n',
  );
  writeJson(tree, 'tsconfig.base.json', {
    compilerOptions: { composite: true, declaration: true },
  });
  writeJson(tree, 'tsconfig.json', {
    extends: './tsconfig.base.json',
    files: [],
    references: [],
  });
  return tree;
}
