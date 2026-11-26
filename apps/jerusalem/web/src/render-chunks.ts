interface Scheduler {
  yield?: () => Promise<void>;
}

/** Gives the browser a turn to handle input before the next batch of work. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: Scheduler }).scheduler;
  return typeof scheduler?.yield === 'function'
    ? scheduler.yield()
    : new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
}
