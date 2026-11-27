import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hapticAction, pressScale } from '../lib/interaction-policy.ts';

const css = readFileSync(new URL('../global.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../lib/theme.ts', import.meta.url), 'utf8');

test('native press motion is disabled with reduced motion', () => {
  assert.equal(pressScale('android', false), 0.95);
  assert.equal(pressScale('ios', false), 0.97);
  assert.equal(pressScale('android', true), 1);
  assert.equal(pressScale('ios', true), 1);
});

test('system haptic dispatch policy is platform-specific and opt-in', () => {
  for (const platform of ['android', 'ios', 'web']) assert.equal(hapticAction(platform, 'none'), null);
  assert.equal(hapticAction('android', 'selection'), 'android-selection');
  assert.equal(hapticAction('android', 'impact'), 'android-impact');
  assert.equal(hapticAction('android', 'carousel'), 'android-carousel');
  assert.equal(hapticAction('ios', 'selection'), 'ios-selection');
  assert.equal(hapticAction('ios', 'impact'), 'ios-impact');
  assert.equal(hapticAction('ios', 'carousel'), 'ios-selection');
  assert.equal(hapticAction('web', 'impact'), null);
});

test('native navigation and NativeWind palettes remain synchronized', () => {
  const paletteBlocks = [...css.matchAll(/(?:\.dark:root|:root) \{([^}]+)\}/g)];
  assert.equal(paletteBlocks.length, 2);
  for (const [index, [, block]] of paletteBlocks.entries()) {
    const mode = index === 0 ? 'light' : 'dark';
    const themeBlock = theme.match(new RegExp(`  ${mode}: \\{([\\s\\S]*?)\\n  \\},`))?.[1];
    assert.ok(themeBlock);
    const values = [...block.matchAll(/--([\w-]+): ([\d.]+) ([\d.]+%) ([\d.]+%);/g)];
    assert.ok(values.length >= 20);
    for (const [, key, h, s, l] of values) {
      const camel = key.replace(/-(\w)/g, (_, char) => char.toUpperCase());
      assert.ok(themeBlock.includes(`${camel}: 'hsl(${h}, ${s}, ${l})'`), `${mode}.${key}`);
    }
  }
});
