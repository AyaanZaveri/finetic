const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

function all(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
}
async function main() {
    const h = hooks();
    const calls = [];
    let complete, completeLink, successes = 0;
    const popupUrls = [];
    const form = load('components/login-form.tsx', {
        react: { ...h.react, useId: () => 'signin' }, 'react/jsx-runtime': h.jsx,
        '@/app/actions/auth': {
            authenticateUser: (email, password) => { calls.push({ email, password }); return new Promise(resolve => { complete = resolve; }); },
            startStremioSignIn: () => new Promise(resolve => { completeLink = resolve; }),
        },
        '@/components/ui/button': { Button: 'button' },
        '@/components/motion-primitives/activity-text-shimmer': { ActivityTextShimmer: 'shimmer' },
        '@/components/account-ui/input': { Input: 'input' },
        '@/components/account-ui/label': { Label: 'label' },
        '@/components/account-ui/separator': { Separator: 'separator' },
        '@/components/ui/field': Object.fromEntries(['Field', 'FieldError', 'FieldGroup', 'FieldLabel'].map(name => [name, name])),
        '@/components/ui/input-group': Object.fromEntries(['InputGroup', 'InputGroupAddon', 'InputGroupButton', 'InputGroupInput'].map(name => [name, name])),
        'lucide-react': {}, sonner: { toast: { success() {} } },
    }, {
        window: { open: () => ({ location: { replace: url => popupUrls.push(url) }, close() {} }) },
    }).LoginForm;
    const render = () => h.render(form, { onSuccess: () => successes++ });
    let tree = render();
    const find = id => all(tree).find(node => node.props?.id === id);
    assert.equal(find('signin-email').props.required, true);
    assert.equal(find('signin-password').props.autoComplete, 'current-password');
    find('signin-email').props.onChange({ target: { value: ' user@example.com ' } });
    find('signin-password').props.onChange({ target: { value: 'password' } });
    tree = render();
    const submit = all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1, 'Repeated submit must not send duplicate sign-ins');
    assert.equal(calls[0].email, 'user@example.com');
    tree = render();
    assert.equal(find('signin-password').props.disabled, true);
    assert.equal(all(tree).find(node => node.type === 'shimmer').props.children, 'Signing in…');
    complete(false); await submit;
    tree = render();
    assert.equal(find('signin-error').props.role, 'alert');
    assert.equal(all(tree).some(node => node.type === 'shimmer'), false);
    assert.equal(successes, 0);
    find('signin-password').props.onChange({ target: { value: 'correct-password' } });
    tree = render();
    const retry = all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    complete(true); await retry;
    tree = render();
    assert.equal(find('signin-password').props.value, '', 'Successful sign-in clears the password');
    assert.equal(successes, 1);
    const connecting = all(tree).find(node => node.type === 'button' && node.props.type === 'button').props.onClick();
    tree = render();
    assert.equal(all(tree).find(node => node.type === 'shimmer').props.children, 'Connecting to Stremio…');
    completeLink({ success: true, link: 'https://stremio.test/sign-in', attempt: 'fixture', expiresAt: Date.now() + 60_000 });
    await connecting;
    tree = render();
    assert.deepEqual(popupUrls, ['https://stremio.test/sign-in']);
    assert.equal(all(tree).some(node => node.type === 'shimmer'), false, 'Instructions stay static while waiting for the user');
    assert.ok(all(tree).some(node => node.props.role === 'status'));
    h.unmount();

    const dialogHooks = hooks();
    let refreshes = 0, focused = 0;
    class Element { focus() { focused++; } }
    const trigger = new Element();
    const mediaQuery = new EventTarget();
    mediaQuery.matches = false;
    const provider = load('components/account-provider.tsx', {
        react: dialogHooks.react, 'react/jsx-runtime': dialogHooks.jsx,
        'next/navigation': { useRouter: () => ({ refresh: () => refreshes++ }) },
        '@/contexts/account-context': { AccountContext: dialogHooks.react.createContext(null) },
        '@/components/login-form': { LoginForm: 'form' },
        '@/components/account-ui/surface.module.css': { default: { surface: 'account-surface' } },
        '@/components/account-ui/drawer': Object.fromEntries(['Drawer', 'DrawerContent', 'DrawerDescription', 'DrawerHeader', 'DrawerTitle'].map(name => [name, name])),
        '@/components/account-ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle'].map(name => [name, name])),
    }, { document: { activeElement: trigger }, HTMLElement: Element, window: { matchMedia: () => mediaQuery } }).AccountProvider;
    let shell = dialogHooks.render(provider, { authenticated: false, children: 'home' });
    shell.props.value.requestSignIn();
    shell = dialogHooks.render(provider, { authenticated: false, children: 'home' });
    assert.equal(all(shell).find(node => node.type === 'Dialog').props.open, true);
    all(shell).find(node => node.type === 'DialogContent').props.finalFocus.current.focus();
    assert.equal(focused, 1, 'Dismissal restores focus to the initiating control');
    all(shell).find(node => node.type === 'form').props.onSuccess();
    assert.equal(refreshes, 1, 'Success refreshes server account data on the current page');
    dialogHooks.flush();
    mediaQuery.matches = true;
    mediaQuery.dispatchEvent(new Event('change'));
    shell = dialogHooks.render(provider, { authenticated: false, children: 'home' });
    assert.equal(all(shell).some(node => node.type === 'Dialog'), false);
    assert.equal(all(shell).find(node => node.type === 'Drawer').props.showSwipeHandle, true, 'Mobile uses Portalhop’s swipeable sheet');
    shell = dialogHooks.render(provider, { authenticated: true, children: 'home' });
    assert.equal(all(shell).some(node => node.type === 'Dialog' || node.type === 'Drawer'), false);
    dialogHooks.unmount();
    console.log('PASS: dialog sign-in validates fields, prevents duplicate submissions, exposes errors, clears passwords, restores focus, and refreshes signed-in server data.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
