import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { observeVitals } from '../vitals.ts';
import type { VitalReport } from '../vitals-model.ts';
class Observer implements PerformanceObserver {
  static supportedEntryTypes = ['largest-contentful-paint', 'event', 'layout-shift'];
  static instances: Observer[] = [];
  options: PerformanceObserverInit | undefined;
  records: PerformanceEntry[] = [];
  disconnected = false;
  callback: PerformanceObserverCallback;
  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback;
    Observer.instances.push(this);
  }
  observe(options?: PerformanceObserverInit): void {
    this.options = options;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  takeRecords(): PerformanceEntry[] {
    const entries = this.records;
    this.records = [];
    return entries;
  }
}
function fixture(visible = 'visible') {
  Observer.instances = [];
  const doc = Object.assign(new EventTarget(), { visibilityState: visible });
  const win = Object.assign(new EventTarget(), {
    document: doc,
    performance: { interactionCount: 0 },
  });
  return { doc, win, window: win as unknown as Window };
}
function entry(
  values: Partial<PerformanceEntry> & {
    interactionId?: number;
    value?: number;
    hadRecentInput?: boolean;
  },
): PerformanceEntry {
  return { name: '', entryType: '', startTime: 0, duration: 0, toJSON: () => ({}), ...values };
}
describe('PerformanceObserver lifecycle', () => {
  it('uses buffered observers, drains queued entries on hiding and avoids duplicate observations', () => {
    const { doc, win, window } = fixture();
    win.performance.interactionCount = 1;
    const sent: VitalReport[] = [];
    let flushed = 0;
    const stop = observeVitals(
      window,
      (event) => {
        sent.push(event);
      },
      {
        Observer,
        flush: () => {
          flushed++;
        },
      },
    );
    for (const observer of Observer.instances) assert.equal(observer.options?.buffered, true);
    const lcp = Observer.instances.find((o) => o.options?.type === 'largest-contentful-paint');
    const inp = Observer.instances.find((o) => o.options?.type === 'event');
    const cls = Observer.instances.find((o) => o.options?.type === 'layout-shift');
    assert.ok(lcp && inp && cls);
    assert.equal(
      (inp.options as PerformanceObserverInit & { durationThreshold: number }).durationThreshold,
      16,
    );
    lcp.records = [
      Object.assign(entry({ startTime: 1400 }), {
        url: 'https://private.test/name',
        element: { id: 'private-id' },
      }),
    ];
    inp.records = [entry({ interactionId: 7, duration: 180 })];
    cls.records = [entry({ startTime: 100, value: 0.05, hadRecentInput: false })];
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(
      sent.map((v) => [v.name, v.value]),
      [
        ['CLS', 0.05],
        ['LCP', 1400],
        ['INP', 180],
      ],
    );
    win.dispatchEvent(new Event('pagehide'));
    assert.equal(sent.length, 3);
    assert.equal(flushed, 2);
    assert.doesNotMatch(JSON.stringify(sent), /private|url|element|interactionId/);
    stop();
    assert.ok(Observer.instances.every((o) => o.disconnected));
    win.dispatchEvent(new Event('pagehide'));
    assert.equal(flushed, 2);
  });
  it('flushes recovery events when measurement is unsupported, without inventing zero metrics', () => {
    const { doc, window } = fixture();
    const sent: VitalReport[] = [];
    let flushed = 0;
    const stop = observeVitals(
      window,
      (e) => {
        sent.push(e);
      },
      {
        Observer: null,
        flush: () => {
          flushed++;
        },
      },
    );
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(sent, []);
    assert.equal(flushed, 1);
    stop();
  });
  it('does not report a never-visible document and tolerates partial browser implementations', () => {
    const { doc, window } = fixture('hidden');
    const sent: VitalReport[] = [];
    let flushed = 0;
    class PartialObserver extends Observer {
      override observe(): void {
        throw Error('unsupported');
      }
    }
    const stop = observeVitals(
      window,
      (e) => {
        sent.push(e);
      },
      {
        Observer: PartialObserver,
        flush: () => {
          flushed++;
        },
      },
    );
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(flushed, 0);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(sent, []);
    assert.equal(flushed, 1);
    assert.ok(Observer.instances.every((o) => o.disconnected));
    stop();
  });
});
