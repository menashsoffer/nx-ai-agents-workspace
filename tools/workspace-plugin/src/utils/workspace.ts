import { execSync } from 'node:child_process';
import { readJson, updateJson, type Tree } from '@nx/devkit';

/** npm scope of this workspace, e.g. "@acme" (from the root package name). */
export function getScope(tree: Tree): string {
  const { name } = readJson<{ name: string }>(tree, 'package.json');
  return name.split('/')[0];
}

type DepField = 'dependencies' | 'devDependencies';

/** Adds `workspace:*` dependencies on other workspace packages. */
export function addWorkspaceDeps(
  tree: Tree,
  packageJsonPath: string,
  deps: Partial<Record<DepField, string[]>>,
): void {
  updateJson(tree, packageJsonPath, (json) => {
    for (const field of Object.keys(deps) as DepField[]) {
      json[field] ??= {};
      for (const dep of deps[field] ?? []) json[field][dep] = 'workspace:*';
    }
    return json;
  });
}

/** Adds "dom" libs to a React project's tsconfig (the base config is DOM-free). */
export function addDomLib(tree: Tree, tsconfigPath: string): void {
  if (!tree.exists(tsconfigPath)) return;
  updateJson(tree, tsconfigPath, (json) => {
    json.compilerOptions ??= {};
    json.compilerOptions.lib = ['es2022', 'dom', 'dom.iterable'];
    return json;
  });
}

/** Deletes every path that exists; ignores the rest. */
export function deleteAll(tree: Tree, paths: string[]): void {
  for (const path of paths) if (tree.exists(path)) tree.delete(path);
}

/**
 * Post-generation callback: link new workspace packages and update TS project
 * references (`nx sync`), so the new project typechecks without extra steps.
 */
export function installAndSync(tree: Tree) {
  return () => {
    // Plain `pnpm install`: Nx's installPackagesTask skips when an earlier
    // generator in the same run already installed.
    execSync('pnpm install', { cwd: tree.root, stdio: 'inherit' });
    execSync('pnpm exec nx sync', { cwd: tree.root, stdio: 'inherit' });
  };
}
