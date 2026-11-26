export interface LoadTimings {
  request_ms: string;
  model_ms: string;
}
let sequence = 0;

/** Unique marks keep concurrent loads from overwriting one another's measurements. */
export function beginTiming(phase: string): () => number {
  const name = `catalog:${phase}:${String(++sequence)}`;
  performance.mark(`${name}:start`);
  return () => {
    performance.mark(`${name}:end`);
    const result = performance.measure(name, `${name}:start`, `${name}:end`).duration;
    performance.clearMarks(`${name}:start`);
    performance.clearMarks(`${name}:end`);
    performance.clearMeasures(name);
    return result;
  };
}
