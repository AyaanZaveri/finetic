const assert = require('node:assert/strict');
const { QueryClient } = require('@tanstack/react-query');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const tick = () => new Promise(setImmediate);
class Node {}
class Element extends Node {
    constructor(values = {}) { super(); Object.assign(this, values); }
    closest(selector) {
        if (selector === '[data-slot="context-menu-separator"]') return this.separator ? this : null;
        return this;
    }
    hasAttribute() { return false; }
}
class MouseEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }
const primitives = Object.fromEntries(['Root', 'Trigger', 'Portal', 'Positioner', 'Popup', 'Group', 'GroupLabel', 'Item', 'Separator'].map(key => [key, key]));
function setup({ mobile = false, authenticated = true, continueWatching = true, type = 'series', known = true, reduced = false, override = {}, queries, saveRemoval, saveWatched } = {}) {
    const h = hooks(), plays = [], routes = [], reads = [], toggles = [], errors = [], events = [];
    let signIns = 0;
    const item = { id: 'tt123', name: 'Show', type, ...(type === 'series' ? { mediaSourceId: 'tt123:1:2', seasonNumber: 1, episodeNumber: 2 } : {}),
        ...(continueWatching ? { resumePositionTicks: 120 } : {}), ...override };
    const { MediaCardMenu } = load('components/media-card-menu.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        'motion/react': { motion: { span: 'highlight' }, useReducedMotion: () => reduced },
        '@/components/arc/user-menu/user-menu.module.css': { highlight: 'avatar-highlight' },
        '@/components/ui/context-menu': { ContextMenu: primitives.Root, ContextMenuTrigger: primitives.Trigger, ContextMenuContent: primitives.Popup, ContextMenuGroup: primitives.Group, ContextMenuLabel: primitives.GroupLabel, ContextMenuItem: primitives.Item, ContextMenuSeparator: primitives.Separator },
        '@/components/ui/button': { Button: 'button' },
        'next/navigation': { useRouter: () => ({ push: (...args) => routes.push(args) }) },
        sonner: { toast: { error: message => errors.push(message) } },
        '@/components/stream-query-provider': { useStreamQueries: () => queries },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated, requestSignIn: () => signIns++ }) },
        '@/contexts/watch-history-context': { useWatchStatus: (id, type, videoId) => ({ known, watched: false, toggle: async () => { toggles.push({ id, type, videoId }); return saveWatched ? saveWatched() : true; } }) },
        '@/app/actions/media': { fetchPlaybackProgress: (id, videoId) => new Promise(resolve => reads.push({ id, videoId, resolve })) },
        '@/app/actions/continue-watching': { removeFromContinueWatching: async input => { events.push(input); return saveRemoval ? saveRemoval() : true; } },
        '@/lib/media/fetch-playback-id': { fetchPlaybackId: async () => 'tt123' },
        '@/components/account-ui/drawer': Object.fromEntries(['Drawer', 'DrawerClose', 'DrawerContent', 'DrawerDescription', 'DrawerHeader', 'DrawerTitle'].map(key => [key, key])),
        '@/components/account-ui/surface.module.css': { surface: 'account-glass' },
        '@/components/arc/floating-surface.module.css': { surface: 'menu-glass' },
    }, { Node, Element, MouseEvent, CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
        window: { matchMedia: query => ({ matches: query.includes("hover: hover") ? !mobile : mobile }), dispatchEvent: event => events.push(event) } });
    const render = () => h.render(MediaCardMenu, { item, continueWatching, detailsHref: '/series/tt123/1/2', onPlay: async input => plays.push(input), children: { type: 'div', props: {} } });
    let tree;
    const refresh = () => { tree = render(); h.flush(); return tree; };
    const find = type => nodes(tree).find(node => node.type === type);
    const open = (eventType = 'contextmenu') => {
        const target = new Element();
        find('Trigger').props.onPointerDownCapture({ target, pointerType: eventType === 'touchstart' ? 'touch' : 'mouse', currentTarget: { contains: () => true } });
        find('Trigger').props.onContextMenu({ target });
        find('Root').props.onOpenChange(true);
        refresh();
    };
    const action = label => nodes(tree).find(node => node.type === 'Item' && node.props.textValue === label);
    refresh();
    return { h, refresh, find, open, action, plays, routes, reads, toggles, errors, events, get signIns() { return signIns; } };
}

