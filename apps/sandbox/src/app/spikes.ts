import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface SpikeMeta {
  title: string;
  description?: string;
}

interface SpikeModule {
  default: ComponentType;
  meta?: SpikeMeta;
}

export interface Spike {
  slug: string;
  meta: SpikeMeta;
  Component: LazyExoticComponent<ComponentType>;
}

// Every folder in src/spikes/ with an index.tsx becomes a route: /<folder-name>.
// Metadata is read eagerly (cheap); the component itself is lazy-loaded.
const loaders = import.meta.glob<SpikeModule>('../spikes/*/index.tsx');
const metas = import.meta.glob<SpikeMeta | undefined>('../spikes/*/index.tsx', {
  eager: true,
  import: 'meta',
});

const slugOf = (path: string) => path.split('/').at(-2) ?? path;

export const spikes: Spike[] = Object.entries(loaders)
  .map(([path, load]) => {
    const slug = slugOf(path);
    return {
      slug,
      meta: metas[path] ?? { title: slug },
      Component: lazy(load),
    };
  })
  // Newest first: folder names start with yyyy-mm.
  .sort((a, b) => b.slug.localeCompare(a.slug));
