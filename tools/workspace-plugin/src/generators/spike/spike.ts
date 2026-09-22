import { formatFiles, generateFiles, names, type Tree } from '@nx/devkit';
import { join } from 'node:path';
import type { SpikeGeneratorSchema } from './schema';

export const SPIKES_DIR = 'apps/sandbox/src/spikes';

export async function spikeGenerator(
  tree: Tree,
  options: SpikeGeneratorSchema,
) {
  const { fileName, className } = names(options.name);
  const date = options.date ?? new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const folder = `${month}-${fileName}`;

  if (tree.exists(`${SPIKES_DIR}/${folder}`)) {
    throw new Error(`${SPIKES_DIR}/${folder} already exists.`);
  }

  generateFiles(tree, join(__dirname, 'files'), SPIKES_DIR, {
    folder,
    className,
    title: fileName.replace(/-/g, ' '),
  });

  await formatFiles(tree);
}

export default spikeGenerator;
