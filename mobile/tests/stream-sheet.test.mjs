import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamSheetLayout } from '../lib/stream-sheet.ts';

test('stream drawers use the same detached margins and a tall bounded detent', () => {
  const layout = streamSheetLayout(402, 874, { left: 0, right: 0, top: 62, bottom: 34 });
  assert.equal(layout.marginLeft, 12);
  assert.equal(layout.marginRight, 12);
  assert.equal(layout.bottomInset, 34);
  assert.ok(layout.snapHeight > 700);
  assert.ok(layout.snapHeight + layout.topInset + layout.bottomInset <= 874);
});

test('wide and landscape drawers stay inside the safe area', () => {
  const layout = streamSheetLayout(1024, 768, { left: 20, right: 12, top: 24, bottom: 20 });
  assert.equal(1024 - layout.marginLeft - layout.marginRight, 560);
  assert.ok(layout.snapHeight + layout.topInset + layout.bottomInset <= 768);
});
