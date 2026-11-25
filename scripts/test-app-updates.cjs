const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
function find(node, type) {
    if (Array.isArray(node)) return node.flatMap(child => find(child, type));
    if (!node || typeof node !== 'object') return [];
    return [...(node.type === type ? [node] : []), ...find(node.props?.children, type)];
}
for (const platform of ['windows', 'macos']) {
    const host = hooks(), sent = [], settings = hooks(), header = hooks();
    let listener, unsubscribed = 0, bridge;
    const { AppUpdateProvider } = load('components/desktop/app-update-provider.tsx', {
        react: host.react, 'react/jsx-runtime': host.jsx,
        '@/lib/desktop/bridge': { desktopBridge: () => bridge },
        './app-update-dialog': { AppUpdateDialog: 'AppUpdateDialog' },
    });
    let shared = host.render(AppUpdateProvider, {});
    host.flush();
    const updateContext = { useAppUpdate: () => shared.props.value };
    const renderProvider = () => (shared = host.render(AppUpdateProvider, {}));
    const { AppUpdates } = load('components/settings/app-updates.tsx', {
        react: settings.react, 'react/jsx-runtime': settings.jsx,
        '@/lib/desktop/bridge': { desktopBridge: () => bridge },
        '@/components/desktop/app-update-provider': updateContext,
        '@/components/ui/button': { Button: 'Button' }, '@/components/github-icon': { GitHubIcon: 'GitHubIcon' },
        'lucide-react': { ArrowUpRight: 'ArrowUpRight', CheckCircle: 'CheckCircle', FileText: 'FileText' },
        '@/components/external-link-reveal.module.css': { link: 'external-link', arrow: 'external-arrow' },
        '@/components/arc/switch/switch': { Switch: 'Switch' },
        '@/components/motion-primitives/activity-text-shimmer': { ActivityTextShimmer: 'Shimmer' },
        '@/components/ui/field': { Field: 'Field', FieldContent: 'Content', FieldLabel: 'Label', FieldDescription: 'Description' },
        '@/package.json': { version: '0.5.2' }, '@/app/(main)/settings/settings.module.css': { feedback: 'feedback' },
    });
    const { DesktopUpdateButton } = load('components/desktop-update-button.tsx', {
        react: header.react, 'react/jsx-runtime': header.jsx,
        'lucide-react': { Download: 'Download' }, '@/components/ui/button': { Button: 'Button' },
        '@/components/desktop/app-update-provider': updateContext,
    });
    const settingsTree = () => settings.render(AppUpdates);
    const headerTree = () => header.render(DesktopUpdateButton);
    let tree = settingsTree();
    const github = find(tree, 'Button')[0];
    assert.equal(github.props.variant, 'outline');
    assert.equal(github.props.size, 'sm');
    assert.equal(find(github, 'a')[0].props.href, 'https://github.com/AyaanZaveri/navigator/releases');
    assert.equal(find(github, 'GitHubIcon').length, 1);
    assert.equal(find(tree, 'Switch').length, 0);
    assert.doesNotMatch(JSON.stringify(tree), /In-app|Windows|macOS|Check for updates|update-status/, 'Web shows no desktop update promotion or native controls');
    assert.equal(sent.length, 0);
    bridge = { platform, capabilities: { updates: true, updateReview: true }, send: request => sent.push(request), subscribe: cb => { listener = cb; return () => unsubscribed++; } };
    host.replay();
    assert.equal(sent[0].type, 'update-status');
    const status = (state, props = {}) => {
        listener({ type: 'update-status', version: '0.5.2', available: true, automatic: true, state, ...props });
        renderProvider();
    };
    status('idle');
    tree = settingsTree();
    find(tree, 'Button').find(button => button.props.children === 'Check for updates').props.onClick();
    assert.deepEqual({ ...sent.at(-1) }, { type: 'update-check', intent: 'prepare' });
    find(tree, 'Switch')[0].props.onCheckedChange(false);
    assert.equal(sent.at(-1).type, 'update-automatic'); assert.equal(sent.at(-1).enabled, false);
    for (const [state, label] of [['checking', 'Checking for updates…'], ['downloading', 'Downloading update…'], ['installing', 'Restarting Navigator…']]) {
        status(state, { message: 'Background progress' });
        tree = settingsTree();
        const button = find(tree, 'Button').find(button => button.props['aria-busy']);
        assert.equal(button.props.disabled, true);
        assert.equal(button.props['aria-busy'], true);
        assert.equal(find(button, 'Shimmer')[0].props.children, label);
        const statusMessage = find(tree, 'p').find(node => node.props.role === 'status');
        assert.equal(statusMessage.props.className, 'sr-only');
        assert.equal(statusMessage.props.children, label);
        assert.doesNotMatch(JSON.stringify(tree), /Background progress|in the background/);
        assert.equal(headerTree(), null);
    }
    for (const [state, label] of [['available', 'Update available'], ['ready', 'Update ready']]) {
        status(state, { nextVersion: '0.5.3' });
        const settingsButton = find(settingsTree(), 'Button').find(button => button.props.children === 'Review update');
        const indicator = headerTree();
        assert.equal(find(indicator, 'span')[0].props.children, label);
        assert.equal(indicator.props['aria-haspopup'], 'dialog');
        assert.equal(indicator.props.className, 'max-sm:size-11 max-sm:p-0');
        const commandCount = sent.length;
        for (const entry of [settingsButton, indicator]) {
            const trigger = {};
            entry.props.onClick({ currentTarget: trigger });
            const dialog = find(renderProvider(), 'AppUpdateDialog');
            assert.equal(dialog.length, 1, 'Both entry points use one shared dialog');
            assert.equal(dialog[0].props.status.nextVersion, '0.5.3');
            assert.equal(dialog[0].props.open, true);
            assert.equal(dialog[0].props.triggerRef.current, trigger);
            dialog[0].props.onClose();
            assert.equal(find(renderProvider(), 'AppUpdateDialog')[0].props.open, false);
        }
        assert.equal(sent.length, commandCount, 'Reviewing or closing the dialog never requests a restart');
    }
    const dialog = find(shared, 'AppUpdateDialog')[0];
    dialog.props.requestUpdate('install');
    assert.deepEqual({ ...sent.at(-1) }, { type: 'update-check', intent: 'install' });
    bridge.capabilities.updateReview = false;
    dialog.props.requestUpdate('install');
    assert.deepEqual({ ...sent.at(-1) }, { type: 'update-check' }, 'Older bridges retain the original command');
    status('current');
    tree = settingsTree();
    const feedback = find(tree, 'p').find(node => node.props.role === 'status');
    assert.match(feedback.props.className, /\bfeedback\b/);
    assert.ok(feedback.props.children.props.children.includes('You’re up to date.'));
    assert.equal(find(feedback, 'CheckCircle')[0].props['aria-hidden'], 'true');
    const installedNotes = find(tree, 'Button').find(button => Array.isArray(button.props.children) && button.props.children.includes('Release notes'));
    assert.equal(find(installedNotes, 'FileText')[0].props['aria-hidden'], 'true');
    installedNotes.props.onClick({ currentTarget: {} });
    assert.equal(find(renderProvider(), 'AppUpdateDialog')[0].props.view, 'installed');
    status('error', { available: false, message: 'Couldn’t check for updates.' });
    tree = settingsTree();
    assert.equal(find(tree, 'Button').filter(button => button.props.onClick).length, 0);
    assert.match(JSON.stringify(tree), /Couldn’t check/);
    host.unmount(); assert.equal(unsubscribed, 1);
    assert.equal(headerTree(), null);
    console.log(`PASS: ${platform} update commands, preference, statuses, cleanup and offered-update indicator; web-only version/GitHub button.`);
}

