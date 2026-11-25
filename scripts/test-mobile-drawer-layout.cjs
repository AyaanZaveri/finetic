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
assert.match(drawer['--drawer-bottom-inset'], /max\(var\(--drawer-inset, 0px\), var\(--navigator-safe-bottom, env\(safe-area-inset-bottom, 0px\)\)\)/);
assert.equal(drawer['margin-bottom'], 'var(--drawer-bottom-inset)', 'System chrome belongs outside the floating sheet');
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
assert.match(menu['--sheet-bottom-inset'], /var\(--navigator-safe-bottom, env\(safe-area-inset-bottom, 0px\)\)/);
assert.equal(menu.bottom, 'var(--sheet-bottom-inset)');
assert.equal(menu.padding, '6px var(--inset) var(--inset)');
assert.match(menu['max-height'], /100dvh - var\(--sheet-top-inset\) - var\(--sheet-bottom-inset\)/);
const android = declarations(menuFile, ':global(html[data-native-engine="exoplayer"]) .sheet[data-slot="user-menu-sheet"][aria-modal="true"]');
assert.equal(android.bottom, menu.bottom, 'Hosted menu must override the legacy bundled Android bottom offset');
console.log('PASS: compact mobile action rows and forms, one outer safe-area inset, scrollable content and sheet dismissal geometry');
