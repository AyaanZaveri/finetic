const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
function find(node, type) {
    if (Array.isArray(node)) return node.flatMap(child => find(child, type));
    if (!node || typeof node !== 'object') return [];
    return [...(node.type === type ? [node] : []), ...find(node.props?.children, type)];
}
for (const platform of ['windows', 'macos']) {
    const host = hooks(), sent = [];
    let listener, unsubscribed = 0, bridge;
    const { AppUpdates } = load('components/settings/app-updates.tsx', {
        react: host.react, 'react/jsx-runtime': host.jsx,
        '@/lib/desktop/bridge': { desktopBridge: () => bridge },
        '@/components/ui/button': { Button: 'Button' }, '@/components/github-icon': { GitHubIcon: 'GitHubIcon' },
        '@/components/arc/switch/switch': { Switch: 'Switch' },
        '@/components/ui/field': { Field: 'Field', FieldContent: 'Content', FieldLabel: 'Label', FieldDescription: 'Description' },
        '@/package.json': { version: '0.5.2' }, '@/app/(main)/settings/settings.module.css': {},
    });
    let tree = host.render(AppUpdates); host.flush();
    const github = find(tree, 'Button')[0];
    assert.equal(github.props.variant, 'outline');
    assert.equal(github.props.size, 'sm');
    assert.equal(find(github, 'a')[0].props.href, 'https://github.com/AyaanZaveri/navigator/releases');
    assert.equal(find(github, 'GitHubIcon').length, 1);
    assert.equal(find(tree, 'Switch').length, 0);
    assert.doesNotMatch(JSON.stringify(tree), /In-app|Windows|macOS|Check for updates|update-status/, 'Web shows no desktop update promotion or native controls');
    assert.equal(sent.length, 0);
    bridge = { platform, capabilities: { updates: true }, send: request => sent.push(request), subscribe: cb => { listener = cb; return () => unsubscribed++; } };
    host.replay();
    assert.equal(sent[0].type, 'update-status');
    listener({ type: 'update-status', version: '0.5.2', available: true, automatic: true, state: 'idle' });
    tree = host.render(AppUpdates); host.flush();
    find(tree, 'Button').find(button => button.props.onClick).props.onClick();
    assert.equal(sent.at(-1).type, 'update-check');
    find(tree, 'Switch')[0].props.onCheckedChange(false);
    assert.equal(sent.at(-1).type, 'update-automatic'); assert.equal(sent.at(-1).enabled, false);
    listener({ type: 'update-status', version: '0.5.2', available: true, automatic: false, state: 'checking' });
    tree = host.render(AppUpdates);
    assert.equal(find(tree, 'Button').find(button => button.props.onClick).props.disabled, true);
    listener({ type: 'update-status', version: '0.5.2', available: false, automatic: false, state: 'error', message: 'Couldn’t check for updates.' });
    tree = host.render(AppUpdates);
    assert.equal(find(tree, 'Button').filter(button => button.props.onClick).length, 0);
    assert.match(JSON.stringify(tree), /Couldn’t check/);
    host.unmount(); assert.equal(unsubscribed, 1);
    const header = hooks();
    const { DesktopUpdateButton } = load('components/desktop-update-button.tsx', {
        react: header.react, 'react/jsx-runtime': header.jsx,
        'next/link': 'Link', 'lucide-react': { Download: 'Download' }, '@/components/ui/button': { Button: 'Button' },
        '@/lib/desktop/bridge': { desktopBridge: () => bridge }, './app-header.module.css': { signIn: 'sign-in-material' },
    });
    header.render(DesktopUpdateButton); header.flush();
    for (const state of ['idle', 'checking', 'downloading', 'current', 'error']) {
        listener({ type: 'update-status', version: '0.5.2', available: true, automatic: true, state });
        assert.equal(header.render(DesktopUpdateButton), null);
    }
    listener({ type: 'update-status', version: '0.5.2', available: true, automatic: true, state: 'available' });
    const indicator = header.render(DesktopUpdateButton);
    assert.equal(typeof indicator.props.onClick, 'function');
    assert.equal(find(indicator, 'Link').length, 0, 'Available updates open the native updater without routing through Settings');
    assert.equal(find(indicator, 'span')[0].props.children, 'Update available');
    assert.match(indicator.props['aria-label'], /Update available/);
    indicator.props.onClick();
    assert.equal(sent.at(-1).type, 'update-check');
    assert.equal(indicator.props.variant, 'outline');
    assert.equal(indicator.props.className, 'max-sm:size-11 max-sm:p-0', 'Update and Sign in share default button geometry and material');
    assert.equal(indicator.props.size, undefined, 'Use the same default size as Sign in');
    listener({ type: 'update-status', version: '0.5.2', available: true, automatic: true, state: 'ready' });
    const ready = header.render(DesktopUpdateButton);
    assert.equal(find(ready, 'span')[0].props.children, 'Restart to update');
    ready.props.onClick(); assert.equal(sent.at(-1).type, 'update-check');
    listener({ type: 'update-status', version: '0.5.2', available: false, automatic: true, state: 'available' });
    assert.equal(header.render(DesktopUpdateButton), null);
    header.unmount();
    console.log(`PASS: ${platform} update commands, preference, statuses, cleanup and offered-update indicator; web-only version/GitHub button.`);
}

// Native startup owns the schedule. React mounts request status only, never a
// user-initiated check that could display a modal when opening the app.
const fs = require('node:fs');
const button = fs.readFileSync('components/desktop-update-button.tsx', 'utf8');
assert.match(button, /bridge\.send\(\{ type: "update-status" \}\)/);
assert.doesNotMatch(button.slice(button.indexOf('useEffect'), button.indexOf('if (!status')), /update-check/);
for (const file of ['desktop/src/windows_shell.rs', 'desktop/src/tao_shell.rs']) {
    const shell = fs.readFileSync(file, 'utf8');
    assert.match(shell, /let mut next_update_probe = Instant::now\(\)/, 'First check is due at launch, not after an interval');
    const readiness = file.endsWith('tao_shell.rs') ? 'interface_loaded && ' : '';
    assert.ok(shell.includes(`!closing && ${readiness}automatic_updates && updater.is_some() && Instant::now() >= next_update_probe`),
        'Automatic checks must wait for macOS startup and honor the saved preference');
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
assert.match(shell, /UpdateEvent::Install => \{ update_state = "idle"/, 'The update button cannot remain available after installation starts');
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
