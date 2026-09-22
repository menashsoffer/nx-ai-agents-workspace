import { formatFiles, generateFiles, names, type Tree } from '@nx/devkit';
import { join } from 'node:path';
import type { SpikeGeneratorSchema } from './schema';

export const SANDBOX_ROOT = 'apps/sandbox';
export const SPIKES_DIR = `${SANDBOX_ROOT}/src/spikes`;

export async function spikeGenerator(
  tree: Tree,
  options: SpikeGeneratorSchema,
) {
  if (!tree.exists(`${SANDBOX_ROOT}/package.json`)) {
    throw new Error(
      `No sandbox app: ${SANDBOX_ROOT} does not exist. Spikes live in the sandbox app; restore it or run the experiment elsewhere.`,
    );
  }

  const { fileName, className } = names(options.name);
  const date = options.date ?? new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const folder = `${month}-${fileName}`;

  // Same slug in any month counts as a duplicate: routes are per folder, but
  // two spikes answering the same question should be one spike.
  const existing = tree.exists(SPIKES_DIR)
    ? tree.children(SPIKES_DIR).find((dir) => dir.slice(8) === fileName)
    : undefined;
  if (existing) {
    throw new Error(
      `A spike named "${fileName}" already exists: ${SPIKES_DIR}/${existing}`,
    );
  }

  generateFiles(tree, join(__dirname, 'files'), SPIKES_DIR, {
    folder,
    className,
    title: fileName.replace(/-/g, ' '),
  });

  await formatFiles(tree);
}

export default spikeGenerator;
