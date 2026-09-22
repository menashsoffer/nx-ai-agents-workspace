import {
  formatFiles,
  generateFiles,
  names,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { join } from 'node:path';
import {
  addWorkspaceDeps,
  getScope,
  installAndSync,
} from '../../utils/workspace';
import type { ComponentGeneratorSchema } from './schema';

export async function componentGenerator(
  tree: Tree,
  options: ComponentGeneratorSchema,
) {
  const { className, fileName } = names(options.name);
  const project = options.project ?? 'ui';
  const { root } = readProjectConfiguration(tree, project);
  const scope = getScope(tree);
  const target = `${root}/src/lib/${fileName}`;

  if (tree.exists(`${target}/${className}.tsx`)) {
    throw new Error(`${target}/${className}.tsx already exists.`);
  }

  generateFiles(tree, join(__dirname, 'files'), target, {
    className,
    scope,
  });
  if (!tree.exists(`${root}/.storybook`)) {
    tree.delete(`${target}/${className}.stories.tsx`);
  }

  // Export it from the library's public API.
  const indexPath = `${root}/src/index.ts`;
  const exportLine = `export * from './lib/${fileName}/${className}';\n`;
  const index = (tree.read(indexPath, 'utf-8') ?? '').replace(
    /^export \{\};\n?/m,
    '',
  );
  tree.write(indexPath, index + exportLine);

  // Generated components use cn() from shared-utils.
  const packageJson = `${root}/package.json`;
  const needsDep =
    project !== 'shared-utils' &&
    tree.exists(packageJson) &&
    !tree.read(packageJson, 'utf-8')?.includes(`"${scope}/shared-utils"`);
  if (needsDep) {
    addWorkspaceDeps(tree, packageJson, {
      dependencies: [`${scope}/shared-utils`],
    });
  }

  await formatFiles(tree);
  return needsDep ? installAndSync(tree) : undefined;
}

export default componentGenerator;