(async () => {
    const desktop = setup();
    assert.equal(desktop.reads.length, 0, 'Cards do not read resume state before intent');
    desktop.open();
    assert.equal(desktop.find('Root').props.open, true);
    assert.match(desktop.find('Popup').props.className, /menu-glass/, 'Use the existing floating menu material');
    await desktop.action('Resume').props.onSelect();
    assert.equal(desktop.plays[0].videoId, 'tt123:1:2');
    assert.equal(desktop.plays[0].resumePosition, 120);
    desktop.refresh(); desktop.open();
    await desktop.action('Play from beginning').props.onSelect();
    assert.equal(desktop.plays.at(-1).resumePosition, 0);
    desktop.refresh(); desktop.open();
    await desktop.action('Mark episode as watched').props.onSelect();
    assert.equal(desktop.toggles[0].videoId, 'tt123:1:2', 'Only the selected episode is changed');
    desktop.refresh(); desktop.open();
    await desktop.action('View series').props.onSelect();
    assert.equal(desktop.routes[0][0], '/series/tt123');
    desktop.refresh(); desktop.open();
    await desktop.action('Remove from Continue Watching').props.onSelect();
    assert.equal(desktop.events.at(-1).type, 'navigator-watch-history-changed');

    const mobile = setup({ mobile: true });
    assert.ok(mobile.find('Drawer'), 'The same drawer instance must mount closed before an opening request');
    assert.equal(mobile.find('Drawer').props.open, false);
    mobile.open('touchstart');
    assert.equal(mobile.find('Root').props.open, false);
    assert.equal(mobile.find('Drawer').props.open, true);
    assert.match(mobile.find('DrawerContent').props.className, /account-glass/, 'Use the exact sign-in drawer surface');
    assert.equal(mobile.find('DrawerClose'), undefined, 'The media drawer has no Cancel button');
    let prevented = false, stopped = false;
    const target = {};
    mobile.find('Trigger').props.onClickCapture({ target, currentTarget: { contains: () => true }, preventDefault: () => prevented = true, stopPropagation: () => stopped = true });
    assert.ok(prevented && stopped, 'Release after a long press cannot navigate the card');
    mobile.find('Drawer').props.onOpenChange(false); mobile.refresh();
    assert.ok(mobile.find('Drawer'), 'Keep the drawer mounted for its closing transition');
    assert.equal(mobile.find('Drawer').props.open, false, 'The drawer stays mounted closed, exactly like sign-in');
    mobile.open('touchstart');
    assert.equal(mobile.find('Drawer').props.open, true, 'Reopening uses the same closed-to-open lifecycle');

    const { continueWatchingKey, continueWatchingRemovalKey, continueWatchingCardKey } = load('lib/media/continue-watching-query.ts');
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    const scope = 'test-account';
    const queryKey = continueWatchingKey(scope);
    const episode = { id: 'tt123', type: 'series', mediaSourceId: 'tt123:1:2' };
    const newerEpisode = { ...episode, mediaSourceId: 'tt123:1:3' };
    const pending = () => client.getMutationCache().findAll({ mutationKey: continueWatchingRemovalKey(scope), status: 'pending' });
    let finishWatched, finishRemoval;
    client.setQueryData(queryKey, [episode]);
    const failedWatch = setup({ queries: { client, scope }, saveWatched: () => new Promise(resolve => { finishWatched = resolve; }) });
    failedWatch.open();
    const watching = failedWatch.action('Mark episode as watched').props.onSelect();
    assert.equal(pending()[0].state.variables, continueWatchingCardKey(episode), 'Marking the current episode hides its resume card before saving');
    await tick();
    finishWatched(false);
    await watching;
    assert.equal(pending().length, 0, 'Failure releases the optimistic removal');
    assert.deepEqual(client.getQueryData(queryKey), [episode], 'Failed actions preserve the original card in the cache');
    assert.equal(failedWatch.errors.length, 1);

    const removingOnMobile = setup({ mobile: true, queries: { client, scope }, saveRemoval: () => new Promise(resolve => { finishRemoval = resolve; }) });
    removingOnMobile.open('touchstart');
    const mobileRemove = nodes(removingOnMobile.find('Drawer')).find(node => node.type === 'button' && node.props.children.includes('Remove from Continue Watching'));
    const removing = mobileRemove.props.onClick();
    assert.equal(pending()[0].state.variables, continueWatchingCardKey(episode), 'The drawer shares the optimistic removal');
    await tick();
    client.setQueryData(queryKey, [episode, newerEpisode]);
    removingOnMobile.h.unmount();
    finishRemoval(true);
    await removing;
    assert.deepEqual(client.getQueryData(queryKey), [newerEpisode], 'Success removes the selected card after unmount and leaves a newer episode intact');
    assert.equal(pending().length, 0);
    client.clear();

    let dispatched;
    desktop.find('Trigger').props.onKeyDown({ key: 'F10', shiftKey: true, preventDefault() {}, stopPropagation() {},
        target: { getBoundingClientRect: () => ({ left: 20, top: 30 }), dispatchEvent: event => dispatched = event } });
    assert.equal(dispatched.type, 'contextmenu');
    assert.equal(dispatched.clientX, 32);

    desktop.find('Group').props.onPointerMoveCapture({ pointerType: 'mouse', target: new Element({ offsetTop: 30, offsetHeight: 38 }) });
    desktop.refresh();
    assert.equal(desktop.find('highlight').props.transition.default.duration, 0, 'First hover position appears immediately');
    assert.equal(desktop.find('highlight').props.transition.opacity.duration, .12, 'Highlight fades with the same short avatar-menu transition');
    assert.equal(desktop.find('highlight').props.className, 'avatar-highlight', 'Use the avatar menu highlight style');
    // Radix moves focus to its popup when leaving a row, before the next row focuses.
    desktop.find('Group').props.onBlurCapture({ relatedTarget: new Element(), currentTarget: { contains: () => false } });
    desktop.refresh();
    assert.equal(desktop.find('highlight').props.animate.opacity, 1, 'A pointer-driven focus gap must retain the highlight for the next row glide');
    desktop.find('Group').props.onPointerMoveCapture({ pointerType: 'mouse', target: new Element({ separator: true }) });
    desktop.refresh();
    assert.equal(desktop.find('highlight').props.animate.transform, 'translateY(30px)', 'Crossing a divider preserves the previous row as the glide origin');
    desktop.find('Group').props.onPointerMoveCapture({ pointerType: 'mouse', target: new Element({ offsetTop: 68, offsetHeight: 38 }) });
    desktop.refresh();
    assert.equal(desktop.find('highlight').props.transition.default.type, 'spring', 'Mouse navigation glides between rows');
    assert.equal(desktop.find('highlight').props.transition.default.visualDuration, .26, 'Use the exact avatar spring token');
    desktop.find('Group').props.onPointerLeave();
    desktop.refresh();
    assert.equal(desktop.find('highlight').props.animate.opacity, 0, 'Leaving the menu fades the highlight out');
    desktop.find('Group').props.onKeyDownCapture();
    desktop.find('Group').props.onFocusCapture({ target: new Element({ offsetTop: 30, offsetHeight: 38 }) });
    desktop.refresh();
    assert.equal(desktop.find('highlight').props.transition.default.duration, 0, 'Keyboard focus always jumps immediately');
    const reduced = setup({ reduced: true }); reduced.open();
    for (const offsetTop of [30, 68]) {
        reduced.find('Group').props.onPointerMoveCapture({ pointerType: 'mouse', target: new Element({ offsetTop, offsetHeight: 38 }) });
        reduced.refresh();
    }
    assert.equal(reduced.find('highlight').props.transition.default.duration, 0, 'Reduced motion disables the glide');
    assert.equal(reduced.find('highlight').props.transition.opacity.duration, 0, 'Reduced motion also skips the fade');


    const catalog = setup({ continueWatching: false, type: 'movie' });
    catalog.open();
    assert.equal(catalog.reads.length, 1, 'Resolve progress only when the menu opens');
    catalog.reads[0].resolve({ resumePositionTicks: 75 }); await tick(); catalog.refresh();
    assert.ok(catalog.action('Resume'));
    assert.equal(catalog.action('Remove from Continue Watching'), undefined);
    assert.equal(catalog.action('View series'), undefined);
    catalog.h.unmount();

    const mapped = setup({ continueWatching: false, type: 'movie', override: { id: 'tmdb:123', mediaSourceId: 'tmdb:123' } });
    mapped.open(); await tick();
    assert.equal(mapped.reads[0].id, 'tt123');
    assert.equal(mapped.reads[0].videoId, 'tt123', 'Movie video and title IDs are canonicalized together');
    mapped.reads[0].resolve({ resumePositionTicks: 90, videoId: 'tt123' }); await tick(); mapped.refresh();
    await mapped.action('Resume').props.onSelect();
    assert.equal(mapped.plays[0].titleId, 'tt123');
    mapped.h.unmount();

    const cancelled = setup({ continueWatching: false, type: 'movie' });
    cancelled.open();
    cancelled.find('Root').props.onOpenChange(false, {}); cancelled.refresh();
    cancelled.reads[0].resolve({ resumePositionTicks: 999 }); await tick(); cancelled.refresh();
    assert.equal(cancelled.action('Resume'), undefined, 'A closed menu ignores late progress responses');
    cancelled.h.unmount();

    const unknown = setup({ known: false }); unknown.open();
    assert.equal(unknown.action('Mark episode as watched').props.disabled, true, 'Do not guess unknown watched state');
    const guest = setup({ authenticated: false, continueWatching: false, type: 'movie' }); guest.open();
    assert.equal(guest.action('Mark as watched'), undefined);
    await guest.action('Play').props.onSelect();
    assert.equal(guest.signIns, 1); assert.equal(guest.plays.length, 0);

    const writes = [];
    let result, readOK = true, writeOK = true, apiError = false;
    const { removeFromContinueWatching } = load('app/actions/continue-watching.ts', {
        '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
    }, { fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.collection, 'libraryItem');
        assert.equal(options.cache, 'no-store');
        if (url.endsWith('/datastoreGet')) return { ok: readOK, json: async () => ({ result }) };
        writes.push(body.changes[0]);
        return { ok: writeOK, json: async () => apiError ? { error: 'rejected' } : { result: { success: true } } };
    } });
    const state = { video_id: 'tt123:1:2', timeOffset: 120000, timeWatched: 90000, watched: 'existing-bitfield', timesWatched: 3, flaggedWatched: 1 };
    const existing = { _id: 'tt123', type: 'series', name: 'Show', removed: false, temp: false, _ctime: '2026-01-01', state };
    result = [existing];
    assert.equal(await removeFromContinueWatching({ id: 'tt123', type: 'series', videoId: 'tt123:1:2' }), true);
    const saved = writes.at(-1);
    assert.equal(saved.state.timeOffset, 0);
    for (const key of ['watched', 'timeWatched', 'timesWatched', 'flaggedWatched']) assert.equal(saved.state[key], state[key]);
    assert.equal(saved.removed, false); assert.equal(saved.temp, false); assert.equal(saved._ctime, existing._ctime);
    const before = writes.length;
    assert.equal(await removeFromContinueWatching({ id: 'tt123', type: 'series', videoId: 'tt123:1:1' }), false);
    assert.equal(writes.length, before, 'Stale card cannot remove a newer episode');
    result = []; assert.equal(await removeFromContinueWatching({ id: 'missing', type: 'movie' }), false);
    result = [existing]; readOK = false;
    assert.equal(await removeFromContinueWatching({ id: 'tt123', type: 'series' }), false);
    readOK = true; apiError = true;
    assert.equal(await removeFromContinueWatching({ id: 'tt123', type: 'series' }), false);
    assert.equal(await removeFromContinueWatching({ id: '', type: 'movie' }), false);
    console.log('PASS: card menu actions, mobile drawer routing, shared blur materials, click suppression, keyboard access, lazy resume reads, guest gating and safe Continue Watching removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
