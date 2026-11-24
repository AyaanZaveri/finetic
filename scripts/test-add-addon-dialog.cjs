const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

async function main() {
    const h = hooks();
    const mediaQuery = new EventTarget();
    mediaQuery.matches = false;
    const timers = new Map();
    const lookups = [];
    const palettes = [];
    let readClipboard = async () => "";
    let timerId = 0;
    let installs = 0;
    const components = names => Object.fromEntries(names.map(name => [name, name]));
    let previewHost = hooks();
    const dependencies = {
        react: { ...h.react, useId: () => 'test-addon', useTransition: () => [false, work => { void work(); }] },
        'react/jsx-runtime': h.jsx,
        'next/navigation': { useRouter: () => ({ refresh() {} }) },
        'next/image': { default: 'img' },
        'lucide-react': components(['ArrowUpRight', 'Check', 'Copy', 'ExternalLink', 'Link2', 'Loader2', 'Plus', 'Puzzle', 'X']),
        sonner: { toast: { success() {} } },
        '@/app/actions/addons': {
            previewAddon: link => new Promise(resolve => lookups.push({ link, resolve })),
            installAddon: async () => { installs++; return { error: null }; },
        },
        '@/components/account-ui/drawer': components(['Drawer', 'DrawerContent', 'DrawerDescription', 'DrawerHeader', 'DrawerTitle']),
        '@/components/account-ui/dialog': components(['Dialog', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle']),
        '@/components/ui/button': components(['Button']),
        '@/components/ui/input-group': components(['InputGroup', 'InputGroupInput', 'InputGroupAddon']),
        '@/components/ui/field': components(['Field', 'FieldDescription', 'FieldError', 'FieldGroup', 'FieldLabel']),
        '@/components/ui/avatar': components(['Avatar', 'AvatarFallback', 'AvatarImage']),
        '@/components/ui/badge': components(['Badge']),
        '@/lib/addons': load('lib/addons.ts', {}),
        '@/lib/aurora-palette-loader': { loadHomePalette: source => new Promise(resolve => palettes.push({ source, resolve })) },
        '@/components/account-ui/surface.module.css': { surface: 'surface', addonBackdrop: 'addon-backdrop' },
        '@/components/external-link-reveal.module.css': { link: 'browse-link', arrow: 'browse-arrow' },
        './addon-preview.module.css': { card: 'preview-card', artwork: 'preview-artwork' },
    };
    const { AddonPreviewCard } = load('components/addon-preview-card.tsx', {
        ...dependencies, react: new Proxy({}, { get: (_, key) => previewHost.react[key] }),
    });
    const shareHost = hooks();
    const { AddonShareContent } = load('components/addon-share-content.tsx', {
        ...dependencies,
        react: { ...shareHost.react, useId: () => 'share-fixture' },
        '@/components/addon-preview-card': { AddonPreviewCard },
    }, {
        window: { matchMedia: query => { assert.equal(query, "(max-width: 639px)"); return mediaQuery; } },
    });
    const { groups, fixture } = load('app/states/addon-share/fixtures.ts');
    for (const mobile of [false, true]) for (const { id } of groups.flatMap(group => group.states)) {
        mediaQuery.matches = mobile;
        mediaQuery.dispatchEvent(new Event('change'));
        const { addon, share } = fixture(id);
        const onCopy = () => {};
        const props = { addon, state: share, open: true, onOpenChange() {}, onCopy, finalFocus: { current: null } };
        shareHost.render(AddonShareContent, props); shareHost.flush();
        const content = nodes(shareHost.render(AddonShareContent, props));
        const shell = content.find(node => node.type === (mobile ? 'DrawerContent' : 'DialogContent'));
        assert.equal(shell.props.finalFocus, props.finalFocus, 'Closing restores focus to the Share button');
        assert.match(shell.props.className, /surface/);
        assert.equal(shell.props.overlayClassName, 'addon-backdrop');
        const card = content.find(node => node.type === AddonPreviewCard);
        assert.equal(card.props.addon, addon, 'Sharing uses the install preview card in every state');
        const link = content.find(node => node.type === 'InputGroupInput');
        assert.equal(link?.props.value, share.url);
        if (link) assert.equal(link.props.readOnly, true);
        const copy = content.find(node => node.type === 'Button' && node.props.onClick === onCopy);
        assert.equal(copy.props.disabled, !share.url);
        assert.equal(copy.props['aria-disabled'], share.kind === 'copying' || undefined);
        assert.ok(copy.props.children.includes('Copy link'), 'The button label stays steady while reading the clipboard result');
        assert.equal(nodes(copy).find(node => node.type === 'span').props['data-copied'], share.kind === 'copied' || undefined);
    }
    shareHost.unmount();
    mediaQuery.matches = false;
    const { AddAddonDialog } = load('components/add-addon-dialog.tsx', {
        ...dependencies, '@/components/addon-preview-card': { AddonPreviewCard },
    }, {
        URL,
        navigator: { clipboard: { readText: () => readClipboard() } },
        window: { matchMedia: query => { assert.equal(query, "(max-width: 639px)"); return mediaQuery; } },
        setTimeout: (work, delay) => { assert.equal(delay, 600); timers.set(++timerId, work); return timerId; },
        clearTimeout: id => timers.delete(id),
    });
    const render = () => {
        h.render(AddAddonDialog); h.flush();
        const tree = h.render(AddAddonDialog);
        const preview = nodes(tree).find(node => node.type === AddonPreviewCard);
        if (preview) {
            const card = previewHost.render(AddonPreviewCard, preview.props);
            previewHost.flush();
            Object.assign(preview, card);
        } else { previewHost.unmount(); previewHost = hooks(); }
        return tree;
    };
    const find = type => nodes(render()).find(node => node.type === type);
    const change = value => { find('InputGroupInput').props.onChange({ target: { value } }); render(); };
    const runTimers = () => { const work = [...timers.values()]; timers.clear(); work.forEach(run => run()); };
    const result = (name, logo) => ({ addon: { id: name, name, logo, version: '1', capabilities: [], types: [] }, configureUrl: null, configurationRequired: false, error: null });

    find('Button').props.onClick(); render();
    assert.ok(find('Link2'), 'The empty input uses the link icon');
    change('https://example.com/mani');
    assert.equal(timers.size, 0, 'Incomplete links do not trigger network lookups');
    change('https://example.com/manifest.json');
    assert.equal(lookups.length, 0, 'Typing schedules a lookup without fetching immediately');
    change('https://example.com/config/manifest.json');
    assert.equal(timers.size, 1, 'Typing again replaces the debounce timer');
    runTimers(); render();
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0].link, 'https://example.com/config/manifest.json');
    assert.ok(find('Loader2'), 'Loading has visible feedback');
    assert.ok(find('Link2'), 'The input retains its link icon during loading');
    assert.equal(nodes(render()).find(node => node.type === 'Button' && node.props.type === 'submit').props['aria-busy'], true);
    change('stremio://example.com/new/manifest.json');
    runTimers(); render();
    lookups[0].resolve(result('Old addon', 'https://example.com/old.png')); await tick();
    assert.equal(find('AvatarImage'), undefined, 'An older lookup cannot show the wrong addon icon');
    lookups[1].resolve(result('New addon', 'https://example.com/new.png')); await tick();
    assert.equal(find('AvatarImage').props.src, 'https://example.com/new.png');
    assert.equal(nodes(render()).filter(node => node.type === 'AvatarImage').length, 1, 'The logo appears only in the preview');
    assert.ok(find('Link2'), 'The reviewed input retains its link icon');
    assert.equal(palettes[0].source, 'https://example.com/new.png');
    palettes[0].resolve(['#8855aa']); await tick();
    assert.equal(find('section').props.style['--addon-color'], '#8855aa', 'The preview uses the logo dominant color');
    assert.equal(installs, 0, 'Automatic review never installs an addon');
    assert.ok(nodes(render()).some(node => node.type === 'a' && node.props.href === 'https://stremio-addons.net/'));

    change('https://example.com/last/manifest.json'); runTimers(); render();
    find('Dialog').props.onOpenChange(false); render();
    lookups[2].resolve(result('Closed addon', 'https://example.com/closed.png')); await tick();
    assert.equal(find('AvatarImage'), undefined, 'Closing cancels delivery of an in-flight icon lookup');
    assert.equal(find('InputGroupInput').props.value, '');
    find('Button').props.onClick(); render();
    change('https://example.com/manual/manifest.json');
    find('form').props.onSubmit({ preventDefault() {} });
    runTimers();
    assert.equal(lookups.length, 4, 'Manual review supersedes the pending automatic lookup');
    lookups[3].resolve(result('Manual addon')); await tick();
    assert.ok(find('Puzzle'), 'An addon without a logo gets a stable fallback icon');
    assert.equal(find('section').props.style, undefined, 'An addon without artwork cannot inherit the previous logo color');
    mediaQuery.matches = true;
    mediaQuery.dispatchEvent(new Event('change'));
    assert.equal(find('Dialog'), undefined, 'Mobile replaces the dialog with a drawer');
    assert.equal(find('Drawer').props.open, true, 'Changing presentation keeps the drawer open');
    assert.equal(find('Drawer').props.showSwipeHandle, true);
    assert.ok(find('DrawerContent').props.className.includes('[--drawer-inset:0.5rem] after:hidden'), 'Drawer matches the sign-in inset');
    assert.equal(find('DrawerHeader').props.className, 'relative p-6 pb-0');
    assert.ok(nodes(render()).some(node => node.type === 'Button' && node.props['aria-label'] === 'Close'), 'Mobile has a named close control');
    assert.equal(nodes(render()).some(node => node.type === 'Button' && node.props.children === 'Cancel'), false, 'Mobile omits the footer Cancel action');
    const mobileNodes = nodes(render());
    const primaryIndex = mobileNodes.findIndex(node => node.type === 'Button' && node.props.type === 'submit');
    const browseIndex = mobileNodes.findIndex(node => node.type === 'a' && node.props.href === 'https://stremio-addons.net/');
    assert.ok(primaryIndex < browseIndex, 'Mobile shows the primary action before Browse addons');
    assert.equal(mobileNodes[primaryIndex].props.className, 'w-full');
    assert.equal(mobileNodes[primaryIndex].props.size, 'default');
    assert.equal(find('InputGroupInput').props.value, 'https://example.com/manual/manifest.json', 'Changing presentation preserves the link');
    find('Drawer').props.onOpenChange(false); render();
    assert.equal(find('InputGroupInput').props.value, '', 'Drawer dismissal resets addon state');
    mediaQuery.matches = false;
    mediaQuery.dispatchEvent(new Event('change'));
    assert.ok(find('Dialog'), 'Desktop retains the dialog');
    find('Dialog').props.onOpenChange(false); render();
    readClipboard = async () => '  stremio://example.com/clipboard/manifest.json  ';
    find('Button').props.onClick(); await tick(); render();
    assert.equal(find('InputGroupInput').props.value, 'stremio://example.com/clipboard/manifest.json', 'Opening fills a valid clipboard manifest link');
    assert.equal(installs, 0, 'Clipboard prefill never installs automatically');
    find('Dialog').props.onOpenChange(false); render();
    readClipboard = async () => 'unrelated private clipboard text';
    find('Button').props.onClick(); await tick(); render();
    assert.equal(find('InputGroupInput').props.value, '', 'Unrelated clipboard text is ignored');
    find('Dialog').props.onOpenChange(false); render();
    readClipboard = async () => { throw new Error('Permission denied'); };
    find('Button').props.onClick(); await tick(); render();
    assert.equal(find('Dialog').props.open, true, 'Denied clipboard access keeps manual entry available');
    let deliverClipboard;
    readClipboard = () => new Promise(resolve => { deliverClipboard = resolve; });
    find('Dialog').props.onOpenChange(false); render();
    find('Button').props.onClick(); render();
    change('https://example.com/typed/manifest.json');
    deliverClipboard('https://example.com/clipboard/manifest.json'); await tick(); render();
    assert.equal(find('InputGroupInput').props.value, 'https://example.com/typed/manifest.json', 'Late clipboard reads cannot overwrite typing');
    find('Dialog').props.onOpenChange(false); render();
    find('Button').props.onClick(); render();
    find('Dialog').props.onOpenChange(false); render();
    deliverClipboard('https://example.com/clipboard/manifest.json'); await tick(); render();
    assert.equal(find('InputGroupInput').props.value, '', 'Late clipboard reads cannot repopulate a closed dialog');
    mediaQuery.matches = true;
    mediaQuery.dispatchEvent(new Event('change'));
    readClipboard = async () => '';
    find('Button').props.onClick(); await tick(); render();
    change('https://example.com/setup/manifest.json');
    find('form').props.onSubmit({ preventDefault() {} });
    const required = result('Setup addon');
    required.configurationRequired = true;
    required.configureUrl = 'https://example.com/setup/configure';
    lookups.at(-1).resolve(required); await tick(); render();
    const configure = nodes(render()).find(node => node.type === 'Button' && node.props.children?.props?.href === required.configureUrl);
    assert.equal(configure.props.className, 'w-full', 'Required configuration uses the full-width primary action');
    assert.equal(find('ExternalLink').props.strokeWidth, 1.75);
    nodes(render()).find(node => node.type === 'Button' && node.props['aria-label'] === 'Close').props.onClick(); render();
    assert.equal(find('Drawer').props.open, false, 'Header close dismisses the drawer');
    assert.equal(find('InputGroupInput').props.value, '', 'Header close resets the link');
    h.unmount();
    previewHost.unmount();
    console.log('PASS: debounced addon lookup, icon loading/fallback, stale result protection, cancel, directory link, and explicit install boundary');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
