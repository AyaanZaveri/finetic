const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const constants = load('lib/models-dev.ts', {}, { URL });

function route(fetch, authenticated = true) {
    return load('app/api/provider-models/route.ts', {
        '@/lib/server/auth': { getAuthData: async () => { if (!authenticated) throw Error('Unauthorized'); } },
        '@/lib/server/outbound-fetch': { outboundFetch: fetch },
        '@/lib/models-dev': constants,
    }, { Request, Response, URL, AbortSignal }).POST;
}
function request(provider, key = 'fixture-key') {
    return new Request(`https://navigator.test/api/provider-models?provider=${provider}`, { method: 'POST', headers: { 'x-provider-api-key': key } });
}

async function main() {
    const badModalities = { input: ['text'], output: ['text'] };
    assert.equal(constants.isTextModel('text-embedding-3-small', badModalities), false);
    assert.equal(constants.isTextModel('chatgpt-image-latest', { input: ['text'], output: ['text', 'image'] }), false);
    assert.equal(constants.isTextModel('gpt-6-luna', badModalities), true);

    // Exercise the actual workbench fetch wrapper, not only the production hook.
    const location = new URL('http://navigator.test/states/settings?__state=navigator-openai&__stage=1');
    const workbenchCalls = [];
    const currentCatalog = [{ id: 'current-one', name: 'Current One' }, { id: 'current-two', name: 'Current Two' }, { id: 'current-three', name: 'Current Three' }];
    const window = { location, fetch: async (resource, init) => {
        workbenchCalls.push({ url: new URL(String(resource), location), init });
        return Response.json({ provider: { models: currentCatalog } });
    } };
    const action = name => () => window.fetch('/states/settings', { method: 'POST', headers: { 'Next-Action': name }, body: '[]' });
    const artworkActions = Object.fromEntries(['getArtworkSettings', 'saveArtworkToken', 'removeArtworkToken', 'saveMetadataProvider'].map(name => [name, action(name)]));
    const searchActions = Object.fromEntries(['getWebSearchSettings', 'saveWebSearchKey', 'removeWebSearchKey', 'setWebSearchEnabled'].map(name => [name, action(name)]));
    const { installFixtures } = load('app/states/settings/fixtures.ts', {
        '@/app/actions/artwork-settings': artworkActions,
        '@/app/actions/web-search-settings': searchActions,
    }, { window, location, URL, URLSearchParams, Request, Response, Headers });
    const workbench = installFixtures('navigator-openai');
    await workbench.ready;
    const publicPreview = await window.fetch('/api/models-dev/provider?providerId=openai');
    assert.deepEqual((await publicPreview.json()).provider.models, currentCatalog, 'Ordinary workbench uses the live public catalog');
    assert.equal(workbenchCalls.length, 1);
    const simulatedAccount = await window.fetch('/api/openai/models', { method: 'POST', headers: { 'x-openai-api-key': 'fixture-key' } });
    assert.deepEqual((await simulatedAccount.json()).models, currentCatalog);
    assert.equal(workbenchCalls[1].url.pathname, '/api/models-dev/provider');
    assert.equal(workbenchCalls[1].init.headers, undefined, 'Fixture keys never reach the live API');
    workbench.cleanup();
    const errorPreview = installFixtures('navigator-model-error');
    await errorPreview.ready;
    assert.equal((await window.fetch('/api/openai/models', { method: 'POST' })).status, 503);
    errorPreview.cleanup();

    let publicRequests = 0, resolveCatalog;
    const publicRoute = load('app/api/models-dev/provider/route.ts', {
        'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
        '@/lib/models-dev': constants,
    }, { URL, Response, fetch: (url, options) => {
        publicRequests++;
        assert.equal(url, constants.MODELS_DEV_API_URL);
        assert.equal(options.headers, undefined);
        return new Promise(resolve => { resolveCatalog = resolve; });
    } }).GET;
    const groqCatalog = publicRoute(new Request('https://navigator.test/api/models-dev/provider?providerId=groq'));
    const claudeCatalog = publicRoute(new Request('https://navigator.test/api/models-dev/provider?providerId=anthropic'));
    assert.equal(publicRequests, 1, 'Concurrent catalog requests share the full public download');
    resolveCatalog(Response.json({ groq: { models: { llama: { name: 'Llama' } } }, anthropic: { models: { claude: { name: 'Claude' } } } }));
    assert.equal((await (await groqCatalog).json()).provider.models[0].id, 'llama');
    assert.equal((await (await claudeCatalog).json()).provider.models[0].id, 'claude');
    await publicRoute(new Request('https://navigator.test/api/models-dev/provider?providerId=groq'));
    assert.equal(publicRequests, 1, 'Subsequent provider requests use the cached catalog');

    const fixtures = {
        anthropic: { url: 'https://api.anthropic.com/v1/models', header: 'x-api-key', value: 'fixture-key', data: { data: [{ id: 'claude', display_name: 'Claude' }], has_more: true, last_id: 'cursor' }, next: { data: [{ id: 'claude-next', display_name: 'Next' }], has_more: false }, cursor: 'after_id' },
        gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models', header: 'x-goog-api-key', value: 'fixture-key', data: { models: [{ name: 'models/gemini', displayName: 'Gemini', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'cursor' }, next: { models: [{ name: 'models/gemini-next', supportedGenerationMethods: ['generateContent'] }] }, cursor: 'pageToken' },
        groq: { url: 'https://api.groq.com/openai/v1/models', data: { data: [{ id: 'llama' }, { id: 'whisper-large-v3' }, { id: 'inactive', active: false }] } },
        openrouter: { url: 'https://openrouter.ai/api/v1/models/user', data: { data: [{ id: 'meta/llama', name: 'Llama' }, { id: 'image-only', architecture: { input_modalities: ['text'], output_modalities: ['image'] } }] } },
        cerebras: { url: 'https://api.cerebras.ai/v1/models', data: { data: [{ id: 'gpt-oss-120b' }] } },
        opencode: { url: 'https://opencode.ai/inference/go/v1/models', data: { data: [{ id: 'kimi', name: 'Kimi', family: 'kimi' }, { id: 'vector', modalities: { input: ['text'], output: ['embedding'] } }] } },
    };
    for (const [provider, fixture] of Object.entries(fixtures)) {
        const calls = [];
        const handler = route(async (url, options) => {
            calls.push({ url: new URL(url), options });
            return Response.json(calls.length === 1 ? fixture.data : fixture.next);
        });
        const response = await handler(request(provider));
        assert.equal(response.status, 200, provider);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const { models } = await response.json();
        assert.equal(models.length, fixture.next ? 2 : 1, provider);
        assert.equal(`${calls[0].url.origin}${calls[0].url.pathname}`, fixture.url);
        for (const { url, options } of calls) {
            assert.equal(options.headers[fixture.header || 'Authorization'], fixture.value || 'Bearer fixture-key');
            assert.equal(options.redirect, 'error');
            assert.equal(options.cache, 'no-store');
            assert.ok(!url.href.includes('fixture-key'));
        }
        if (fixture.next) assert.equal(calls[1].url.searchParams.get(fixture.cursor), 'cursor');
        if (provider === 'gemini') assert.ok(models.every(model => !model.id.startsWith('models/')));
    }
    const noFetch = () => { throw Error('Must not fetch'); };
    assert.equal((await route(noFetch)(request('unknown'))).status, 400);
    assert.equal((await route(noFetch)(request('groq', ''))).status, 400);
    assert.equal((await route(noFetch, false)(request('groq'))).status, 401);
    const rejected = await route(async () => new Response('private details including fixture-key', { status: 401 }))(request('groq'));
    assert.equal(rejected.status, 401);
    assert.ok(!(await rejected.text()).includes('fixture-key'));
    const broken = await route(async () => Response.json({ data: [], has_more: true, last_id: 'same' }))(request('anthropic'));
    assert.equal(broken.status, 502, 'A repeated cursor must not return a partial list');

    const host = hooks(), calls = [], timers = new Map();
    let timerId = 0;
    const { useProviderModels } = load('components/settings/use-provider-models.ts', { react: host.react }, {
        URL, URLSearchParams, AbortController,
        window: { setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout: id => timers.delete(id) },
        fetch: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })),
    });
    let props = { provider: 'openai', apiKey: '', baseUrl: constants.OPENAI_DEFAULT_BASE_URL };
    const render = (next = {}) => { props = { ...props, ...next }; host.render(useProviderModels, props); host.flush(); return host.render(useProviderModels, props); };
    const advance = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); void timer.callback(); } };
    assert.equal(render().loading, true);
    assert.equal(calls[0].url, '/api/models-dev/provider?providerId=openai');
    assert.equal(calls[0].options.headers, undefined, 'Public discovery never receives credentials');
    calls[0].resolve(Response.json({ provider: { models: [{ id: 'public-only', name: 'Public' }, { id: 'shared', name: 'Friendly name', family: 'gpt' }] } })); await tick();
    assert.equal(render().models.length, 2);
    assert.equal(render().live, false);
    assert.equal(calls.length, 1, 'Without a key, do not request private models');
    let state = render({ apiKey: 'key-one' });
    assert.equal(state.models.length, 2, 'The cached public list remains usable while checking the key');
    assert.equal(state.loading, true);
    advance(300);
    assert.equal(calls[1].url, '/api/openai/models');
    calls[1].resolve(Response.json({ models: [{ id: 'shared', name: 'shared' }, { id: 'private-model', name: 'Private' }] })); await tick();
    state = render();
    assert.equal(state.live, true);
    assert.equal(state.models.length, 2);
    assert.equal(state.models.find(model => model.id === 'shared').name, 'Friendly name');
    assert.equal(state.models.find(model => model.id === 'shared').family, 'gpt');
    assert.ok(!state.models.some(model => model.id === 'public-only'));
    assert.ok(state.models.some(model => model.id === 'private-model'));
    state = render({ apiKey: 'key-two' });
    assert.ok(!state.models.some(model => model.id === 'private-model'), 'Previous key-specific results must disappear immediately');
    advance(300);
    calls[2].resolve(Response.json({ error: 'Check your API key.' }, { status: 401 })); await tick();
    state = render();
    assert.equal(state.models.length, 2);
    assert.equal(state.live, false);
    assert.match(state.error, /Showing public models/);
    render({ apiKey: 'key-three' }); advance(300);
    calls[3].resolve(Response.json({ models: [] })); await tick();
    state = render();
    assert.equal(state.models.length, 0, 'An empty successful account list must not revert to public models');
    assert.equal(state.live, true);
    render({ provider: 'gemini', apiKey: 'google-key' }); advance(300);
    assert.equal(calls[4].url, '/api/models-dev/provider?providerId=google');
    assert.equal(calls[5].url, '/api/provider-models?provider=gemini');
    assert.equal(calls[5].options.headers['x-provider-api-key'], 'google-key');
    render({ provider: 'anthropic', apiKey: 'anthropic-key' });
    assert.ok(calls[4].options.signal.aborted && calls[5].options.signal.aborted);
    advance(300);
    calls[5].resolve(Response.json({ models: [{ id: 'stale', name: 'Stale' }] })); await tick();
    assert.ok(!render().models.some(model => model.id === 'stale'));
    host.unmount();
    assert.equal(timers.size, 0);

    console.log('PASS: all six provider routes, authentication, pagination, text model filtering, catalog-first rendering, live metadata, key changes, errors, empty lists and cancellation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
