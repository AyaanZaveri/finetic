const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const find = (node, predicate) => !node || typeof node !== 'object' ? [] : [
    ...(predicate(node) ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, predicate)),
];
const visibleText = node => Array.isArray(node) ? node.map(visibleText).join('')
    : typeof node === 'object' && node ? visibleText(node.props?.children) : String(node ?? '');
(async () => {
    let h = hooks();
    const viewport = { matches: false, addEventListener() {}, removeEventListener() {} };
    let attempts = 0, invalidations = 0, released = 0;
    const played = [];
    let publishStreams, cached;
    const addonApi = load('lib/media/fetch-addon-streams.ts', {}, { URL, URLSearchParams, Response });
    let rateLimitError;
    try {
        await addonApi.fetchAddonStreams({ id: 'fixture' }, 'tt123', 'movie', new AbortController().signal,
            async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
    } catch (error) { rateLimitError = error; }
    assert.ok(rateLimitError);
    const queries = {
        peek: () => cached,
        acquire: () => {
            const failed = attempts++ === 0;
            return { release: () => released++, request: {
                subscribe: listener => {
                    publishStreams = (streams, pending = 0, total = 2) => listener({ streams, total, pending, complete: pending === 0 });
                    publishStreams([], cached ? 2 : 0);
                    return () => {};
                },
                promise: failed ? Promise.reject(rateLimitError) : Promise.resolve([]),
            } };
        },
        invalidate: target => { assert.equal(target.id, 'tt123:2:2'); invalidations++; },
    };
    const { MediaActions } = load('components/media-actions.tsx', {
        react: new Proxy({}, { get: (_, key) => h.react[key] }), 'react/jsx-runtime': h.jsx,
        '@/lib/media/fetch-addon-streams': addonApi,
        '@/components/stream-query-provider': { useStreamQueries: () => queries },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
        '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({
            playMedia: async media => played.push(media.streamUrl), setIsPlayerVisible() {},
        }) },
        '@/app/actions': { fetchPlaybackProgress: async () => null },
        '@/components/ui/empty': Object.fromEntries(['Empty', 'EmptyDescription', 'EmptyHeader', 'EmptyMedia', 'EmptyTitle'].map(name => [name, name])),
        '@/components/ui/button': { Button: 'button' },
        '@/components/ui/avatar': { Avatar: 'Avatar', AvatarImage: 'AvatarImage', AvatarFallback: 'AvatarFallback' },
        '@/components/ui/loading-placeholder': { LoadingPlaceholder: 'loading' },
        '@/components/motion-primitives/activity-text-shimmer': { ActivityTextShimmer: 'shimmer' },
        '@/components/ui/skeleton': { Skeleton: 'skeleton' },
        '@/components/arc/search-field/search-field': { SearchField: 'search' },
        '@/components/arc/chip-group/chip-group': { ChipGroup: 'chips' },
        '@/components/arc/select/select': { Select: 'select' },
        '@/components/stream-filter-popover': { StreamFilterPopover: 'stream-filter-popover' },
        '@/components/stream-summary': { StreamSummary: 'summary' },
        '@/components/stream-actions-menu': { StreamActionsMenu: 'stream-actions-menu' },
        '@/components/ui/input-group': Object.fromEntries(['InputGroup', 'InputGroupAddon', 'InputGroupButton', 'InputGroupInput', 'InputGroupText'].map(name => [name, name])),
        '@/components/sign-in-for-streams': { SignInForStreams: 'sign-in' },
        '@/components/ui/drawer': Object.fromEntries(['Drawer', 'DrawerClose', 'DrawerContent', 'DrawerTitle', 'DrawerTrigger'].map(name => [name, name])),
        '@/lib/desktop/bridge': { desktopBridge: () => null },
        './media-actions.module.css': {},
        './player-selection-controls.module.css': {},
        '@/components/arc/floating-surface.module.css': {},
        '@/components/account-ui/drawer.module.css': {},
    }, { console: { error() {} }, window: { matchMedia: () => viewport } });
    const render = streamSelection => { const tree = h.render(MediaActions, { media: { id: 'tt123:2:2', type: 'series', name: 'Episode' }, streamSelection }); h.flush(); return tree; };
    const drawer = { currentUrl: null, onSelect() {} };
    const initialDrawer = render(drawer);
    assert.equal(find(initialDrawer, node => node.type === 'InputGroupInput').length, 1, 'Show stream search before the first snapshot');
    const initialStatus = find(initialDrawer, node => node.props.role === 'status')[0];
    assert.match(visibleText(initialStatus), /Finding streams/);
    assert.equal(find(initialStatus, node => node.type === 'shimmer').length, 1);
    h.unmount(); h = hooks(); attempts = 0; released = 0;
    render(); await tick(); let tree = render();
    assert.equal(find(tree, node => node.type === 'EmptyTitle')[0].props.children, 'Could not load streams');
    assert.match(visibleText(find(tree, node => node.type === 'EmptyDescription')[0]), /rate limited.*Wait before trying again/);
    find(tree, node => node.type === 'button' && node.props.children === 'Try again')[0].props.onClick();
    render(); await tick(); tree = render();
    assert.equal(attempts, 2); assert.equal(invalidations, 1); assert.equal(released, 1);
    assert.equal(find(tree, node => node.type === 'EmptyTitle')[0].props.children, 'No streams found', 'A successful empty retry must clear the previous error');
    const fileUrl = 'https://media.example.com/episode.mkv?token=signed';
    const streams = [
        { url: fileUrl, title: '4K', behaviorHints: { filename: 'Episode.mkv' } },
        { url: 'https://media.example.com/live.m3u8?token=signed' },
        { externalUrl: 'https://provider.example.com/watch' },
    ];
    publishStreams(streams);
    tree = render();
    const downloads = find(tree, node => node.type === 'stream-actions-menu' && node.props.downloadUrl);
    assert.equal(downloads.length, 1, 'Only the direct media file should be offered for download');
    assert.equal(downloads[0].props.downloadUrl, fileUrl, 'Download should use the original signed media URL');
    assert.equal(downloads[0].props.filename, 'Episode.mkv');
    assert.equal(find(tree, node => node.type === 'chips').length, 0, 'Keep filters out of the title preview');
    const manyStreams = Array.from({ length: 103 }, (_, index) => ({
        addonId: 'fixture', addonLogo: 'https://example.invalid/addon.png', url: `https://media.example.com/${index}.mkv`,
        title: index === 102 ? 'Rare release 4K BluRay REMUX DV HDR10 Atmos ⚡' : '1080p',
    }));
    publishStreams([{ title: 'Add-on notice' }, ...manyStreams]);
    tree = render();
    assert.equal(find(tree, node => node.type === 'summary').length, 3, 'Limit even hundreds of streams to three playable previews');
    const rootDrawer = find(tree, node => node.type === 'Drawer')[0];
    assert.equal(rootDrawer.props.swipeDirection, 'right', 'Desktop uses a side drawer');
    assert.match(visibleText(find(tree, node => node.type === 'DrawerTrigger')[0]), /View all 104 streams/);
    assert.equal(find(tree, node => node.type === 'DrawerContent').length, 0, 'Do not construct drawer rows while closed');
    rootDrawer.props.onOpenChange(true);
    tree = render();
    let content = find(tree, node => node.type === 'DrawerContent')[0];
    const addonSelect = find(content, node => node.type === 'select' && node.props.label === 'Add-on')[0];
    assert.ok(addonSelect.props.options[0].icon);
    const addonIcon = addonSelect.props.options[1].icon;
    assert.equal(find(addonIcon, node => node.type === 'AvatarImage')[0].props.src, 'https://example.invalid/addon.png');
    assert.equal(find(addonIcon, node => node.type === 'AvatarFallback').length, 1);
    assert.equal(find(content, node => node.type === 'summary').length, 40);
    find(content, node => node.type === 'button' && visibleText(node) === 'Show 40 more')[0].props.onClick();
    tree = render();
    content = find(tree, node => node.type === 'DrawerContent')[0];
    assert.equal(find(content, node => node.type === 'summary').length, 80);
    find(content, node => node.type === 'InputGroupInput')[0].props.onChange({ target: { value: 'Rare release' } });
    tree = render();
    content = find(tree, node => node.type === 'DrawerContent')[0];
    assert.equal(find(content, node => node.type === 'summary').length, 1, 'Search includes results outside the current batch');
    assert.equal(find(content, node => node.type === 'summary')[0].props.stream.url, manyStreams[102].url);
    assert.equal(find(tree, node => node.type === 'Drawer')[0].props.open, true);
    find(content, node => node.props['aria-label'] === 'Clear search')[0].props.onClick();
    content = find(render(), node => node.type === 'DrawerContent')[0];
    assert.equal(find(content, node => node.type === 'chips').length, 0, 'Keep the drawer toolbar compact');
    const filter = () => find(content, node => node.type === 'stream-filter-popover')[0];
    filter().props.onChange(['2160p']);
    content = find(render(), node => node.type === 'DrawerContent')[0];
    assert.equal(find(content, node => node.type === 'summary').length, 1);
    assert.equal(find(content, node => node.type === 'summary')[0].props.stream.url, manyStreams[102].url);
    filter().props.onChange([]);
    content = find(render(), node => node.type === 'DrawerContent')[0];
    find(content, node => node.type === 'select' && node.props.label === 'Add-on')[0].props.onValueChange('addon:fixture');
    content = find(render(), node => node.type === 'DrawerContent')[0];
    assert.match(visibleText(find(content, node => node.props.role === 'status')[0]), /103 streams/);
    for (const tag of ['bluray', 'remux', 'dolby-vision', 'hdr10', 'atmos', 'hdr']) {
        filter().props.onChange([tag]);
        content = find(render(), node => node.type === 'DrawerContent')[0];
        assert.equal(find(content, node => node.type === 'summary').length, 1, tag);
    }
    filter().props.onChange(['2160p', 'bluray', 'dolby-vision']);
    content = find(render(), node => node.type === 'DrawerContent')[0];
    assert.equal(visibleText(find(content, node => node.props.role === 'status')[0]), '1 stream', 'Different groups must all match');
    filter().props.onChange(['2160p', '1080p']);
    content = find(render(), node => node.type === 'DrawerContent')[0];
    assert.equal(visibleText(find(content, node => node.props.role === 'status')[0]), '103 streams', 'Resolutions within the same group are alternatives');
    filter().props.onChange(['2160p', 'webrip']);
    content = find(render(), node => node.type === 'DrawerContent')[0];
    assert.equal(visibleText(find(content, node => node.props.role === 'status')[0]), '0 streams', 'No match when a selected group does not match');
    filter().props.onChange(['2160p', 'bluray', 'dolby-vision']);
    content = find(render(), node => node.type === 'DrawerContent')[0];
    find(content, node => node.type === 'button' && node.props['data-player-selection-choice'] === '')[0].props.onClick();
    const closing = find(render(), node => node.type === 'Drawer')[0];
    assert.equal(closing.props.open, false);
    assert.equal(played.length, 0, 'Close before launching playback');
    closing.props.onOpenChangeComplete(false);
    await tick();
    assert.equal(played[0], manyStreams[102].url);
    assert.equal(find(render(), node => node.type === 'summary').length, 3);
    viewport.matches = true;
    find(render(), node => node.type === 'Drawer')[0].props.onOpenChange(true);
    const mobileDrawer = find(render(), node => node.type === 'Drawer')[0];
    assert.equal(mobileDrawer.props.swipeDirection, 'down', 'Mobile opens a bottom sheet');
    assert.equal(mobileDrawer.props.showSwipeHandle, true);
    mobileDrawer.props.onOpenChange(false);
    find(render(), node => node.type === 'Drawer')[0].props.onOpenChangeComplete(false);

    drawer.currentUrl = fileUrl;
    cached = { streams, total: 2, pending: 0, complete: true };
    h.unmount(); h = hooks();
    tree = render(drawer);
    assert.equal(find(tree, node => node.type === 'summary').length, 3, 'Cached results render immediately on open');
    assert.equal(find(render(drawer), node => node.type === 'summary').length, 3, 'Keep cached rows while the request starts');
    publishStreams(streams, 1);
    tree = render(drawer);
    assert.equal(find(tree, node => node.type === 'chips').length, 0);
    const endAddon = find(tree, node => node.type === 'InputGroupAddon' && node.props.align === 'inline-end')[0];
    const status = find(endAddon, node => node.props.role === 'status')[0];
    assert.match(visibleText(status), /1 add-on loading/);
    assert.equal(find(status, node => node.type === 'shimmer').length, 1);
    find(tree, node => node.type === 'InputGroupInput')[0].props.onChange({ target: { value: '2160p' } });
    publishStreams(streams);
    tree = render(drawer);
    assert.equal(visibleText(find(tree, node => node.props.role === 'status')[0]), '1 stream');
    assert.equal(find(tree, node => node.type === 'shimmer').length, 0);
    find(tree, node => node.props['aria-label'] === 'Clear search')[0].props.onClick();
    assert.equal(visibleText(find(render(drawer), node => node.props.role === 'status')[0]), '3 streams');
    publishStreams([], 0, 0);
    tree = render(drawer);
    assert.equal(find(tree, node => node.type === 'InputGroupInput').length, 1, 'Keep search mounted when there are no add-ons');
    assert.equal(visibleText(find(tree, node => node.props.role === 'status')[0]), '0 streams');
    h.unmount();
    const ui = hooks();
    let selected = ['2160p'];
    const { StreamFilterPopover } = load('components/stream-filter-popover.tsx', {
        react: ui.react, 'react/jsx-runtime': ui.jsx,
        'motion/react': { AnimatePresence: 'presence', motion: { span: 'span' }, useReducedMotion: () => true },
        '@/components/arc/popover/popover': Object.fromEntries(['Popover', 'PopoverClose', 'PopoverContent', 'PopoverTrigger'].map(name => [name, name])),
        '@/components/ui/button': { Button: 'button' },
        '@/components/arc/floating-surface.module.css': {},
        './stream-filter-popover.module.css': {},
    });
    const renderFilters = () => ui.render(StreamFilterPopover, { value: selected, onChange: value => { selected = value; } });
    let filters = renderFilters();
    const option = label => find(filters, node => node.type === 'button' && node.props['aria-label'] === label)[0];
    assert.ok(!option('4320p') && !option('Cached'));
    assert.equal(option('2160p').props['aria-pressed'], true);
    assert.equal(option('Dolby Vision').props['aria-pressed'], false);
    option('Dolby Vision').props.onClick();
    filters = renderFilters();
    assert.equal(option('Dolby Vision').props['aria-pressed'], true);
    assert.equal(option('2160p').props['aria-pressed'], true);
    assert.equal(option('Dolby Vision').props.variant, 'default');
    const mark = option('Dolby Vision').props.children[1];
    assert.equal(mark.type(mark.props).props['data-format-logo'], 'dolby-vision');
    assert.ok(require('node:fs').existsSync('public/logo/formats/dolby-vision.svg'));
    for (const [label, filename] of [['Blu-ray', 'bluray'], ['DVD', 'dvd'], ['HDR10+', 'hdr10plus'], ['DTS:X', 'dts-x']]) {
        const format = option(label).props.children[1];
        assert.equal(format.type(format.props).props['data-format-logo'], filename);
        assert.ok(require('node:fs').existsSync(`public/logo/formats/${filename}.svg`));
    }
    const dtsHd = option('DTS-HD').props.children[1];
    assert.equal(dtsHd.type(dtsHd.props), 'DTS-HD', 'Do not use the more specific Master Audio mark for generic DTS-HD');
    assert.equal(find(filters, node => node.props.role === 'status').length, 0, 'The search field owns the result count');
    find(filters, node => node.type === 'button' && node.props['aria-label'] === 'Clear filters')[0].props.onClick();
    assert.equal(selected.length, 0);
    console.log('PASS: stream errors, retry, and direct media downloads');
})().catch(error => { console.error(error); process.exitCode = 1; });
