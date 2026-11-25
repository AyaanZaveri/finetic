const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const layout = fs.readFileSync('components/layout-content.tsx', 'utf8');
assert.match(layout, /<HomePaletteProvider>/, 'Palette state must belong to the shared layout');
assert.match(layout, /<HomeGradientBackground\s+visible=/, 'One persistent canvas must belong to the shared layout');
for (const file of ['app/(main)/page.tsx', 'app/(main)/search/page.tsx', 'app/(main)/search/loading.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /<HomePaletteProvider|<HomeGradientBackground/, `${file} must not recreate the palette or canvas`);
}
const { createHomePaletteScene } = load('lib/home-palette.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const pending = [];
    let now = 0, nextTimer = 0, pathname = '/', creations = 0;
    const timers = new Map();
    const clock = {
        now: () => now,
        set(fn, delay) { timers.set(++nextTimer, { fn, at: now + delay }); return nextTimer; },
        clear(id) { timers.delete(id); },
    };
    const h = hooks();
    const provider = load('components/home-palette-provider.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        'next/navigation': { usePathname: () => pathname },
        '@/lib/home-palette': { createHomePaletteScene(loader) { creations++; return createHomePaletteScene(loader, clock); } },
        '@/lib/aurora-palette-loader': { loadHomePalette: primary => new Promise(resolve => pending.push({ primary, resolve })) },
    });
    function render(route) {
        pathname = route;
        const tree = h.render(provider.HomePaletteProvider, { children: route });
        h.flush();
        return tree.props.value;
    }
    const scene = render('/search');
    const yellow = ['#eab308', '#ca8a04', '#facc15'];
    const blue = ['#2563eb', '#1d4ed8', '#60a5fa'];
    scene.focus(Symbol('search-card'), { primary: 'yellow-poster' });
    pending.at(-1).resolve(yellow); await tick();
    const displayed = scene.getSnapshot();
    scene.focus(Symbol('old-card'), { primary: 'stale-search-poster' });
    const stale = pending.at(-1);
    assert.equal(render('/'), null, 'Home suspends the dot scene while its Aurora owns the palette worker');
    assert.equal(render('/search'), scene, 'Navigation must keep the same scene instance');
    assert.equal(scene.getSnapshot(), displayed, 'Entering search and its loading state must preserve the displayed palette');
    scene.registerInitial({ primary: 'search-first-poster' }, true);
    stale.resolve(blue); await tick();
    assert.equal(scene.getSnapshot(), displayed, 'Old page requests must not overwrite the retained color');
    pending.at(-1).resolve(blue); await tick();
    now = 2000;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    assert.equal(scene.getSnapshot().colors, blue, 'Search transitions to its first poster after retaining yellow during loading');
    assert.equal(scene.getSnapshot().duration, 1200);
    scene.focus(Symbol('search-card'), { primary: 'blue-poster' });
    pending.at(-1).resolve(blue); await tick();
    assert.equal(render('/'), null);
    assert.equal(render('/search'), scene);
    assert.equal(creations, 1, 'Home to Search to Home must create only one scene');
    assert.equal(scene.getSnapshot().colors, blue, 'Returning to Search retains the previous dot palette');
    scene.registerInitial({ primary: 'new-search-poster' });
    assert.equal(pending.at(-1).primary, 'new-search-poster', 'The new page initial palette must load after previous hover/focus');
    h.unmount();
    assert.equal(timers.size, 0);
    console.log('PASS: shared layout owns the canvas; route changes retain colors, reject stale requests and rearm initial palettes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
