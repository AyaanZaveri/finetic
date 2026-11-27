import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonSheetLayout } from '../lib/season-sheet.ts';

test('a one-season drawer is compact and detached from all safe-area edges', () => {
  const layout = seasonSheetLayout(402, 874, { left: 0, right: 0, top: 62, bottom: 34 }, 1);
  assert.deepEqual(layout, { marginLeft: 12, marginRight: 12, topInset: 74, bottomInset: 46, snapHeight: 176 });
});

test('long season lists and large text stay within the viewport and tablet width', () => {
  const layout = seasonSheetLayout(1024, 768, { left: 12, right: 12, top: 24, bottom: 20 }, 12, 2);
  assert.equal(1024 - layout.marginLeft - layout.marginRight, 560);
  assert.ok(layout.snapHeight < 768 - layout.topInset - layout.bottomInset);
});
