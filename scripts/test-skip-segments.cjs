const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
    const context = { exports: {}, URLSearchParams, URL, Request, Response, AbortSignal, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}

async function run() {
    const { fetchSkipSegments, normalizeSkipSegments, activeSkipSegment } = load('lib/media/skip-segments.ts');
    const lookup = { id: 'tt0944947', type: 'series', season: 1, episode: 1, duration: 3600 };
    const signal = new AbortController().signal;
    const missingIntro = await fetchSkipSegments({ id: 'tt1442437', type: 'series', season: 8, episode: 16, duration: 1290 }, signal,
        async id => id, async url => Response.json(url.startsWith('https://api.theintrodb.org')
            ? { credits: [{ start_ms: 641366, end_ms: null }] }
            : { intro: null, recap: null, outro: null, no_intro: false }));
    assert.equal(missingIntro.some(segment => segment.kind === 'intro'), false, 'Missing S8E16 provider timing must never become a guessed intro');
    const calls = [];
    const primary = { intro: [{ start_ms: null, end_ms: 90000 }], credits: [
        { start_ms: 3200000, end_ms: 3300000 }, { start_ms: 3500000, end_ms: null },
    ] };
    const fallback = { intro: { start_ms: 2000, end_ms: 95000 }, recap: { start_ms: 100000, end_ms: 130000 },
        outro: { start_ms: 3000000, end_ms: 3600000 } };
    const fetcher = async (url, options) => {
        calls.push({ url, options });
        return Response.json(url.startsWith('https://api.theintrodb.org') ? primary : fallback);
    };
    const resolveIMDb = async () => { throw new Error('IMDb titles must not need ID translation'); };
    const segments = await fetchSkipSegments(lookup, signal, resolveIMDb, fetcher);
    assert.equal(calls.length, 3);
    assert.equal(new URL(calls[0].url).searchParams.get('duration_ms'), '3600000');
    assert.ok(calls[1].url.startsWith('/api/skip-segments/introdb?'), 'Fallback goes through the CORS proxy');
    assert.equal(segments.find(s => s.kind === 'intro').end, 90, 'Primary wins');
    assert.deepEqual([...new Set(segments.filter(s => s.kind === 'intro').map(s => s.provider))], ['theintrodb'],
        'Never use both providers for the same segment kind');
    assert.equal(activeSkipSegment(segments, 92), undefined, 'The fallback intro cannot reappear after the primary intro ends');
    assert.equal(segments.find(s => s.kind === 'recap').provider, 'introdb', 'Fallback fills missing segment kinds');
    assert.equal(segments.filter(s => s.kind === 'credits').length, 2, 'Preserve multiple credits segments');
    assert.equal(activeSkipSegment(segments, 3250).end, 3300, 'Skipping credits preserves the post-credit scene');
    assert.equal(activeSkipSegment(segments, 3300), undefined, 'No skip button during the post-credit scene');
    assert.equal(activeSkipSegment(segments, 3500).end, 3600, 'Open-ended credits skip to the end');
    assert.equal(activeSkipSegment(segments, 90), undefined, 'Hide at the exact segment end');

    // Captured public response for Modern Family S08E19, runtime 21:32.
    // A zero-to-end credits range would offer to skip the entire story.
    const modernFamily = { intro: [{ start_ms: 76618, end_ms: 89131 }], credits: [{ start_ms: 0, end_ms: null }] };
    const modernFamilySegments = await fetchSkipSegments({ ...lookup, id: 'tt1442437', season: 8, episode: 19, duration: 1292 },
        signal, resolveIMDb, async url => Response.json(url.startsWith('https:') ? modernFamily : { outro: null }));
    assert.equal(activeSkipSegment(modernFamilySegments, 15 * 60 + 50), undefined, 'Modern Family must not offer Skip Credits during the story');
    assert.equal(activeSkipSegment(modernFamilySegments, 80).kind, 'intro', 'Valid intro timing survives invalid credits');
    const modernFamilyFallback = await fetchSkipSegments({ ...lookup, id: 'tt1442437', season: 8, episode: 19, duration: 1292 },
        signal, resolveIMDb, async url => Response.json(url.startsWith('https:') ? modernFamily : { outro: { start_ms: 1260000, end_ms: null } }));
    assert.equal(activeSkipSegment(modernFamilyFallback, 1265).provider, 'introdb', 'Invalid primary credits must allow a valid fallback');

    // Loki S01E02's public data has credits on the primary and opening
    // segments only on the fallback. Main-story end is not a credits marker.
    const lokiPrimary = { credits: [{ start_ms: 3072167, end_ms: null }] };
    const lokiFallback = {
        intro: { start_ms: 0, end_ms: 114000 },
        recap: { start_ms: 1000, end_ms: 74000 },
        outro: { start_ms: 3072170, end_ms: 3195480 },
    };
    const loki = await fetchSkipSegments({ ...lookup, id: 'tt9140554', episode: 2, duration: 3195.48 },
        signal, resolveIMDb, async url => Response.json(url.startsWith('https:') ? lokiPrimary : lokiFallback));
    assert.equal(activeSkipSegment(loki, 30).kind, 'intro');
    assert.equal(activeSkipSegment(loki, 30).provider, 'introdb');
    assert.equal(activeSkipSegment(loki, 48 * 60), undefined, 'Do not guess earlier credits from story length');
    assert.equal(activeSkipSegment(loki, 51 * 60 + 13).kind, 'credits');
    assert.equal(activeSkipSegment(loki, 51 * 60 + 13).provider, 'theintrodb');

    const recovered = await fetchSkipSegments(lookup, signal, resolveIMDb,
        async url => url.startsWith('https:') ? new Response(null, { status: 404 }) : Response.json(fallback));
    assert.equal(recovered.find(s => s.kind === 'intro').provider, 'introdb');
    const partial = await fetchSkipSegments(lookup, signal, resolveIMDb,
        async url => Response.json(url.startsWith('https:') ? { intro: primary.intro } : fallback));
    assert.equal(partial.find(s => s.kind === 'intro').provider, 'theintrodb');
    assert.equal(partial.find(s => s.kind === 'credits').provider, 'introdb', 'Missing credits use fallback while intro stays on primary');
    const failed = await fetchSkipSegments(lookup, signal, resolveIMDb, async () => { throw new Error('offline'); });
    assert.equal(failed.length, 0, 'Provider outages do not fail playback');
    const invalid = normalizeSkipSegments({ intro: [
        { start_ms: -1, end_ms: 1000 }, { start_ms: 10000, end_ms: 1000 },
        { start_ms: 1000, end_ms: 99999999 }, { start_ms: null, end_ms: null },
        { start_ms: '0', end_ms: 1000 }, {},
    ] }, 'theintrodb', 3600);
    assert.equal(invalid.length, 0, 'Reject malformed and out-of-range timestamps');

    const tmdbCalls = [];
    let translated = false;
    await fetchSkipSegments({ ...lookup, id: 'tmdb%3A1399' }, signal, async (id, type) => {
        assert.equal(id, 'tmdb:1399'); assert.equal(type, 'series');
        translated = true; return 'tt0944947';
    }, async url => { tmdbCalls.push(url); return Response.json({}); });
    assert.ok(translated);
    assert.equal(new URL(tmdbCalls[0]).searchParams.get('tmdb_id'), '1399');
    assert.ok(tmdbCalls[1].includes('imdb_id=tt0944947'));
    const movieCalls = [];
    await fetchSkipSegments({ ...lookup, type: 'movie', season: undefined, episode: undefined }, signal, resolveIMDb,
        async url => { movieCalls.push(url); return Response.json({}); });
    assert.ok(movieCalls[1].includes('is_movie=true'));
    assert.ok(!movieCalls[0].includes('season='));
    const cancelled = new AbortController();
    cancelled.abort();
    assert.equal((await fetchSkipSegments(lookup, cancelled.signal, resolveIMDb, fetcher)).length, 0);

    const proxyCalls = [];
    const { GET } = load('app/api/skip-segments/introdb/route.ts', { fetch: async (url, options) => {
        proxyCalls.push({ url, options }); return Response.json(fallback);
    } });
    assert.equal((await GET(new Request('https://navigator.test/api/skip-segments/introdb?imdb_id=bad'))).status, 400);
    assert.equal(proxyCalls.length, 0);
    const response = await GET(new Request('https://navigator.test/api/skip-segments/introdb?imdb_id=tt0944947&season=1&episode=1&url=https://evil.test'));
    assert.equal(response.status, 200);
    assert.equal(proxyCalls[0].url, 'https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    assert.equal(proxyCalls[0].options.next.revalidate, 3600);

    let stateIndex = 0;
    const { PlayerSkipSegments } = load('components/player-skip-segments.tsx', {
        require: name => {
            if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
            if (name === 'react') return { useState: initial => [stateIndex++ === 0 ? segments : initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }) };
            if (name.endsWith('.module.css')) return { __esModule: true, default: { button: 'skip-button' } };
            if (name === '@/lib/media/skip-segments') return { activeSkipSegment, fetchSkipSegments };
            return new Proxy({}, { get: (_, key) => key });
        },
    });
    for (const [time, label, destination] of [[1, 'Skip Intro', 90], [110, 'Skip Recap', 130], [3250, 'Skip Credits', 3300]]) {
        const element = { currentTime: time };
        let updated;
        stateIndex = 0;
        const tree = PlayerSkipSegments({ lookup, currentTime: time, mediaRef: { current: element }, onSeek: value => { updated = value; } });
        const button = tree.props.children.find(child => !child.props.disabled);
        assert.equal(button.props.children[1], label);
        button.props.onClick({ stopPropagation() {} });
        assert.equal(element.currentTime, destination, 'Seek the actual media element (web or native adapter)');
        assert.equal(updated, destination, 'Update the displayed playback timestamp');
    }
    for (const [time, expectedLabel] of [[1, 'Skip Intro'], [110, 'Skip Recap'], [3250, undefined]]) {
        stateIndex = 0;
        const tree = PlayerSkipSegments({ lookup, currentTime: time, mediaRef: { current: null }, onSeek() {}, hideCredits: true });
        const visible = tree.props.children.filter(child => child && !child.props.disabled);
        assert.equal(visible[0]?.props.children[1], expectedLabel, 'Up Next only suppresses Skip Credits');
    }
    stateIndex = 0;
    const scene = PlayerSkipSegments({ lookup, currentTime: 3400, mediaRef: { current: null }, onSeek() {} });
    assert.ok(scene.props.children.every(child => child.props.disabled && child.props['aria-hidden'] && child.props.tabIndex === -1),
        'Hidden skip actions cannot intercept clicks or keyboard focus');
    console.log('PASS: primary/fallback segment merging, timestamp validation, post-credit scenes, ID translation, movies, cancellation, outages, and CORS proxy.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
