const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const history = new Map([['navigator-chat-v2:user', JSON.stringify([{ id: 'old', role: 'user', parts: [{ type: 'text', text: 'Old chat' }] }])]]);
let reads = 0, writes = 0, pathname = '/', blocked = false;
const storage = {
    getItem(key) { reads++; return history.get(key); },
    setItem(key, value) { writes++; history.set(key, value); },
    removeItem(key) { if (blocked) throw Error('Storage unavailable'); history.delete(key); },
};
function mount() {
    const h = hooks();
    let messages = [];
    const stop = () => {};
    const setMessages = value => { messages = typeof value === 'function' ? value(messages) : value; };
    const { default: AIAsk } = load('components/navigator/ai-ask.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        '@ai-sdk/react': { useChat: () => ({ messages, setMessages, stop, status: 'ready', clearError() {} }) },
        ai: { DefaultChatTransport: class {}, lastAssistantMessageIsCompleteWithToolCalls: () => false },
        jotai: { useStore: () => ({}), useAtom: () => [true, () => {}] },
        sonner: { toast: { error() {} } },
        'next/navigation': { useRouter: () => ({}), usePathname: () => pathname },
        'next-themes': { useTheme: () => ({}) },
        '@/lib/atoms': {},
        '@/components/stream-query-provider': { useStreamQueries: () => null },
        '@/contexts/settings-context': { useSettings: () => ({}) },
        '@/contexts/MediaPlayerContext': { useMediaPlayer: () => ({}) },
        '@/lib/preload-tools': { preloadPlayer() {} },
        '@/lib/desktop/bridge': { desktopBridge: () => undefined },
        './focus': { NavigatorFocus: 'focus' },
    }, { document: new EventTarget(), localStorage: storage });
    const render = () => { const tree = h.render(AIAsk, { userId: 'user' }); h.flush(); return tree.props; };
    render();
    return { render, setMessages, unmount: () => h.unmount() };
}
const first = mount();
assert.equal(first.render().messages.length, 0, 'A fresh page must not restore the previous visit');
assert.equal(reads, 0, 'No stored transcript is read');
assert.equal(history.has('navigator-chat-v2:user'), false, 'Remove the legacy stored transcript');
first.setMessages([{ id: 'live', role: 'user', parts: [{ type: 'text', text: 'Current chat' }] }]);
pathname = '/series/tmdb:20';
assert.equal(first.render().messages[0].id, 'live', 'In-app navigation retains the current page session');
assert.equal(writes, 0, 'Current conversations are never persisted');
first.unmount();
const refreshed = mount(); assert.equal(refreshed.render().messages.length, 0); refreshed.unmount();
blocked = true;
const privateMode = mount(); assert.equal(privateMode.render().messages.length, 0); privateMode.unmount();
console.log('PASS: refresh/revisit starts empty, live route navigation retains chat, legacy history is removed, and blocked storage is safe');