// Native startup owns the schedule. React mounts request status only, never a
// user-initiated check that could display a modal when opening the app.
const fs = require('node:fs');
const button = fs.readFileSync('components/desktop/app-update-provider.tsx', 'utf8');
assert.match(button, /bridge\.send\(\{ type: "update-status" \}\)/);
assert.doesNotMatch(button.slice(button.indexOf('useEffect(()'), button.indexOf('const openUpdate')), /update-check/);
for (const file of ['desktop/src/windows_shell.rs', 'desktop/src/tao_shell.rs']) {
    const shell = fs.readFileSync(file, 'utf8');
    assert.match(shell, /let mut next_update_probe = Instant::now\(\)/, 'First check is due at launch, not after an interval');
    assert.match(shell, /!closing && automatic_updates && updater\.is_some\(\) && Instant::now\(\) >= next_update_probe/);
    assert.match(shell, /updater\.as_ref\(\)\.unwrap\(\)\.probe\(\)/);
    assert.match(shell, /ControlFlow::WaitUntil\(next_update_probe\)/, 'Periodic checks must wake an idle app');
}
const mac = fs.readFileSync('desktop/src/macos_updater.rs', 'utf8');
assert.match(mac, /checkForUpdatesInBackground/);
assert.match(mac, /self\.driver\.install\(\)/);
const driver = fs.readFileSync('desktop/src/macos_updater/driver.rs', 'utf8');
assert.match(driver, /showReadyToInstallAndRelaunch:/);
assert.match(driver, /ready\.call\(\(0,\)\)/, 'Normal quit cancels a pending installation instead of selecting restart');
assert.match(mac, /method\(updaterWillRelaunchApplication:\)/, 'Sparkle readiness explicitly finishes our event loop shutdown');
const shell = fs.readFileSync('desktop/src/tao_shell.rs', 'utf8');
assert.match(shell, /install_should_exit\(update, quit\)/, 'The post-handoff branch must keep quit and relaunch events live');
assert.match(shell, /UpdateEvent::Install => \{ update_state = "installing"/, 'The update button cannot remain available after installation starts');
assert.doesNotMatch(mac, /setAutomaticallyChecksForUpdates: (?:true|automatic|enabled)/);
const windows = fs.readFileSync('desktop/src/windows_updater.rs', 'utf8');
assert.match(windows, /automatic_fn\(0\)/);
assert.match(windows, /timeout_global\(Some\(Duration::from_secs\(10\)\)\)/);
assert.match(windows, /limit\(64 \* 1024\)/);
assert.match(windows, /windows_update_available\(&feed, env!\("CARGO_PKG_VERSION"\)\)/);
assert.doesNotMatch(windows, /get!\("win_sparkle_check_update_without_ui"/);
const header = fs.readFileSync('components/app-header.tsx', 'utf8');
assert.ok(header.indexOf('<DesktopUpdateButton />') < header.indexOf('{authenticated ? <ProfileMenu'), 'Update button sits immediately before the avatar');
console.log('PASS: silent launch/hourly probes, automatic-check preference, native download handoff and avatar-side placement');

async function checkReleaseNotes() {
    const { formatReleaseNotesForDialog } = load('lib/app-update-notes.ts');
    const urls = [];
    const tag = 'release-v0.6.13';
    const releasesPage = 'https://github.com/AyaanZaveri/navigator/releases';
    const releasesApi = 'https://api.github.com/repos/AyaanZaveri/navigator/releases';
    const releasePage = `${releasesPage}/tag/${tag}`;
    const releaseApi = `${releasesApi}/tags/${tag}`;
    const listPage = page => `${releasesApi}?per_page=100&page=${page}`;
    const releaseEntry = (version, notes, flags) => ({ tag_name: `release-v${version}`, draft: false, prerelease: false,
        body: `### New features and improvements\n\n- ${notes}\n\n### macOS installation\n\nManual instructions`, ...flags });
    const releaseSection = (version, notes, badge = '') => `<section data-release-anchor="release-release-v${version}">${badge}
        <div class="markdown-body" data-test-selector="body-content"><h3>Fixes</h3><ul><li>${notes}</li></ul></div></section>`;
    let rateLimited = false;
    let tagMissing = false;
    let publicTagUnavailable = false;
    let publicListUnavailable = false;
    const { githubReleaseNotes, githubReleaseHistory } = load('lib/server/github-release-notes.ts', {
        'server-only': {},
        './outbound-fetch': { outboundFetch: async (url, options) => {
            urls.push(url);
            assert.equal(options.redirect, 'follow', 'GitHub repository rename redirects use the bounded public fetch guard');
            if (url === listPage(1)) {
                if (rateLimited) return new Response(null, { status: 403 });
                return Response.json([releaseEntry('0.6.9', 'Installed'), releaseEntry('0.6.13', 'Better seeking'),
                    releaseEntry('0.6.14', 'Future'), releaseEntry('0.6.11', 'Preview', { prerelease: true })], {
                    headers: { Link: `<${listPage(2)}>; rel="next"` },
                });
            }
            if (url === listPage(2)) return Response.json([releaseEntry('0.6.10', 'Better playback'),
                releaseEntry('0.6.12', 'Subtitle fixes'), releaseEntry('0.6.12', 'Draft', { draft: true })]);
            if (url === releasesPage) {
                if (publicListUnavailable) return new Response(null, { status: 503 });
                return new Response(releaseSection('0.6.13', 'Better seeking') + releaseSection('0.6.14', 'Future')
                    + '<a rel="next" href="?page=2">Next</a>');
            }
            if (url === `${releasesPage}?page=2`) return new Response(releaseSection('0.6.12', 'Subtitle fixes')
                + releaseSection('0.6.11', 'Preview', '<span class="Label Label--warning">Pre-release</span>')
                + releaseSection('0.6.10', 'Better playback') + releaseSection('0.6.9', 'Installed'));
            if (url === releaseApi) {
                if (tagMissing) return new Response(null, { status: 404 });
                if (rateLimited) return new Response(null, { status: 403 });
                return Response.json({ tag_name: tag, draft: false, body: [
                    '# Navigator 0.6.13', '### New features and improvements', '- Better seeking',
                    '### macOS installation', 'Manual instructions',
                ].join('\n\n') });
            }
            assert.equal(url, releasePage);
            if (publicTagUnavailable) return new Response(null, { status: 404 });
            return new Response(`<div class="markdown-body" data-test-selector="body-content">
                <h3>New features and improvements</h3>
                <ul><li><strong>Seek controls.</strong> Use the saved intervals &amp; labels.</li></ul>
                <h3>macOS installation</h3><p>Manual instructions</p>
            </div>`);
        } },
    });
    const { GET } = load('app/api/updates/release-notes/route.ts', {
        '@/lib/server/github-release-notes': { githubReleaseNotes, githubReleaseHistory },
    }, { URL, Response });
    const url = 'http://localhost/api/updates/release-notes?version=';
    assert.equal((await GET(new Request(url + 'latest'))).status, 400);
    for (const since of ['latest', '0.6.13', '0.6.14']) {
        assert.equal((await GET(new Request(`${url}0.6.13&since=${since}`))).status, 400);
    }
    assert.equal(urls.length, 0, 'Invalid versions fail before reaching GitHub');
    const request = () => new Request(url + '0.6.13');
    assert.deepEqual(await (await GET(request())).json(), { notes: '- Better seeking' });
    assert.deepEqual(urls, [releaseApi]);
    const rangeRequest = () => new Request(`${url}0.6.13&since=0.6.9`);
    const range = { complete: true, releases: [{ version: '0.6.13', notes: '- Better seeking' },
        { version: '0.6.12', notes: '- Subtitle fixes' }, { version: '0.6.10', notes: '- Better playback' }] };
    assert.deepEqual(await (await GET(rangeRequest())).json(), range);
    assert.deepEqual(urls.splice(0), [releaseApi, listPage(1), listPage(2)]);
    rateLimited = true;
    const { notes } = await (await GET(request())).json();
    assert.equal(notes, '- **Seek controls.** Use the saved intervals \\& labels.');
    assert.equal(formatReleaseNotesForDialog(notes), '- **Seek controls** Use the saved intervals \\& labels.');
    assert.equal(formatReleaseNotesForDialog('- **More to come…** Stay tuned.\n- **Playback improved.**\n- Playback is **more reliable.**'),
        '- **More to come…** Stay tuned.\n- **Playback improved.**\n- Playback is **more reliable.**');
    assert.deepEqual(urls.splice(0), [releaseApi, releasePage], 'Fallback uses the same release tag');
    assert.deepEqual(await (await GET(rangeRequest())).json(), range);
    assert.deepEqual(urls.splice(0), [listPage(1), releasesPage, `${releasesPage}?page=2`]);
    publicListUnavailable = true;
    const partial = await GET(rangeRequest());
    assert.equal(partial.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await partial.json(), { complete: false, releases: [{ version: '0.6.13', notes }] });
    urls.splice(0);
    tagMissing = true;
    const adjacent = await GET(new Request(`${url}0.6.13&since=0.6.12`));
    assert.deepEqual(await adjacent.json(), { complete: true, releases: [{ version: '0.6.13', notes }] },
        'A temporarily missing GitHub API entry must not hide a published release’s notes');
    assert.deepEqual(urls.splice(0), [releaseApi, releasePage], 'Adjacent updates should not scan the migrated release history');
    assert.deepEqual(await (await GET(request())).json(), { notes }, 'Exact release notes also recover from API 404');
    assert.deepEqual(urls.splice(0), [releaseApi, releasePage]);
    publicTagUnavailable = true;
    const unavailable = await GET(request());
    assert.equal(unavailable.status, 404);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store', 'Do not cache an upstream publication failure');
    console.log('PASS: exact notes and paginated release history, version range and order, prerelease filtering, GitHub public fallback and partial recovery.');
}

async function checkReleaseNotesDialog() {
    const dialog = hooks();
    const requests = [];
    const { AppUpdateDialog } = load('components/desktop/app-update-dialog.tsx', {
        react: dialog.react, 'react/jsx-runtime': dialog.jsx,
        'lucide-react': { ArrowUpRight: 'ArrowUpRight' }, 'react-markdown': 'Markdown',
        '@/components/account-ui/dialog': Object.fromEntries(['Dialog', 'DialogClose', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle'].map(name => [name, name])),
        '@/components/account-ui/surface.module.css': {}, '@/components/external-link-reveal.module.css': {},
        '@/components/ui/button': { Button: 'Button' }, '@/components/github-icon': { GitHubIcon: 'GitHubIcon' },
        '@/components/ui/loading-placeholder': { LoadingPlaceholder: 'LoadingPlaceholder' }, '@/components/ui/skeleton': { Skeleton: 'Skeleton' },
        '@/components/motion-primitives/activity-text-shimmer': { ActivityTextShimmer: 'Shimmer' },
    }, { fetch: async url => {
        requests.push(url);
        const data = url.includes('&since=') ? { complete: true, releases: [
            { version: '0.6.13', notes: 'Seek fixes' }, { version: '0.6.12', notes: 'Subtitle fixes' },
        ] } : { notes: 'Installed changes' };
        return { ok: true, json: async () => data };
    } });
    const props = { open: true, status: { state: 'ready', version: '0.6.11', nextVersion: '0.6.13' } };
    async function renderNotes(view) {
        const render = () => dialog.render(AppUpdateDialog, { ...props, view });
        render();
        dialog.flush();
        await new Promise(resolve => setImmediate(resolve));
        return render();
    }
    const update = await renderNotes('update');
    assert.equal(find(update, 'DialogTitle')[0].props.children, 'What’s new since Navigator 0.6.11');
    assert.deepEqual(find(update, 'h3').map(heading => heading.props.children.join('')), ['Navigator 0.6.13', 'Navigator 0.6.12']);
    const installed = await renderNotes('installed');
    assert.equal(find(installed, 'DialogTitle')[0].props.children, 'What’s new in Navigator 0.6.11');
    assert.equal(find(installed, 'Markdown')[0].props.children, 'Installed changes');
    assert.deepEqual(requests, ['/api/updates/release-notes?version=0.6.13&since=0.6.11', '/api/updates/release-notes?version=0.6.11']);
    for (const [state, label] of [['checking', 'Checking for updates…'], ['downloading', 'Downloading update…'], ['installing', 'Restarting Navigator…']]) {
        const pending = dialog.render(AppUpdateDialog, { ...props, view: 'update', status: { ...props.status, state } });
        assert.equal(find(pending, 'Shimmer').length, 1, 'A single progress label animates');
        assert.equal(find(pending, 'Shimmer')[0].props.children, label);
    }
    assert.equal(find(dialog.render(AppUpdateDialog, { ...props, view: 'update' }), 'Shimmer').length, 0);
    dialog.unmount();
}

Promise.all([checkReleaseNotes(), checkReleaseNotesDialog()]).catch(error => { console.error(error); process.exitCode = 1; });
