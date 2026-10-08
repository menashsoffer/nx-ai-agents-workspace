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

/** Duck-types Nx's `ProjectGraphError`, whose `getErrors()` returns the inner errors. */
interface GraphErrorLike {
  getErrors: () => unknown[];
}

function hasGetErrors(error: unknown): error is GraphErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { getErrors?: unknown }).getErrors === 'function'
  );
}

/**
 * Collects every real error message found in `error`, descending into
 * `AggregateError.errors` instead of stopping at an aggregate's own
 * `.message` (which Nx sometimes leaves empty, hiding the real inner error).
 * Keeps a non-empty aggregate message alongside its inner messages.
 */
function collectErrorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    const innerMessages = error.errors.flatMap((innerError) =>
      collectErrorMessages(innerError),
    );
    return error.message ? [error.message, ...innerMessages] : innerMessages;
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return [String(error)];
}

/**
 * Nx wraps a failed project-graph build in `ProjectGraphError`, whose top-level
 * message ("Failed to process project graph.") hides the real inner errors
 * behind `getErrors()` — and those inner errors can themselves be an
 * `AggregateError` with an empty `.message` nesting the real error. Duck-type
 * the caught error for `getErrors` and recursively append every real message
 * before rethrowing, so a recurrence is diagnosable in CI logs.
 */
export async function runWithGraphErrorDetails<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && hasGetErrors(error)) {
      const innerMessages = error
        .getErrors()
        .flatMap((innerError) => collectErrorMessages(innerError));
      error.message = [error.message, ...innerMessages].join('\n');
    }
    throw error;
  }
}
