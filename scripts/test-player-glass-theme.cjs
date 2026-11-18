const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');
const css = postcss.parse(fs.readFileSync('components/player-mobile.css', 'utf8'));
const floating = postcss.parse(fs.readFileSync('components/arc/floating-surface.module.css', 'utf8'));
const declarations = (sheet, selector) => Object.fromEntries(sheet.nodes.find(rule => rule.selector === selector).nodes
  .filter(node => node.type === 'decl').map(node => [node.prop, node.value]));

// Resolve the actual material's variable dependencies with a captured light
// tint held constant, as it is while a video canvas remains mounted/paused.
function resolve(value, variables) {
  const start = value.indexOf('var(');
  if (start < 0) return value;
  let depth = 1, end = start + 4, comma = -1;
  for (; depth && end < value.length; end++) {
    if (value[end] === '(') depth++;
    if (value[end] === ')') depth--;
    if (value[end] === ',' && depth === 1 && comma < 0) comma = end;
  }
  const name = value.slice(start + 4, comma < 0 ? end - 1 : comma).trim();
  const fallback = comma < 0 ? '' : value.slice(comma + 1, end - 1).trim();
  return resolve(value.slice(0, start) + resolve(variables[name] ?? fallback, variables) + value.slice(end), variables);
}
const surface = declarations(floating, '.surface');
const captured = { '--browser-glass-color': 'rgba(255,255,255,.98)', '--browser-glass-sheen': 'none',
  '--native-glass-color': 'rgba(255,255,255,.98)', '--native-glass-sheen': 'none' };
const themes = { light: { '--popover': 'oklch(1 0 0)' }, dark: { '--popover': 'oklch(.205 0 0)' } };
const layers = ['[data-browser-glass]::after', '[data-player-native-glass][data-native-glass]::after'];
for (const selector of layers) {
  const layer = declarations(css, selector);
  const tint = (theme, opacity = '90%') => resolve(layer['background-color'], {
    ...captured, ...surface, ...themes[theme], '--dropdown-opacity': opacity,
  });
  const light = tint('light'), dark = tint('dark');
  assert.notEqual(dark, light, `${selector}: an already-open Navigator surface must follow theme changes without a new video frame`);
  assert.ok(dark.includes(themes.dark['--popover']), 'Dark glass must use the current popover token');
  assert.ok(light.includes(themes.light['--popover']), 'Switching back to light restores the light token');
  assert.ok(tint('dark', '100%').includes('100%'), 'Reduced transparency remains live');
  assert.equal(resolve(layer['background-image'], { ...captured, ...surface }), 'none', 'Floating surfaces keep their original sheen');
}
const browserLayer = declarations(css, layers[0]);
const control = declarations(css, '[data-player-glass]');
assert.ok(resolve(browserLayer['background-color'], { ...captured, ...control, '--background': 'player-dark', '--foreground': 'player-text' }).includes('player-dark'),
  'Player controls retain their own scoped theme');
assert.equal(resolve(browserLayer['background-color'], { ...captured, ...control, '--player-glass-interaction-color': 'hover-tint' }), 'hover-tint',
  'Hover continues to override the base material');
assert.equal(resolve(browserLayer['background-color'], captured), captured['--browser-glass-color'],
  'Surfaces without a live material keep the captured-color fallback');
const upNext = declarations(css, '[data-player-up-next][data-player-hdr-glass]');
assert.equal(upNext.position, 'absolute', 'Sampled glass must not move Up Next into the player layout');
assert.match(upNext.animation, /player-up-next-fade/);
assert.match(declarations(css.nodes.find(rule => rule.params === '(prefers-reduced-motion: no-preference)' &&
  rule.nodes.some(node => node.selector === '[data-player-up-next-content]')), '[data-player-up-next-content]').animation, /player-up-next-rise/);
assert.equal(declarations(css, 'html[data-native-platform="windows"][data-native-playing] [data-slot="media-player"] [data-player-up-next]')['--dropdown-opacity'], '90%');
console.log('PASS: mounted web/native glass follows light/dark tokens and transparency while retaining control themes, hover and captured fallbacks');
