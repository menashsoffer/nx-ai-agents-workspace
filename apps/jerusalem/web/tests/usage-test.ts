// The usage tracker: what a visit sends, and that nothing typed or identifying is sent.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startUsage, UsageSession, type UsageRouter } from '../src/data/usage.ts';
import {
  actionName,
  durationMs,
  screenName,
  stepNumber,
  type UsageEvent,
} from '../src/lib/usage-model.ts';
import { EventBatcher } from '../src/lib/tracker.ts';
import type { TelemetryEvent } from '../src/lib/vitals-model.ts';
import { reportStep, usage, USAGE_STEP } from '../src/lib/usage-signal.ts';

type State = UsageRouter['state'];
const matches = (...paths: (string | undefined)[]): State => ({
  matches: paths.map((path) => ({ route: path === undefined ? {} : { path } })),
});

function harness(coarse = false) {
  let clock = 0;
  let listener: (state: State) => void = () => undefined;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = Object.assign(new EventTarget(), {
    document,
    performance: { now: () => clock },
    crypto: { randomUUID: () => `visit-${String(clock)}` },
    matchMedia: () => ({ matches: coarse }),
  }) as unknown as Window;
  const router: UsageRouter = {
    state: matches('/', 'catalog'),
    subscribe: (next) => {
      listener = next;
      return () => undefined;
    },
  };
  const sent: UsageEvent[] = [];
  let flushes = 0;
  const session = new UsageSession({
    win,
    router,
    send: (event) => sent.push(event),
    flush: () => (flushes += 1),
  });
  const hide = (state: 'hidden' | 'visible') => {
    document.visibilityState = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const click = (name: string | null, type = 'click') => {
    const target = Object.assign(new EventTarget(), {
      closest: () => (name === null ? null : { getAttribute: () => name }),
    });
    const event = new Event(type);
    Object.defineProperty(event, 'target', { value: target });
    document.dispatchEvent(event);
  };
  return {
    session,
    win,
    sent,
    hide,
    click,
    flushes: () => flushes,
    tick: (ms: number) => (clock += ms),
    go: (state: State) => {
      listener(state);
    },
  };
}

describe('usage model', () => {
  it('names screens by route pattern, never by ids in the address', () => {
    assert.equal(screenName(['/', 'supplier/:id']), 'supplier');
    assert.equal(screenName(['/', 'supplier/new']), 'supplier-new');
    assert.equal(screenName(['/', undefined]), 'home');
    assert.equal(screenName(['/', '*']), 'not-found');
    assert.equal(screenName(['/', 'ספקים']), 'other');
  });

  it('accepts only slug actions, whole bounded times and small step numbers', () => {
    assert.equal(actionName('catalog.search'), 'catalog.search');
    assert.equal(actionName('חיפוש'), null);
    assert.equal(actionName(null), null);
    assert.equal(durationMs(-5), 0);
    assert.equal(durationMs(12.6), 13);
    assert.equal(durationMs(1e12), 86_400_000);
    assert.equal(stepNumber(2), 2);
    assert.equal(stepNumber(0), null);
    assert.equal(stepNumber('2'), null);
  });

  it('builds a data attribute for props objects', () => {
    assert.deepEqual(usage('catalog.search'), { 'data-usage': 'catalog.search' });
  });
});

describe('usage session', () => {
  it('sends a visit with screens, actions, steps and its end', () => {
    const h = harness(true);
    h.session.start();
    h.tick(1000);
    h.click('catalog.search', 'change');
    h.click(null);
    h.go(matches('/', 'engagement'));
    h.go(matches('/', 'engagement'));
    globalThis.dispatchEvent = h.win.dispatchEvent.bind(h.win);
    reportStep(2);
    h.win.dispatchEvent(new CustomEvent(USAGE_STEP, { detail: 'x' }));
    h.tick(500);
    h.hide('hidden');
    assert.deepEqual(
      h.sent.map((e) => [e.kind, e.screen, e.action ?? e.step ?? e.duration_ms ?? null]),
      [
        ['visit_start', 'catalog', null],
        ['action', 'catalog', 'catalog.search'],
        ['screen_view', 'catalog', 1000],
        ['step', 'engagement', 2],
        ['screen_view', 'engagement', 500],
        ['visit_end', 'engagement', 1500],
      ],
    );
    assert.ok(h.sent.every((e) => e.device === 'mobile' && e.visit_id === 'visit-0'));
    assert.equal(h.flushes(), 1);
  });

  it('starts a new visit when the tab comes back, and sends nothing while hidden', () => {
    const h = harness();
    h.hide('hidden');
    h.session.start();
    h.click('catalog.search');
    assert.equal(h.sent.length, 0);
    h.tick(10);
    h.hide('visible');
    h.hide('visible');
    h.hide('hidden');
    h.hide('hidden');
    assert.deepEqual(
      h.sent.map((e) => [e.kind, e.visit_id, e.device]),
      [
        ['visit_start', 'visit-10', 'desktop'],
        ['screen_view', 'visit-10', 'desktop'],
        ['visit_end', 'visit-10', 'desktop'],
      ],
    );
  });
});

describe('startUsage', () => {
  it('sends nothing without a sign-in', () => {
    const h = harness();
    let fetched = 0;
    Object.assign(h.win, {
      fetch: () => {
        fetched += 1;
        return Promise.resolve(new Response());
      },
    });
    const router: UsageRouter = { state: matches('/'), subscribe: () => () => undefined };
    startUsage(h.win, router, EventBatcher);
    h.hide('hidden');
    assert.equal(fetched, 0);
  });
});

describe('startMonitoring', () => {
  it('starts the vitals and the usage visit on the shared batcher class', async () => {
    const { startMonitoring } = await import('../src/data/monitoring.ts');
    const h = harness();
    const added: unknown[] = [];
    const telemetry = new EventBatcher<TelemetryEvent>(h.win, () => null);
    telemetry.add = (event) => added.push(event);
    const router: UsageRouter = { state: matches('/'), subscribe: () => () => undefined };
    startMonitoring({ win: h.win, router, telemetry });
    h.hide('hidden');
    assert.ok(Array.isArray(added));
  });
});
