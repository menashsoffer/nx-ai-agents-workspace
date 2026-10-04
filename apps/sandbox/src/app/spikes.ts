import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { SpikeMeta } from './spike-types';

export type { SpikeMeta } from './spike-types';

export interface Spike {
  slug: string;
  meta: SpikeMeta;
  Component: LazyExoticComponent<ComponentType>;
}

type SpikeLoader = () => Promise<{ default: ComponentType }>;

const getSpikeSlug = (path: string) => path.split('/').at(-2) ?? path;

/**
 * Pairs each spike folder's metadata with its lazily loaded component.
 * Newest first: folder names start with yyyy-mm.
 */
export function collectSpikes(
  spikeMetasByPath: Record<string, SpikeMeta>,
  spikeLoadersByPath: Record<string, SpikeLoader>,
): Spike[] {
  return Object.entries(spikeLoadersByPath)
    .map(([path, loadSpike]) => {
      const slug = getSpikeSlug(path);
      const metaPath = Object.keys(spikeMetasByPath).find(
        (candidatePath) => getSpikeSlug(candidatePath) === slug,
      );
      return {
        slug,
        meta: (metaPath && spikeMetasByPath[metaPath]) || { title: slug },
        Component: lazy(loadSpike),
      };
    })
    .sort((first, second) => second.slug.localeCompare(first.slug));
}

// Every src/spikes/<folder>/ becomes a route: /<folder>.
// meta.ts is small and read eagerly for the index; index.tsx (the spike
// itself) is only loaded when opened. vite.config.mts fails the build if a
// spike ends up in the main chunk.
export const spikes = collectSpikes(
  import.meta.glob<SpikeMeta>('../spikes/*/meta.ts', {
    eager: true,
    import: 'meta',
  }),
  import.meta.glob<{ default: ComponentType }>('../spikes/*/index.tsx'),
);
