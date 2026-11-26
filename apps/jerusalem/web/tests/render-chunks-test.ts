import assert from 'node:assert/strict';
import { it, mock } from 'node:test';

import { yieldToMain } from '../src/render-chunks.ts';

it('uses scheduler.yield with the scheduler receiver, and falls back to a promised timer', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  const scheduler = {
    yield: function () {
      assert.equal(this, scheduler);
      return Promise.resolve();
    },
  };
  try {
    Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: scheduler });
    await yieldToMain();
    Reflect.deleteProperty(globalThis, 'scheduler');
    mock.timers.enable({ apis: ['setTimeout'] });
    let completed = false;
    const pending = yieldToMain().then(() => {
      completed = true;
    });
    assert.equal(completed, false);
    mock.timers.tick(1);
    await pending;
    assert.equal(completed, true);
  } finally {
    mock.timers.reset();
    if (previous) Object.defineProperty(globalThis, 'scheduler', previous);
    else Reflect.deleteProperty(globalThis, 'scheduler');
  }
});
