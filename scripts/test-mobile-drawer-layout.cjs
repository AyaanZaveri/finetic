const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');

const read = path => fs.readFileSync(path, 'utf8');
function declarations(file, selector) {
  let found;
  postcss.parse(read(file)).walkRules(selector, rule => {
    found ??= Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  });
  assert.ok(found, `${file}: missing ${selector}`);
  return found;
}

const drawer = declarations('components/account-ui/drawer.module.css', '.popup[data-swipe-direction="down"]');
assert.equal(drawer['--drawer-bottom-inset'], 'var(--drawer-inset, 0px)', 'The bottom gap must match the side inset, even when a platform reports a 34px safe area');
assert.equal(drawer['margin-bottom'], 'var(--drawer-bottom-inset)', 'Keep the sheet close to the viewport edge');
assert.match(drawer['--drawer-content-max-height'], /100dvh - var\(--drawer-top-inset\) - var\(--drawer-bottom-inset\)/);
assert.match(drawer['--closed-transform'], /100% \+ var\(--drawer-bottom-inset\)/, 'A sheet must still animate completely offscreen');
assert.match(read('components/account-ui/drawer.tsx'), /styles\.popup,\s*className/, 'Apply the shared geometry to every account drawer');

for (const file of ['components/stream-actions-menu.tsx', 'components/media-card-menu.tsx']) {
  const source = read(file);
  assert.match(source, /overflow-y-auto overscroll-contain p-3 pb-2/);
  assert.doesNotMatch(source, /safe-area-inset-bottom/, 'Never repeat the safe area inside an action drawer');
  assert.match(source, /min-h-12 w-full justify-start/, 'Keep the existing 48px action hit areas');
}
for (const file of ['components/account-provider.tsx', 'components/add-addon-dialog.tsx', 'components/addon-share-content.tsx']) {
  assert.match(read(file), /min-h-0 overflow-y-auto overscroll-contain p-6 pb-4/, 'Forms need scroll access and a smaller bottom gutter');
}
const menuFile = 'components/arc/user-menu/user-menu.module.css';
const menu = declarations(menuFile, '.sheet');
assert.equal(menu['--sheet-bottom-inset'], 'var(--inset)', 'Account sheet uses the same 8px bottom gap');
assert.equal(menu.bottom, 'var(--sheet-bottom-inset)');
assert.equal(menu.padding, '6px var(--inset) var(--inset)');
assert.match(menu['max-height'], /100dvh - var\(--sheet-top-inset\) - var\(--sheet-bottom-inset\)/);
assert.doesNotMatch(read('components/account-ui/drawer.module.css'), /safe-area-inset-bottom|navigator-safe-bottom/, 'Do not double-count system chrome outside the drawer');
assert.doesNotMatch(read(menuFile), /safe-area-inset-bottom|navigator-safe-bottom/, 'Account menu must not float higher than the other drawers');
console.log('PASS: compact mobile action rows and forms, matching 8px bottom placement, scrollable content and sheet dismissal geometry');
