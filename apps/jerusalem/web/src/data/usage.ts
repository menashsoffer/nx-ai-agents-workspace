// Usage tracking for the admin dashboard (usage-analytics-spec-he.md 4). Loaded after the
// site starts, so it never counts toward the initial bundle. A visit is one stretch with the
// page in the foreground: hiding the tab ends it, showing the tab again starts a new one.
import { getAdminSession } from './rpc.ts';
import { eventRpcRequest } from './site.ts';
import type { EventBatcher } from '../lib/tracker.ts';
import {
  actionName,
  durationMs,
  screenName,
  stepNumber,
  type UsageEvent,
} from '../lib/usage-model.ts';
import type { Device, UsageKind } from '../lib/usage-model.ts';
import { USAGE_STEP } from '../lib/usage-signal.ts';

interface RouterState {
  matches: readonly { route: { path?: string } }[];
}
export interface UsageRouter {
  state: RouterState;
  subscribe: (listener: (state: RouterState) => void) => () => void;
}
interface Options {
  win: Window;
  router: UsageRouter;
  send: (event: UsageEvent) => void;
  flush: () => void;
}
type Extra = Pick<UsageEvent, 'action' | 'step' | 'duration_ms'>;

export const screenOf = (state: RouterState) => screenName(state.matches.map((m) => m.route.path));

export class UsageSession {
  private readonly options: Options;
  private readonly device: Device;
  private visit: string | null = null;
  private screen: string;
  private screenSince = 0;
  private visitSince = 0;

  constructor(options: Options) {
    this.options = options;
    this.device = options.win.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
    this.screen = screenOf(options.router.state);
  }

  start(): void {
    const { win, router } = this.options;
    router.subscribe((state) => {
      this.navigate(screenOf(state));
    });
    win.document.addEventListener('visibilitychange', () => {
      if (win.document.visibilityState === 'hidden') this.end();
      else this.begin();
    });
    for (const type of ['click', 'change'])
      win.document.addEventListener(
        type,
        (event) => {
          this.act(event.target);
        },
        true,
      );
    win.addEventListener(USAGE_STEP, (event) => {
      const step = stepNumber((event as CustomEvent<unknown>).detail);
      if (step !== null) this.emit('step', { step });
    });
    if (win.document.visibilityState === 'visible') this.begin();
  }

  private now(): number {
    return this.options.win.performance.now();
  }

  private emit(kind: UsageKind, extra: Extra = {}): void {
    if (this.visit === null) return;
    const base = { visit_id: this.visit, kind, screen: this.screen, device: this.device };
    this.options.send({ ...base, ...extra });
  }

  private begin(): void {
    if (this.visit !== null) return;
    this.visit = this.options.win.crypto.randomUUID();
    this.visitSince = this.screenSince = this.now();
    this.emit('visit_start');
  }

  private end(): void {
    if (this.visit === null) return;
    this.emit('screen_view', { duration_ms: durationMs(this.now() - this.screenSince) });
    this.emit('visit_end', { duration_ms: durationMs(this.now() - this.visitSince) });
    this.visit = null;
    this.options.flush();
  }

  private navigate(next: string): void {
    if (next === this.screen) return;
    this.emit('screen_view', { duration_ms: durationMs(this.now() - this.screenSince) });
    this.screen = next;
    this.screenSince = this.now();
  }

  private act(target: EventTarget | null): void {
    const closest = (target as Partial<Element> | null)?.closest;
    const element = closest ? closest.call(target, '[data-usage]') : null;
    const action = actionName(element?.getAttribute('data-usage'));
    if (action) this.emit('action', { action });
  }
}

/**
 * Sends only with a live sign-in; the server stores the caller's role, not who they are. The
 * entry passes the batcher class it already holds, so this chunk does not split it out.
 */
export function startUsage(
  win: Window,
  router: UsageRouter,
  Batcher: typeof EventBatcher,
): UsageSession {
  const batcher = new Batcher<UsageEvent>(win, (events) => {
    const session = getAdminSession();
    return session && session.exp > Date.now()
      ? eventRpcRequest('record_usage_events', session.token, events)
      : null;
  });
  const session = new UsageSession({
    win,
    router,
    send: (event) => {
      batcher.add(event);
    },
    flush: () => {
      batcher.flush();
    },
  });
  session.start();
  return session;
}
