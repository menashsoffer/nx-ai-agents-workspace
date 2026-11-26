import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { onBackdrop, runCommand } from '../src/lib/dialogs.ts';
import { base64Url } from '../src/data/session.ts';
import { BATCH_WINDOW_MS, EventBatcher, MAX_BATCH, type TrackedEvent } from '../src/lib/tracker.ts';
import { contentSecurityPolicy } from '../src/csp.ts';

interface Sent {
  url: string;
  init: RequestInit & { activateAfter?: number };
}

/** A window with only what the tracker touches. fetchLater is present when `later` is set. */
function fakeWindow(later?: { activated: boolean }) {
  const sent: Sent[] = [];
  const held: Sent[] = [];
  const listeners = new Map<string, () => void>();
  const win = {
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    fetch: (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Promise.resolve(new Response(null));
    },
    ...(later && {
      fetchLater: (url: string, init: Sent['init']) => {
        held.push({ url, init });
        return later;
      },
    }),
  };
  const hide = () => listeners.get('pagehide')?.();
  return { win: win as unknown as Window, sent, held, hide };
}

const build = (events: TrackedEvent[]) => ({
  url: 'https://example.test/rest/v1/activity_events',
  init: { method: 'POST', body: JSON.stringify(events) },
});
const event = (type: string): TrackedEvent => ({ actor_id: 'u', event_type: type, details: {} });
const types = (request: Sent | undefined): string[] =>
  (JSON.parse(request?.init.body as string) as TrackedEvent[]).map((item) => item.event_type);

describe('usage event batching', () => {
  it('sends queued events together once the window passes', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { win, sent } = fakeWindow();
      const batcher = new EventBatcher(win, build);
      batcher.add(event('page_view'));
      batcher.add(event('search'));
      assert.equal(sent.length, 0);
      mock.timers.tick(BATCH_WINDOW_MS);
      assert.equal(sent.length, 1);
      assert.deepEqual(types(sent[0]), ['page_view', 'search']);
      assert.equal(sent[0]?.init.keepalive, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('sends what is left when the page goes away, as on sign-out', () => {
    const { win, sent, hide } = fakeWindow();
    new EventBatcher(win, build).add(event('action'));
    hide();
    assert.deepEqual(types(sent[0]), ['action']);
    hide();
    assert.equal(sent.length, 1, 'nothing is sent twice');
  });

  it('sends at once when the batch is full', () => {
    const { win, sent, hide } = fakeWindow();
    const batcher = new EventBatcher(win, build);
    for (let i = 0; i < MAX_BATCH; i++) batcher.add(event(`e${String(i)}`));
    assert.equal(types(sent[0]).length, MAX_BATCH);
    hide();
  });

  it('with fetchLater, holds one growing batch and lets the browser send it', () => {
    const state = { activated: false };
    const { win, sent, held, hide } = fakeWindow(state);
    const batcher = new EventBatcher(win, build);
    batcher.add(event('page_view'));
    batcher.add(event('filter'));
    assert.equal(held.length, 2);
    assert.equal(held[0]?.init.signal?.aborted, true, 'the first, smaller batch is cancelled');
    assert.deepEqual(types(held[1]), ['page_view', 'filter']);
    assert.equal(held[1]?.init.activateAfter, BATCH_WINDOW_MS);
    hide();
    assert.equal(sent.length, 0, 'the browser sends the held batch itself');
  });

  it('with fetchLater, starts a new batch after the browser sent the last one', () => {
    const state = { activated: false };
    const { win, held } = fakeWindow(state);
    const batcher = new EventBatcher(win, build);
    batcher.add(event('page_view'));
    state.activated = true;
    batcher.add(event('search'));
    assert.deepEqual(types(held[1]), ['search']);
  });
});

/** A dialog stand-in that records what was called on it. */
function fakeDialog(open: boolean) {
  const calls: string[] = [];
  const dialog = {
    tagName: 'DIALOG',
    open,
    showModal: () => calls.push('showModal'),
    close: () => calls.push('close'),
  };
  const doc = { getElementById: (id: string) => (id === 'd' ? dialog : null) };
  return { dialog, calls, doc: doc as unknown as Document };
}
function button(command: string, target = 'd'): Element {
  const attrs: Record<string, string> = { commandfor: target, command };
  return { getAttribute: (name: string) => attrs[name] ?? null } as unknown as Element;
}

describe('dialog command fallback', () => {
  it('opens a closed dialog as a modal and closes an open one', () => {
    const closed = fakeDialog(false);
    assert.equal(runCommand(button('show-modal'), closed.doc), true);
    assert.deepEqual(closed.calls, ['showModal']);
    const open = fakeDialog(true);
    assert.equal(runCommand(button('close'), open.doc), true);
    assert.deepEqual(open.calls, ['close']);
  });

  it('ignores unknown commands and missing targets', () => {
    const { calls, doc } = fakeDialog(false);
    assert.equal(runCommand(button('toggle-popover'), doc), false);
    assert.equal(runCommand(button('show-modal', 'missing'), doc), false);
    assert.deepEqual(calls, []);
  });

  it('treats only clicks outside the dialog box as backdrop clicks', () => {
    const box = { top: 100, bottom: 300, left: 100, right: 500 };
    const dialog = { getBoundingClientRect: () => box } as unknown as HTMLDialogElement;
    const click = (x: number, y: number, target: unknown = dialog) =>
      ({ target, clientX: x, clientY: y }) as unknown as MouseEvent;
    assert.equal(onBackdrop(dialog, click(50, 50)), true);
    assert.equal(onBackdrop(dialog, click(100, 100)), false, 'the edge is inside');
    assert.equal(onBackdrop(dialog, click(200, 200)), false);
    assert.equal(onBackdrop(dialog, click(50, 50, {})), false, 'a click on content');
  });
});

describe('PKCE base64url', () => {
  it('uses the URL-safe alphabet without padding', () => {
    assert.equal(base64Url(new Uint8Array([251, 255, 191])), '-_-_');
    assert.equal(base64Url(new Uint8Array([1])), 'AQ');
    assert.equal(base64Url(new Uint8Array([])), '');
  });
});

describe('content security policy', () => {
  it('allows connections only to this site and the Supabase project', () => {
    const policy = contentSecurityPolicy('https://abc.supabase.co/');
    assert.match(policy, /connect-src 'self' https:\/\/abc\.supabase\.co;/);
    assert.match(policy, /script-src 'self';/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /require-trusted-types-for 'script'/);
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  });
});
