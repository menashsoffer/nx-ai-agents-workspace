import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { SpikeMeta } from './spike-types';

export type { SpikeMeta } from './spike-types';

export interface Spike {
  slug: string;
  meta: SpikeMeta;
  Component: LazyExoticComponent<ComponentType>;
}

type Loader = () => Promise<{ default: ComponentType }>;

const slugOf = (path: string) => path.split('/').at(-2) ?? path;

/**
 * Pairs each spike folder's metadata with its lazily loaded component.
 * Newest first: folder names start with yyyy-mm.
 */
export function collectSpikes(
  metas: Record<string, SpikeMeta>,
  loaders: Record<string, Loader>,
): Spike[] {
  return Object.entries(loaders)
    .map(([path, load]) => {
      const slug = slugOf(path);
      const metaPath = Object.keys(metas).find((p) => slugOf(p) === slug);
      return {
        slug,
        meta: (metaPath && metas[metaPath]) || { title: slug },
        Component: lazy(load),
      };
    })
    .sort((a, b) => b.slug.localeCompare(a.slug));
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
