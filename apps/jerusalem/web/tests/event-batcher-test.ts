// EventBatcher with and without fetchLater: batches are sent once, and never lost on leaving.
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { BATCH_WINDOW_MS, EventBatcher, MAX_BATCH } from '../src/lib/tracker.ts';

type Init = RequestInit & { activateAfter?: number };

function fakeWindow(withLater: boolean) {
  const sent: string[] = [];
  const held: {
    body: string;
    signal: AbortSignal | null | undefined;
    result: { activated: boolean };
  }[] = [];
  let pagehide: () => void = () => undefined;
  const win = {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'pagehide') pagehide = listener;
    },
    fetch: (_url: string, init: RequestInit) => {
      sent.push(init.body as string);
      return Promise.reject(new Error('offline'));
    },
    ...(withLater
      ? {
          fetchLater: (_url: string, init: Init) => {
            assert.equal(init.activateAfter, BATCH_WINDOW_MS);
            const result = { activated: false };
            held.push({ body: init.body as string, signal: init.signal, result });
            return result;
          },
        }
      : {}),
  } as unknown as Window;
  return {
    win,
    sent,
    held,
    leave: () => {
      pagehide();
    },
  };
}

const build = (events: number[]) => ({
  url: 'https://db.test/e',
  init: { body: events.join(',') },
});

describe('without fetchLater', () => {
  it('sends a batch after the window, and what is left when the page goes away', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { win, sent, leave } = fakeWindow(false);
      const batcher = new EventBatcher<number>(win, build);
      batcher.add(1);
      batcher.add(2);
      mock.timers.tick(BATCH_WINDOW_MS);
      assert.deepEqual(sent, ['1,2']);
      batcher.add(3);
      leave();
      assert.deepEqual(sent, ['1,2', '3']);
      leave();
      assert.equal(sent.length, 2, 'an empty queue sends nothing');
    } finally {
      mock.timers.reset();
    }
  });

  it('sends at once when the batch is full', () => {
    const { win, sent } = fakeWindow(false);
    const batcher = new EventBatcher<number>(win, build);
    for (let i = 1; i <= MAX_BATCH; i += 1) batcher.add(i);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.split(',').length, MAX_BATCH);
  });
});

describe('with fetchLater', () => {
  it('replaces the held request with one that includes each new event', () => {
    const { win, sent, held, leave } = fakeWindow(true);
    const batcher = new EventBatcher<number>(win, build);
    batcher.add(1);
    batcher.add(2);
    assert.deepEqual(
      held.map((h) => h.body),
      ['1', '1,2'],
    );
    assert.equal(held[0]?.signal?.aborted, true);
    leave();
    batcher.flush();
    assert.deepEqual(sent, [], 'the browser sends a held request itself');
  });

  it('starts a new batch once the browser sent the held one', () => {
    const { win, sent, held } = fakeWindow(true);
    const batcher = new EventBatcher<number>(win, build);
    batcher.add(1);
    const first = held[0];
    assert.ok(first);
    first.result.activated = true;
    batcher.add(2);
    assert.deepEqual(held.at(-1)?.body, '2');
    const second = held.at(-1);
    assert.ok(second);
    second.result.activated = true;
    batcher.flush();
    assert.deepEqual(sent, []);
  });

  it('falls back to the timer when fetchLater refuses or nothing can be built', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { win, sent } = fakeWindow(true);
      Object.assign(win, {
        fetchLater: () => {
          throw new Error('quota');
        },
      });
      const batcher = new EventBatcher<number>(win, build);
      batcher.add(1);
      mock.timers.tick(BATCH_WINDOW_MS);
      assert.deepEqual(sent, ['1']);
      const silent = new EventBatcher<number>(win, () => null);
      silent.add(1);
      mock.timers.tick(BATCH_WINDOW_MS);
      assert.deepEqual(sent, ['1']);
    } finally {
      mock.timers.reset();
    }
  });
});
