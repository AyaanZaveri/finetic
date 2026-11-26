import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const target = process.argv[2];
assert.ok(['chrome', 'safari', 'desktop'].includes(target), 'Choose chrome, safari, or desktop');
const fixtureModules = {
    'media-section': 'export const MediaSection = ({ sectionName }) => <section data-fixture-carousel><a href="#title">{sectionName}</a></section>',
    'home-catalog-placeholder': 'export const CachedCatalogRow = () => null',
    'home-palette-provider': 'export const HomeInitialPalette = () => null',
    'home-snapshot-provider': 'export const useHomeSnapshot = () => null',
    'ui/button': 'export const Button = props => <button {...props} />',
};
const { outputFiles } = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
        import { createRoot } from 'react-dom/client';
        import { HomeCatalogSectionsLazy } from './components/home-catalog-sections-lazy';
        import layout from './components/layout-content.module.css';

        const total = 80;
        const section = key => ({ key, sectionName: 'Catalog ' + key, mediaItems: [{ id: key, type: 'movie', name: 'Fixture' }] });
        const initial = [section('0')];
        const entries = Array.from({ length: total - 1 }, (_, index) => ({ key: String(index + 1) }));
        const requests = [];
        const realFetch = window.fetch.bind(window);
        window.fetch = (url, init) => {
            if (url !== '/api/home/catalogs') return realFetch(url, init);
            const keys = JSON.parse(init.body).entries.map(entry => entry.key);
            return new Promise((resolve, reject) => {
                const request = { keys, signal: init.signal, resolve: () => resolve(new Response(JSON.stringify({ sections: keys.map(section) }))) };
                requests.push(request);
                init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
            });
        };
        const frame = () => new Promise(requestAnimationFrame);
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        async function until(condition, message) {
            const deadline = performance.now() + 7500;
            while (!condition()) { check(performance.now() < deadline, message); await frame(); }
        }
        const selector = '[data-home-catalog-row]';
        const placeholder = '[data-home-catalog-placeholder]';
        const carousel = '[data-fixture-carousel]';
        const slot = index => document.querySelector('[data-home-catalog-row="' + index + '"]');
        async function main() {
            createRoot(document.querySelector('#fixture')).render(
                <><header>Navigator</header><main data-page-scroll className={layout.viewport}>
                    <div><div className="prefix"/><HomeCatalogSectionsLazy initialSections={initial} remainingEntries={entries} batchSize={2}/></div>
                </main></>);
            await until(() => requests.length > 0, 'Initial viewport did not request catalogs');
            const viewport = document.querySelector('[data-page-scroll]');
            const allSlots = Array.from(document.querySelectorAll(selector));
            check(allSlots.length === total, 'Each catalog must have a slot');
            check(document.querySelectorAll(carousel).length === 1, 'Only the ready initial carousel is mounted');
            const anchor = slot(0).getBoundingClientRect().top - viewport.getBoundingClientRect().top;
            const jump = index => { viewport.scrollTop = anchor + index * 360; };
            const visible = index => {
                const top = viewport.getBoundingClientRect().top;
                const element = document.elementFromPoint(40, top + 16);
                const painted = element?.closest(placeholder);
                check(painted?.parentElement === allSlots[index], 'Landing at row ' + index + ' exposed an empty area');
                check(getComputedStyle(painted, '::after').backgroundImage.includes('repeating-linear-gradient'), 'Placeholder has no visible poster shapes');
            };
            for (const index of [36, 12, 65, 3, 48, 21]) {
                jump(index);
                visible(index); // Same task, before the visibility observer can run.
                await frame();
                visible(index); // Data is still pending on the next frame.
            }
            const landing = 21;
            await until(() => requests.some(request => !request.signal.aborted && request.keys.includes(String(landing))), 'Did not prioritize the landing row');
            for (const request of requests) if (!request.signal.aborted) request.resolve();
            await until(() => !!slot(landing).querySelector(carousel), 'Landing placeholder did not become a carousel');
            check(!slot(landing).querySelector(placeholder), 'Placeholder remained over a ready carousel');
            check(!slot(0).querySelector(carousel), 'Distant carousel is still mounted');
            check(Array.from(document.querySelectorAll(selector)).every((node, index) => node === allSlots[index]), 'Scroll replaced persistent slots');
            jump(0);
            await until(() => !!slot(0).querySelector(carousel), 'Previously loaded carousel did not return');
            return { rows: total, jumps: 6, userAgent: navigator.userAgent };
        }
        main().then(result => ({ ok: true, ...result }), error => ({ ok: false, error: String(error.stack || error) }))
            .then(report => {
                window.homeScrollReport = report;
                window.ipc?.postMessage(JSON.stringify(report));
            });
    ` }, outfile: 'fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    plugins: [{
        name: 'isolate-catalog-data-and-cards',
        setup(plugin) {
            plugin.onResolve({ filter: /^@\/components\// }, ({ path }) => {
                const key = path.slice('@/components/'.length);
                if (Object.hasOwn(fixtureModules, key)) return { path: key, namespace: 'fixture' };
            });
            plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: fixtureModules[path], loader: 'jsx', resolveDir: process.cwd() }));
        },
    }],
});
const js = outputFiles.find(file => file.path.endsWith('.js')).text;
const css = outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--accent:#333;color:white;background:#111;font:16px sans-serif}
    body{margin:0}header{height:48px}main{height: min(720px,calc(100vh - 48px));width:100%}
    .prefix{height:380px}.flow-root{display:flow-root}[data-fixture-carousel]{min-height:360px}
    ${css}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
    if (request.url === '/fixture.js') response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(js);
    else if (request.url === '/') response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
    else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const run = promisify(execFile);

async function chrome() {
    const session = ['--session', `home-scroll-${process.pid}`, '--headed', '--executable-path', process.env.CHROME_PATH || '/usr/bin/google-chrome'];
    const cli = (...args) => run('agent-browser', [...session, ...args], { timeout: 30_000 });
    try {
        await cli('open', url);
        await cli('wait', '--fn', 'window.homeScrollReport !== undefined');
        const { stdout } = await cli('eval', 'JSON.stringify(window.homeScrollReport)');
        const report = JSON.parse(stdout.trim());
        return typeof report === 'string' ? JSON.parse(report) : report;
    } finally { await cli('close').catch(() => {}); }
}

async function safari() {
    const driver = spawn('/usr/bin/safaridriver', ['--port', '48123'], { stdio: 'inherit' });
    let session;
    const webdriver = async (path, method = 'GET', body) => {
        const response = await fetch(`http://127.0.0.1:48123${path}`, {
            method, signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const result = await response.json();
        assert.ok(response.ok, JSON.stringify(result));
        return result.value;
    };
    try {
        for (let attempt = 0; ; attempt++) {
            try { await webdriver('/status'); break; }
            catch (error) { if (attempt >= 40 || driver.exitCode !== null) throw error; await delay(250); }
        }
        const result = await webdriver('/session', 'POST', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
        assert.equal(result.capabilities.browserName.toLowerCase(), 'safari');
        session = '/session/' + result.sessionId;
        await webdriver(session + '/url', 'POST', { url });
        for (let attempt = 0; attempt < 80; attempt++) {
            const report = await webdriver(session + '/execute/sync', 'POST', { script: 'return window.homeScrollReport || null', args: [] });
            if (report) return report;
            await delay(250);
        }
        throw Error('Safari did not finish the fixture');
    } finally {
        try { if (session) await webdriver(session, 'DELETE'); }
        finally { driver.kill(); }
    }
}

async function desktop() {
    const candidate = process.platform === 'win32' ? 'home-scroll-check.exe' : 'home-scroll-check';
    const { stdout } = await run(`desktop/target/debug/examples/${candidate}`, [url], { timeout: 45_000 });
    return JSON.parse(stdout.trim());
}

try {
    const report = await { chrome, safari, desktop }[target]();
    console.log(JSON.stringify(report, null, 2));
    assert.equal(report.ok, true, report.error);
} finally { server.closeAllConnections(); server.close(); }
