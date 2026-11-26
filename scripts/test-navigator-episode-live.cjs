// Opt-in live provider test of the source route. Starts no server, performs no browser actions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

async function main() {
    if (!process.argv.includes('--live')) { console.log('SKIP: pass --live to use configured TMDB, TinyFish and OpenCode APIs.'); return; }
    process.loadEnvFile('.env');
    const arg = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
    const provider = arg('--provider') || 'opencode';
    assert.ok(['opencode', 'gemini', 'groq'].includes(provider), 'Unsupported live test provider');
    assert.ok(process.env[{ opencode: 'OPENCODE_GO_API_KEY', gemini: 'GOOGLE_GENERATIVE_AI_API_KEY', groq: 'GROQ_API_KEY' }[provider]]
        && process.env.TMDB_API_READ_ACCESS_TOKEN && process.env.TINYFISH_API_KEY, 'Configure live service credentials in .env');
    const dependencies = {};
    for (const name of ['ai', 'zod', '@ai-sdk/openai', '@ai-sdk/google', '@ai-sdk/groq', '@ai-sdk/cerebras', '@ai-sdk/openai-compatible', '@openrouter/ai-sdk-provider', 'ai-sdk-ollama']) dependencies[name] = await import(name);
    const profile = [];
    let profileStart = Date.now();
    if (process.argv.includes('--timings')) {
        const ai = dependencies.ai;
        dependencies.ai = { ...ai,
            streamText: options => ai.streamText({ ...options, onStepEnd: async step => {
                profile.push({ kind: 'step', atMs: Date.now() - profileStart, tools: step.toolCalls?.map(call => call.toolName), usage: step.usage });
                await options.onStepEnd?.(step);
            } }),
            generateText: async options => {
                const start = Date.now();
                let result;
                try { result = await ai.generateText(options); return result; }
                finally { profile.push({ kind: 'generation', atMs: Date.now() - profileStart, ms: Date.now() - start,
                    model: options.model.modelId, stepUsages: result?.steps?.map(step => step.usage) ?? (result?.usage ? [result.usage] : []) }); }
            },
        };
    }
    if (process.argv.includes('--diagnostics')) {
        const ai = dependencies.ai;
        dependencies.ai = { ...ai, generateText: async options => {
            try {
                const result = await ai.generateText(options);
                // Inspect generation metadata before accessing the output getter, which can throw.
                console.error(JSON.stringify({ stage: 'generation-finished', finishReason: result.finishReason,
                    textChars: result.text.length, usage: result.totalUsage }));
                console.error(JSON.stringify({ stage: 'structured-generation', output: result.output, finishReason: result.finishReason }));
                return result;
            }
            catch (error) {
                console.error(JSON.stringify({ stage: 'structured-generation', name: error.name, message: error.message,
                    cause: error.cause?.message, finishReason: error.finishReason, outputChars: error.text?.length,
                    usage: error.usage, statusCode: error.statusCode }));
                throw error;
            }
        } };
    }
    dependencies['server-only'] = {};
    dependencies['@/lib/server/outbound-fetch'] = { OutboundRequestError: class OutboundRequestError extends Error {}, outboundFetch: (...args) => fetch(...args), providerFetch: (...args) => fetch(...args), outboundUrl: value => new URL(value) };
    dependencies['@/lib/server/auth'] = { getAuthData: async () => ({ user: { _id: 'local-live-episode-probe' } }) };
    dependencies['next/headers'] = { cookies: async () => ({ get: name => name === 'stremio-auth' ? { value: JSON.stringify({ user: { _id: 'local-live-episode-probe' } }) } : undefined }) };
    dependencies['@/app/actions/auth'] = { getUser: async () => ({ _id: 'local-live-episode-probe' }) };
    dependencies['@/app/actions/media'] = {
        getStreamAddonTargets: async () => { throw new Error('Live discovery must not enumerate streams'); },
        fetchStreamsFromAddon: async () => { throw new Error('Live discovery must not fetch streams'); },
    };
    const modules = new Map();
    const services = [];
    const sourceRefFlag = process.argv.indexOf('--source-ref');
    const sourceRef = sourceRefFlag >= 0 ? process.argv[sourceRefFlag + 1] : undefined;
    function load(file) {
        const absolute = path.resolve(file);
        if (modules.has(absolute)) return modules.get(absolute).exports;
        const module = { exports: {} }; modules.set(absolute, module);
        const localRequire = name => {
            if (dependencies[name]) return dependencies[name];
            if (name.startsWith('@/') || name.startsWith('.')) {
                const resolved = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(absolute), name);
                const candidate = [resolved, resolved + '.ts', resolved + '.tsx', resolved + '/index.ts'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
                if (!candidate) throw new Error(`Cannot resolve ${name}`);
                const alias = '@/' + path.relative(process.cwd(), candidate).replace(/\.tsx?$/, '');
                if (dependencies[alias]) return dependencies[alias];
                return load(candidate);
            }
            return require(name);
        };
        // Compare committed source without switching the user's checkout or server.
        const relative = path.relative(process.cwd(), absolute);
        const source = sourceRef && /^(app|lib)\//.test(relative)
            ? execFileSync('git', ['show', `${sourceRef}:${relative}`], { encoding: 'utf8' })
            : fs.readFileSync(absolute, 'utf8');
        vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
        } }).outputText, {
            module, exports: module.exports, require: localRequire, process,
            console: { log() {}, warn() {}, error(...args) {
                if (process.argv.includes('--diagnostics')) console.error(...args.map(value => value instanceof Error || value?.message
                    ? { name: value.name, message: value.message, cause: value.cause?.message } : typeof value === 'string' ? value : '[details omitted]'));
            } },
            setTimeout, clearTimeout, AbortController, AbortSignal, Error, TypeError, SyntaxError,
            fetch: async (url, init) => {
                const started = Date.now(); const response = await fetch(url, init);
                services.push({ host: new URL(url).hostname, status: response.status, ms: Date.now() - started });
                return response;
            },
            Request, Response, ReadableStream, TextEncoder, TextDecoder, URL, URLSearchParams, crypto: globalThis.crypto,
        }, { filename: absolute });
        return module.exports;
    }
    dependencies['@/app/actions/auth'].getInstalledAddons = async () => [{
            manifest: { id: 'org.stremio.opensubtitles', name: 'OpenSubtitles', resources: ['subtitles'] },
            transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
        }];
    if (process.argv.includes('--scene-only')) {
        const model = load('lib/opencode-go.ts').createOpenCodeGoModel('muse-spark-1.3-contributor', process.env.OPENCODE_GO_API_KEY, 'navigator-live-episode-scene');
        const signal = AbortSignal.timeout(120_000);
        const tools = load('app/tools/index.ts').createAllTools(null, 0, model, signal);
        const progress = [];
        const mediaFlag = process.argv.indexOf('--scene-media-id');
        const mediaId = mediaFlag >= 0 ? process.argv[mediaFlag + 1] : 'tmdb:58957:4:4';
        const descriptionFlag = process.argv.indexOf('--scene-description');
        const userDescription = descriptionFlag >= 0 ? process.argv[descriptionFlag + 1] : 'where he goes on to the talk show';
        const result = await tools.skipToSubtitleContent.execute({
            mediaId, mediaName: 'Nathan for You', mediaType: 'Episode',
            userDescription,
        }, { toolCallId: 'live-episode-scene', messages: [], abortSignal: signal, context: { onSceneProgress: value => progress.push(value) } });
        const subtitleProgress = progress.find(value => value.stage === 'subtitles' && value.state === 'completed');
        console.log(JSON.stringify({ success: result.success, error: result.error, mediaSourceId: result.mediaSourceId,
            timestamp: result.timestamp, timestampFormatted: result.timestampFormatted, text: result.text,
            subtitles: subtitleProgress?.subtitles, timings: result.timings, services }));
        const expectedFlag = process.argv.indexOf('--expect-match');
        if (expectedFlag >= 0 && process.argv[expectedFlag + 1] === 'no') {
            assert.equal(result.success, false, 'Unsupported scene requests must abstain');
            assert.equal(progress.find(value => value.stage === 'scene' && value.state === 'error')?.detail, 'No confident match in the subtitle dialogue');
            console.log('PASS: live scene matcher abstains without subtitle evidence.');
            return;
        }
        assert.equal(result.success, true);
        if (mediaFlag < 0) {
            assert.equal(result.mediaSourceId, 'tt2297757:4:4', 'Keep the canonical video target');
            assert.match(subtitleProgress.subtitles.filename, /the.anecdote/i, 'Select the episode by release title, not shifted provider numbering');
        }
        if (expectedFlag >= 0) assert.ok(result.timestamp >= Number(process.argv[expectedFlag + 1]), `Expected a match at or after ${process.argv[expectedFlag + 1]} seconds`);
        assert.ok(result.timestamp > 0);
        console.log('PASS: selected live model matches a scene using the correctly titled public subtitle track. Video playback was not executed.');
        return;
    }
    if (process.argv.includes('--intent-only')) {
        const toolModule = load('app/tools/index.ts');
        dependencies['@/app/tools'] = { ...toolModule, createAllTools: (...args) => {
            const tools = toolModule.createAllTools(...args);
            return { ...tools, skipToSubtitleContent: { ...tools.skipToSubtitleContent,
                execute: async input => ({ success: true, intent: input }) } };
        } };
    }
    if (process.argv.includes('--timings')) {
        const toolModule = load('app/tools/index.ts');
        dependencies['@/app/tools'] = { ...toolModule, createAllTools: (...args) => Object.fromEntries(
            Object.entries(toolModule.createAllTools(...args)).map(([name, definition]) => [name, !definition.execute ? definition : {
                ...definition, execute: async (...args) => {
                    const start = Date.now();
                    profile.push({ kind: 'tool-start', name, atMs: start - profileStart });
                    try { return await definition.execute(...args); }
                    finally { profile.push({ kind: 'tool-end', name, atMs: Date.now() - profileStart, ms: Date.now() - start }); }
                },
            }])) };
    }
    const promptFile = arg('--system-prompt-file');
    if (promptFile) {
        const toolsModule = dependencies['@/app/tools'] || load('app/tools/index.ts');
        const instructions = fs.readFileSync(promptFile, 'utf8');
        dependencies['@/app/tools'] = { ...toolsModule, createSystemPrompt: () => instructions };
    }
    const { POST } = load('app/api/chat/route.ts');
    const modelFlag = process.argv.indexOf('--model');
    const models = modelFlag >= 0 ? [process.argv[modelFlag + 1]] : ['muse-spark-1.3-contributor'];
    const promptFlag = process.argv.indexOf('--prompt');
    const prompt = promptFlag >= 0 ? process.argv[promptFlag + 1] : 'go to the episode of nathan for you where he goes on jimmy kimmel';
    for (const model of models) {
        services.length = 0;
        const start = Date.now();
        profileStart = start; profile.length = 0;
        const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', signal: AbortSignal.timeout(120_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            messages: [{ id: 'live-episode-probe', role: 'user', parts: [{ type: 'text', text: prompt }] }],
            aiProvider: provider, opencodeModel: model, geminiModel: model, groqModel: model,
            opencodeSessionId: `navigator-episode-validation-${model}`, pathname: '/',
        }) }));
        if (response.status !== 200) {
            console.log(JSON.stringify({ model, prompt, durationMs: Date.now() - start, httpStatus: response.status, error: await response.text() }));
        }
        assert.equal(response.status, 200);
        const body = await response.text();
        const events = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
        const errors = events.filter(event => event.type === 'error');
        const inputs = events.filter(event => event.type === 'tool-input-available').map(({ toolName, input }) => ({ toolName, input }));
        const outputs = events.filter(event => event.type === 'tool-output-available').map(event => event.output);
        console.log(JSON.stringify({ model, provider, prompt, ...(sourceRef ? { sourceRef } : {}), ...(promptFile ? { promptFile } : {}), durationMs: Date.now() - start, tools: inputs,
            results: outputs.map(output => ({ success: output.success, status: output.status, url: output.url,
                mediaId: output.mediaId, mediaName: output.mediaName, execution: output.execution,
                episodeTitle: output.episodeTitle, episodes: output.episodes?.map(episode => episode.id),
                evidence: output.evidence?.map(({ sourceId, url }) => ({ sourceId, url })), error: output.error,
                timestamp: output.timestamp, text: output.text, timings: output.timings })), errors, services,
            answerText: events.filter(event => event.type === 'text-delta').map(event => event.delta).join(''),
            ...(process.argv.includes('--timings') ? { profile } : {}) }));
        assert.equal(errors.length, 0, 'No provider continuation failure');
        if (process.argv.includes('--report-only')) continue;
        if (process.argv.includes('--intent-only')) {
            assert.equal(inputs.length, 1);
            assert.equal(inputs[0].toolName, 'skipToSubtitleContent');
            assert.match(inputs[0].input.mediaQuery, /Nathan for You/i);
            assert.match(inputs[0].input.episodeQuery, /Jimmy Kimmel/i);
            assert.ok(inputs[0].input.userDescription.length > 0, 'Extract the requested scene; the matcher also receives the episode context');
            assert.equal(inputs[0].input.seasonNumber, undefined, 'Do not invent episode coordinates during extraction');
            assert.equal(inputs[0].input.episodeNumber, undefined);
            console.log('PASS: selected live model extracts the show, episode clue, and scene; playback/lookup execution was stubbed.');
            continue;
        }
        const actions = outputs.filter(output => output.execution === 'prepared');
        assert.equal(actions.length, 1, 'Prepare exactly one supported action');
        assert.equal(actions[0].success, true);
        if (process.argv.includes('--require-evidence')) assert.ok(actions[0].evidence?.some(item => item.url && item.quote && item.sourceId?.startsWith('web:')),
            'A remembered episode must have fetched, reconstructed evidence, not just guessed correct coordinates');
        const expectedFlag = process.argv.indexOf('--expected-path');
        const expectedPath = expectedFlag >= 0 ? process.argv[expectedFlag + 1] : '/series/tt2297757/4/4';
        const [, , series, season, episode] = expectedPath.split('/');
        assert.ok(actions[0].url === expectedPath || actions[0].mediaId === `${series}:${season}:${episode}`, `Resolve the expected episode ${expectedPath}`);
        if (inputs.some(input => input.toolName === 'skipToSubtitleContent')) {
            assert.ok(actions[0].timestamp > 0, 'Scene requests must prepare a verified subtitle timestamp, not just the episode');
            console.log(JSON.stringify({ timestamp: actions[0].timestamp, text: actions[0].text }));
            if (/jimmy kimmel/i.test(prompt) && /skip to the scene where he goes on/i.test(prompt)) {
                assert.ok(actions[0].timestamp >= 1040 && actions[0].timestamp <= 1080,
                    'The 525-line Anecdote track introduces Nathan around 17:26–17:40; early narration or planning is not the requested appearance');
            }
        }
    }
    if (process.argv.includes('--report-only')) console.log('REPORT: provider responses captured without asserting task correctness.');
    else if (!process.argv.includes('--intent-only')) console.log('PASS: live source route prepares the expected verified episode action. Browser execution is not part of this check.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
