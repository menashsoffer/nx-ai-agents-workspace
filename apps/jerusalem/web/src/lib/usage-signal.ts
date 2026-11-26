// What a screen tells the usage tracker (usage-analytics-spec-he.md 4.1). Both are no-ops
// until the tracker runs; neither sends anything the user typed.

/** The event a wizard dispatches on window when it shows a step, counted from 1. */
export const USAGE_STEP = 'usage-step';

export function reportStep(step: number): void {
  if (typeof dispatchEvent === 'function')
    dispatchEvent(new CustomEvent(USAGE_STEP, { detail: step }));
}

/**
 * Names a control for the usage dashboard, for spreading into a props object. In JSX, write
 * `data-usage="name"` directly. Names are fixed slugs, such as "catalog.search".
 */
export function usage(action: string): { 'data-usage': string } {
  return { 'data-usage': action };
}
