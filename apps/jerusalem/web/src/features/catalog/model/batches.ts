import { yieldToMain } from '../../../render-chunks.ts';
export const BATCH_SIZE = 100;
/** A component owns one instance per result set; unmount invalidates every pending task. */
export function createBatches(total: number, yieldTask = yieldToMain) {
  let count = Math.min(total, BATCH_SIZE),
    generation = 0;
  const listeners = new Set<() => void>();
  async function remaining(run: number) {
    while (count < total) {
      await yieldTask();
      if (run !== generation) return;
      count = Math.min(total, count + BATCH_SIZE);
      for (const notify of listeners) notify();
    }
  }
  return {
    getSnapshot: () => count,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount: () => {
      const run = ++generation;
      void remaining(run);
      return () => {
        ++generation;
      };
    },
  };
}
