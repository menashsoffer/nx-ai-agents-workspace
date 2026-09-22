import { defineConfig, type Plugin } from 'vite';
import { defineAppConfig } from '@starter/vite-config';

const SPIKE_ENTRY = /\/src\/spikes\/[^/]+\/index\.tsx$/;

/**
 * Fails the build when a spike's component is bundled into the entry chunk
 * instead of its own lazily loaded chunk (e.g. because something imported
 * index.tsx statically). meta.ts files may be eager; components may not.
 */
function spikesMustBeLazy(): Plugin {
  return {
    name: 'sandbox-spikes-must-be-lazy',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        const eager = chunk.moduleIds.filter((id) => SPIKE_ENTRY.test(id));
        if (eager.length) {
          this.error(
            `Spike components must be lazy-loaded, but these ended up in the entry chunk:\n  ${eager.join('\n  ')}\nOnly import a spike's meta.ts eagerly.`,
          );
        }
      }
    },
  };
}

const config = defineAppConfig(import.meta.dirname, { port: 4201 });
config.plugins = [...(config.plugins ?? []), spikesMustBeLazy()];

export default defineConfig(config);
