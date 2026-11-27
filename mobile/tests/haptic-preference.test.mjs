import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHapticPreference } from '../lib/haptic-preference.ts';
import { hapticAction } from '../lib/interaction-policy.ts';

test('persisted disabled haptics suppress all dispatches', async () => {
  const store = createHapticPreference({ getItem: async () => '0', setItem: async () => {} });
  await store.hydrate();
  assert.equal(store.getSnapshot(), false);
  for (const platform of ['android', 'ios']) {
    for (const feedback of ['selection', 'impact', 'carousel']) assert.equal(hapticAction(platform, feedback, store.getSnapshot()), null);
  }
});

test('fast preference changes persist in their original order', async () => {
  const writes = [];
  const store = createHapticPreference({ getItem: async () => null, setItem: async (_, value) => { writes.push(value); } });
  await store.hydrate();
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  const first = store.setEnabled(false);
  const second = store.setEnabled(true);
  await Promise.all([first, second]);
  assert.deepEqual(writes, ['0', '1']);
  assert.equal(store.getSnapshot(), true);
  assert.equal(changes, 2);
  unsubscribe();
});

test('a late storage read cannot overwrite a more recent user decision', async () => {
  let finish;
  const store = createHapticPreference({ getItem: () => new Promise(resolve => { finish = resolve; }), setItem: async () => {} });
  const hydration = store.hydrate();
  await store.setEnabled(false);
  finish('1');
  await hydration;
  assert.equal(store.getSnapshot(), false);
});
