import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { chromium, webkit } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_ENTRY)).href);
const driver = process.env.ARTWORK_BROWSER === 'webkit' ? webkit : chromium;
const directory = process.env.ARTWORK_CAPTURE_DIR || 'artwork-browser-captures';
await mkdir(directory, { recursive: true });
const backdrop = await readFile('public/images/subtitle-preview.jpg');
const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="150" viewBox="0 0 500 150"><rect x="10" y="20" width="480" height="110" rx="16" fill="white"/><text x="250" y="93" text-anchor="middle" font-family="sans-serif" font-size="53" font-weight="bold" fill="black">REVEAL</text></svg>');
const browser = await driver.launch({ headless: true, ...(driver === chromium ? { channel: 'chrome' } : {}) });
let context, page;
try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = new Map();
    const release = new Map();
    const released = new Set();
    const keyFor = url => new URL(url).pathname.match(/reveal-(backdrop|logo)-([abcd])\./)?.slice(1).join('-');
    await page.route(/^https:\/\/image\.tmdb\.org\/t\/p\/.*reveal-.*\.(jpg|png)$/, async route => {
        const key = keyFor(route.request().url());
        requests.set(key, (requests.get(key) || 0) + 1);
        if (!released.has(key)) await new Promise(resolve => {
            if (release.has(key)) release.get(key).push(resolve);
            else release.set(key, [resolve]);
        });
        await route.fulfill({ status: 200, contentType: key.startsWith('logo') ? 'image/svg+xml' : 'image/jpeg', body: key.startsWith('logo') ? logo : backdrop, headers: { 'cache-control': 'public, max-age=600' } });
    });
    await page.addInitScript(() => {
        window.revealProbe = { frames: [], decode: [], loads: [], animation: [] };
        const originalDecode = HTMLImageElement.prototype.decode;
        document.addEventListener('load', event => {
            const image = event.target;
            if (image instanceof HTMLImageElement && image.src.includes('reveal-')) window.revealProbe.loads.push({ src: image.src, time: performance.now() });
        }, true);
        // Make a slow decode promise reproducible without a slow external CDN.
        // This only affects calls the real application makes to decode().
        HTMLImageElement.prototype.decode = async function () {
            const source = this.currentSrc || this.src;
            if (!source.includes('reveal-')) return originalDecode.call(this);
            const entry = { src: source, start: performance.now(), end: null };
            window.revealProbe.decode.push(entry);
            await originalDecode.call(this);
            await new Promise(resolve => setTimeout(resolve, 350));
            entry.end = performance.now();
        };
        for (const name of ['animationstart', 'animationend', 'transitionrun', 'transitionend']) document.addEventListener(name, event => {
            if (event.target.closest?.('[data-continue-watching-index]')) window.revealProbe.animation.push({ type: name, name: event.animationName || event.propertyName, time: performance.now(), card: event.target.closest('[data-continue-watching-index]').dataset.continueWatchingIndex });
        }, true);
        function sample(time) {
            const cards = [...document.querySelectorAll('[data-continue-watching-index]')].map(card => {
                const art = card.querySelector('[data-artwork-state]');
                const mark = card.querySelector('img[src*="reveal-logo-"]')?.parentElement;
                const opacity = element => element ? Number(getComputedStyle(element).opacity) : null;
                return { index: Number(card.dataset.continueWatchingIndex), art: opacity(art), state: art?.dataset.artworkState, artComplete: art?.complete, logo: opacity(mark), visible: mark && getComputedStyle(mark).visibility === 'visible', logoReady: mark?.hasAttribute('data-logo-ready'), logoComplete: mark?.firstElementChild?.complete };
            });
            if (cards.length) window.revealProbe.frames.push({ time, cards });
            requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
    });
    await page.goto('http://127.0.0.1:3000/states/artwork-reveal');
    assert.equal(new URL(page.url()).pathname, '/states/artwork-reveal', 'The dev-only fixture must not redirect to another route');
    await page.locator('[data-hydrated="true"]').waitFor();
    const releaseImage = async key => {
        const end = Date.now() + 12000;
        while (!release.has(key) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(release.has(key), `Browser requested ${key}`);
        released.add(key);
        release.get(key).splice(0).forEach(resolve => resolve());
    };
    // Warm decoded image resources before mounting the cached metadata row.
    const warm = page.evaluate(async () => {
        const sources = ['https://image.tmdb.org/t/p/w780/reveal-logo-d.png', ...[300,780,1280].map(size => `https://image.tmdb.org/t/p/w${size}/reveal-backdrop-d.jpg`)];
        window.warmedRevealImages = sources.map(src => { const image = new Image(); image.src = src; return image; });
        await Promise.all(window.warmedRevealImages.map(image => image.complete ? Promise.resolve() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; })));
    });
    await Promise.all(['backdrop-d', 'logo-d'].map(releaseImage));
    await warm;
    await page.locator('[data-mount-row]').click();
    await page.locator('[data-continue-watching-index]').first().waitFor();
    // Logo first, backdrop first, and simultaneous arrival.
    await Promise.all(['logo-a', 'backdrop-b'].map(releaseImage));
    await page.waitForTimeout(550);
    await Promise.all(['backdrop-a', 'logo-b', 'backdrop-c', 'logo-c'].map(releaseImage));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-continue-watching-index]')].every(card => card.querySelector('[data-artwork-state="ready"]') && card.querySelector('[data-logo-ready]')));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${directory}/settled.png` });
    const beforeRefresh = await page.evaluate(() => performance.now());
    await page.locator('[data-refresh-row]').click();
    await page.waitForTimeout(500);
    const probe = await page.evaluate(() => window.revealProbe);
    const report = { browser: process.env.ARTWORK_BROWSER, platform: process.platform, requests: Object.fromEntries(requests), errors, beforeRefresh, ...probe };
    const tests = [];
    for (let index = 0; index < 4; index++) {
        const frames = probe.frames.map(frame => ({ time: frame.time, ...frame.cards.find(card => card.index === index) })).filter(frame => frame.index === index);
        const first = frames.find(frame => frame.visible);
        const letters = ['a', 'b', 'c', 'd'];
        const decode = probe.decode.find(entry => entry.src.includes(`reveal-logo-${letters[index]}`));
        const faded = frames.filter(frame => frame.visible && frame.logo > 0.02 && frame.logo < 0.98);
        const artworkFade = frames.filter(frame => frame.state === 'ready' && frame.art > 0.02 && frame.art < 0.98);
        tests.push({ card: index, firstVisible: first?.time, logoDecode: decode, logoIntermediateFrames: faded.length, artworkIntermediateFrames: artworkFade.length,
            fadePassed: faded.length >= 3 && artworkFade.length >= 3,
            decodePassed: Boolean(decode?.end && first && first.time >= decode.end - 20),
            noReplay: frames.filter(frame => frame.time > beforeRefresh).every(frame => frame.logo >= 0.99) });
    }
    report.tests = tests;
    await writeFile(`${directory}/trace.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(tests, null, 2));
    if (process.env.ARTWORK_EXPECT_BASELINE === '1') {
        assert.ok(tests.some(test => !test.fadePassed || !test.decodePassed), 'Baseline must reproduce the early or missing reveal');
    } else {
        assert.ok(tests.every(test => test.fadePassed && test.decodePassed && test.noReplay), 'Fresh pixels must fade after decode, and metadata refresh must not replay visible artwork');
    }
} catch (error) {
    if (page) {
        await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
        const probe = await page.evaluate(() => window.revealProbe).catch(() => null);
        if (probe) await writeFile(`${directory}/failure-trace.json`, JSON.stringify(probe, null, 2));
    }
    throw error;
} finally {
    await context?.close();
    await browser.close();
}
