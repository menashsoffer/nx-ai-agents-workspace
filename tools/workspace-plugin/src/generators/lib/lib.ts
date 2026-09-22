import { formatFiles, names, type Tree } from '@nx/devkit';
import { libraryGenerator as jsLibraryGenerator } from '@nx/js';
import { libraryGenerator as reactLibraryGenerator } from '@nx/react';
import { addDomLib, getScope, installAndSync } from '../../utils/workspace';
import type { LibGeneratorSchema } from './schema';

/**
 * Where a library lives and what it is called:
 *   shared util  -> libs/shared/<name>, project "shared-<name>"
 *   anything else -> libs/<name>,       project "<name>"
 */
export function libLocation(name: string, type: string, scope: string) {
  return type === 'util' && scope === 'shared'
    ? { directory: `libs/shared/${name}`, projectName: `shared-${name}` }
    : { directory: `libs/${name}`, projectName: name };
}

export async function libGenerator(tree: Tree, options: LibGeneratorSchema) {
  const name = names(options.name).fileName;
  const type = options.type ?? 'util';
  const scope = options.scope ?? 'shared';
  const { directory, projectName } = libLocation(name, type, scope);
  const common = {
    directory,
    name: projectName,
    importPath: `${getScope(tree)}/${projectName}`,
    tags: `type:${type},scope:${scope}`,
    bundler: 'none' as const,
    linter: 'eslint' as const,
    unitTestRunner: 'vitest' as const,
    skipFormat: true,
    useProjectJson: false,
  };

  if (type === 'util') {
    await jsLibraryGenerator(tree, common);
    // Placeholder source from Nx; the lib starts empty instead.
    for (const file of [
      `${directory}/src/lib/${projectName}.ts`,
      `${directory}/src/lib/${projectName}.spec.ts`,
    ]) {
      if (tree.exists(file)) tree.delete(file);
    }
  } else {
    await reactLibraryGenerator(tree, {
      ...common,
      style: 'css',
      component: false,
    });
    for (const tsconfig of ['tsconfig.lib.json', 'tsconfig.spec.json']) {
      addDomLib(tree, `${directory}/${tsconfig}`);
    }
    if (tree.exists(`${directory}/.babelrc`))
      tree.delete(`${directory}/.babelrc`);
  }

  // A brand-new lib has no tests yet; don't fail `verify` because of that.
  for (const config of ['vitest.config.mts', 'vite.config.mts']) {
    const path = `${directory}/${config}`;
    const content = tree.exists(path) ? tree.read(path, 'utf-8') : null;
    if (content && !content.includes('passWithNoTests')) {
      tree.write(
        path,
        content.replace(
          'watch: false,',
          'watch: false,\n    passWithNoTests: true,',
        ),
      );
    }
  }

  tree.write(
    `${directory}/src/index.ts`,
    `// Public API of ${common.importPath}. Export everything consumers may use.\nexport {};\n`,
  );

  await formatFiles(tree);
  return installAndSync(tree);
}

export default libGenerator;
