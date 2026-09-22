import { formatFiles, generateFiles, names, type Tree } from '@nx/devkit';
import { applicationGenerator } from '@nx/react';
import { join } from 'node:path';
import {
  addDomLib,
  addWorkspaceDeps,
  deleteAll,
  getScope,
  installAndSync,
} from '../../utils/workspace';
import type { AppGeneratorSchema } from './schema';

const FIRST_PORT = 4200;

/** Next free dev port, based on the ports in existing apps' vite configs. */
function nextPort(tree: Tree): number {
  const used = tree
    .children('apps')
    .map((app) => `apps/${app}/vite.config.mts`)
    .filter((path) => tree.exists(path))
    .map((path) => /port:\s*(\d+)/.exec(tree.read(path, 'utf-8') ?? '')?.[1])
    .filter((port): port is string => !!port)
    .map(Number);
  return used.length ? Math.max(...used) + 1 : FIRST_PORT;
}

export async function appGenerator(tree: Tree, options: AppGeneratorSchema) {
  const { fileName: name, className } = names(options.name);
  const scope = getScope(tree);
  const projectRoot = `apps/${name}`;
  const port = options.port ?? nextPort(tree);

  await applicationGenerator(tree, {
    directory: projectRoot,
    name,
    bundler: 'vite',
    style: 'css',
    // The shell below brings its own react-router setup; `routing: true` would
    // add the legacy react-router-dom package.
    routing: false,
    linter: 'eslint',
    unitTestRunner: 'vitest',
    e2eTestRunner: 'none',
    tags: `type:app,scope:${options.scope ?? 'dev'}`,
    skipFormat: true,
    useProjectJson: false,
  });

  // Replace Nx's welcome app with the workspace's app shell.
  deleteAll(tree, [
    `${projectRoot}/src/app/app.tsx`,
    `${projectRoot}/src/app/app.spec.tsx`,
    `${projectRoot}/src/app/app.module.css`,
    `${projectRoot}/src/app/nx-welcome.tsx`,
    `${projectRoot}/src/assets/.gitkeep`,
  ]);
  generateFiles(tree, join(__dirname, 'files'), projectRoot, {
    scope,
    port,
    title: className,
  });

  // Only what the generated shell uses (knip flags unused dependencies).
  addWorkspaceDeps(tree, `${projectRoot}/package.json`, {
    dependencies: [`${scope}/ui`],
    devDependencies: [`${scope}/vite-config`],
  });
  addDomLib(tree, `${projectRoot}/tsconfig.app.json`);
  addDomLib(tree, `${projectRoot}/tsconfig.spec.json`);

  await formatFiles(tree);
  return installAndSync(tree);
}

export default appGenerator;
