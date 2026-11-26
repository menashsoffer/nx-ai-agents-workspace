import { createVitalsModel, type VitalReport } from './vitals-model.ts';
interface Timing extends PerformanceEntry {
  interactionId?: number;
  value?: number;
  hadRecentInput?: boolean;
}
interface Options {
  Observer?: typeof PerformanceObserver | null;
  flush: () => void;
}
const TYPES = { LCP: 'largest-contentful-paint', INP: 'event', CLS: 'layout-shift' };
type Model = ReturnType<typeof createVitalsModel>;
function consume(model: Model, type: string, entries: PerformanceEntry[]): void {
  for (const entry of entries) {
    const timing = entry as Timing;
    if (type === TYPES.LCP) model.lcp(entry.startTime);
    if (type === TYPES.INP && timing.interactionId !== undefined)
      model.interaction(timing.interactionId, entry.duration);
    if (type === TYPES.CLS && timing.value !== undefined)
      model.shift(entry.startTime, timing.value, timing.hadRecentInput === true);
  }
}
function readers(Observer: typeof PerformanceObserver | null, model: Model) {
  const observers = new Map<PerformanceObserver, string>();
  if (!Observer) return observers;
  for (const type of Object.values(TYPES)) {
    if (!Observer.supportedEntryTypes.includes(type)) continue;
    let observer: PerformanceObserver | undefined;
    try {
      observer = new Observer((list) => {
        consume(model, type, list.getEntries());
      });
      observer.observe({
        type,
        buffered: true,
        ...(type === TYPES.INP ? { durationThreshold: 16 } : {}),
      });
      observers.set(observer, type);
    } catch {
      observer?.disconnect();
    }
  }
  return observers;
}
function lifecycle(win: Window, publish: () => void, disconnect: () => void): () => void {
  let viewed = win.document.visibilityState !== 'hidden';
  const hide = () => {
    if (viewed) publish();
  };
  const visibility = () => {
    if (win.document.visibilityState === 'visible') viewed = true;
    else hide();
  };
  win.document.addEventListener('visibilitychange', visibility);
  win.addEventListener('pagehide', hide);
  return () => {
    disconnect();
    win.document.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('pagehide', hide);
  };
}
/** Document-level CWV. Entry DOM metadata and route URLs are never sent. */
export function observeVitals(
  win: Window,
  send: (event: VitalReport) => void,
  options: Options,
): () => void {
  const Observer =
    options.Observer === undefined
      ? typeof PerformanceObserver === 'undefined'
        ? null
        : PerformanceObserver
      : options.Observer;
  const model = createVitalsModel(),
    observers = readers(Observer, model);
  const supported = new Set(observers.values()),
    previous = new Map<string, string>();
  return lifecycle(
    win,
    () => {
      for (const [observer, type] of observers) consume(model, type, observer.takeRecords());
      const raw = (win.performance as Performance & { interactionCount?: number }).interactionCount;
      const count = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
      for (const report of model.reports(count)) {
        const key = JSON.stringify(report);
        if (supported.has(TYPES[report.name]) && previous.get(report.name) !== key) {
          previous.set(report.name, key);
          send(report);
        }
      }
      options.flush();
    },
    () => {
      for (const observer of observers.keys()) observer.disconnect();
    },
  );
}
