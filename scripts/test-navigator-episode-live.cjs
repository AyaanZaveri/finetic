// Opt-in live provider test of the source route. Starts no server, performs no browser actions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

async function main() {
    if (!process.argv.includes('--live')) { console.log('SKIP: pass --live to use configured TMDB, TinyFish and OpenCode APIs.'); return; }
    process.loadEnvFile('.env');
    const arg = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
    const provider = arg('--provider') || 'opencode';
    assert.ok(['opencode', 'gemini', 'groq', 'openai'].includes(provider), 'Unsupported live test provider');
    assert.ok(process.env[{ opencode: 'OPENCODE_GO_API_KEY', gemini: 'GOOGLE_GENERATIVE_AI_API_KEY', groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY' }[provider]]
        && process.env.TMDB_API_READ_ACCESS_TOKEN && process.env.TINYFISH_API_KEY, 'Configure live service credentials in .env');
    const dependencies = {};
    for (const name of ['ai', 'zod', '@ai-sdk/openai', '@ai-sdk/google', '@ai-sdk/groq', '@ai-sdk/cerebras', '@ai-sdk/openai-compatible', '@openrouter/ai-sdk-provider', 'ai-sdk-ollama']) dependencies[name] = await import(name);
    // Compare the same reasoning budget/transport for the outer loop only.
    if (process.argv.includes('--openai-chat-none')) {
        assert.equal(provider, 'openai');
        const ai = dependencies.ai;
        dependencies.ai = { ...ai, streamText: options => ai.streamText({ ...options,
            model: dependencies['@ai-sdk/openai'].createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).chat(options.model.modelId),
            providerOptions: { openai: { reasoningEffort: 'none' } },
        }) };
    }
    const profile = [];
    let profileStart = Date.now();
    const matcherRepeats = Number(arg('--matcher-repeats') || 0);
    assert.ok(Number.isInteger(matcherRepeats) && matcherRepeats >= 0 && matcherRepeats <= 12, 'Use 0–12 matcher repetitions');
    const matcherEfforts = arg('--matcher-efforts')?.split(',') ?? ['default'];
    assert.ok(matcherEfforts.every(effort => ['default', 'none', 'low', 'medium', 'high'].includes(effort)), 'Use supported matcher effort values');
    assert.ok(!arg('--matcher-efforts') || provider === 'openai', 'Explicit effort sweep requires the official OpenAI provider');
    let fixedMatcher;
    const rawGenerateText = dependencies.ai.generateText;
    if (matcherRepeats) {
        const ai = dependencies.ai;
        dependencies.ai = { ...ai, generateText: options => {
            // Keep the exact first matching input in memory, including the
            // transcript, evidence, schema and model settings. No source
            // text or provider credentials are written to disk.
            if (!fixedMatcher && typeof options.prompt === 'string'
                && /^(Transcript reference|Complete chronological transcript)/.test(options.prompt)) fixedMatcher = options;
            return ai.generateText(options);
        } };
    }
    async function repeatMatcher() {
        if (!matcherRepeats) return;
        assert.ok(fixedMatcher, 'The original request did not reach subtitle matching');
        const fingerprint = createHash('sha256').update(fixedMatcher.prompt).digest('hex');
        const results = [];
        const trials = Array.from({ length: matcherRepeats }, (_, i) => {
            const order = i % 2 ? [...matcherEfforts].reverse() : matcherEfforts;
            return order.map(effort => ({ run: i + 1, effort }));
        }).flat();
        for (const { run, effort } of trials) {
                const start = Date.now();
                try {
                    const providerOptions = effort === 'default' ? fixedMatcher.providerOptions : {
                        ...fixedMatcher.providerOptions,
                        openai: { ...fixedMatcher.providerOptions?.openai, reasoningEffort: effort },
                    };
                    const result = await rawGenerateText({ ...fixedMatcher, providerOptions, abortSignal: AbortSignal.timeout(45_000), maxRetries: 0 });
                    const { candidate, confidence, status, candidates } = result.output;
                    const startCue = candidates?.[0]?.startCue;
                    const line = fixedMatcher.prompt.split('\n').find(value => startCue ? value.startsWith(`${startCue}|`) : Number.isInteger(candidate) && value.startsWith(`${candidate}@`));
                    results.push({ run, effort, ms: Date.now() - start, candidate, confidence, status, startCue, evidence: candidates?.[0]?.evidence, supportingLine: line?.slice(0, 250),
                        inputTokens: result.totalUsage.inputTokens, cachedInputTokens: result.totalUsage.inputTokenDetails?.cacheReadTokens,
                        reasoningTokens: result.totalUsage.outputTokenDetails.reasoningTokens });
                } catch (error) { results.push({ run, effort, ms: Date.now() - start, error: error.name }); }
        }
        console.log(JSON.stringify({ experiment: 'fixed-subtitle-selection', fingerprint, model: fixedMatcher.model.modelId, results }));
    }
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
                    model: options.model.modelId,
                    ...(typeof options.prompt === 'string' && options.prompt.startsWith('Complete chronological transcript') ? {
                        task: 'scene-selection', inputFingerprint: createHash('sha256').update(options.prompt).digest('hex'),
                    } : {}),
                    stepUsages: result?.steps?.map(step => step.usage) ?? (result?.usage ? [result.usage] : []) }); }
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
            Request, Response, Headers, ReadableStream, TextEncoder, TextDecoder, URL, URLSearchParams, Buffer, crypto: globalThis.crypto,
        }, { filename: absolute });
        return module.exports;
    }
    dependencies['@/app/actions/auth'].getInstalledAddons = async () => [{
            manifest: { id: 'org.stremio.opensubtitles', name: 'OpenSubtitles', resources: ['subtitles'] },
            transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
        }];
    if (arg('--matcher-architecture-case')) {
        assert.equal(provider, 'openai', 'Architecture replay uses the official OpenAI provider');
        const { cases } = require('./bench-navigator-engines.cjs');
        const { experimentalMatcher, fingerprint } = require('./navigator-matcher-experiment.cjs');
        const test = cases.find(item => item.id === arg('--matcher-architecture-case'));
        assert.ok(test && (test.window || test.visualReview || test.abstain), 'Choose a scene matching case');
        const names = { kimmel: 'Nathan for You', lawyer: 'Nathan for You', b99: 'Brooklyn Nine-Nine',
            office: 'The Office', saul: 'Better Call Saul', severance: 'Severance', community: 'Community',
            movie: 'You Can See Everything', negative: 'Nathan for You' };
        const mediaId = test.mediaId || 'tt2297757:4:4';
        const mediaName = names[test.id];
        const mediaType = mediaId.includes(':') ? 'Episode' : 'Movie';
        const model = dependencies['@ai-sdk/openai'].createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(arg('--model') || 'gpt-6-luna');
        const signal = AbortSignal.timeout(30_000);
        const playback = await load('app/tools/media.ts').playMedia.execute({ mediaId, mediaName, mediaType }, { abortSignal: signal });
        assert.equal(playback.success, true);
        assert.equal(playback.mediaId, mediaId);
        const media = { id: playback.mediaId, name: playback.mediaName, type: mediaType === 'Movie' ? 'movie' : 'series',
            mediaSourceId: playback.mediaSourceId, episodeTitle: playback.episodeTitle, showName: playback.showName,
            seasonNumber: playback.seasonNumber, episodeNumber: playback.episodeNumber, seriesId: playback.seriesId };
        const sceneTools = load('app/tools/subtitles.ts');
        const track = await sceneTools.loadParsedSubtitles(media, 0, signal);
        assert.ok(track.success, track.error);
        const { subtitleMediaKey, snapshotSubtitles } = load('lib/media/subtitle-snapshot.ts');
        const snapshot = { mediaKey: subtitleMediaKey(media), delay: 0, cues: track.subtitles,
            track: { language: track.selectedTrackLanguage, label: track.selectedTrackLabel,
                filename: track.selectedTrackFilename, provider: track.selectedTrackProvider } };
        assert.ok(load('lib/media/subtitle-preference.ts').isEnglishSubtitle(snapshot.track), 'Expected English track for scoring');
        const cues = snapshotSubtitles(snapshot, media);
        const sceneContext = { originalRequest: test.prompt, conversation: [], titleReferences: [] };
        const context = `You are analyzing subtitles from "${media.name}" to help a user skip to a specific scene.
User wants to skip to: "${test.prompt}"
Original user request (verbatim JSON string): ${JSON.stringify(test.prompt)}
Earlier conversation (reference only): []
Earlier title references (reference only): []
Resolved media metadata: ${JSON.stringify({ id: media.id, name: media.name, showName: media.showName,
    episodeTitle: media.episodeTitle, seasonNumber: media.seasonNumber, episodeNumber: media.episodeNumber })}`;
        const score = match => {
            if (test.visualReview) return null;
            if (test.abstain) return match === null;
            return !!match && match.timestamp >= test.window[0] && match.timestamp <= test.window[1]
                && test.line.test([match.text, ...(match.evidence || []).map(item => item.text)].join(' '));
        };
        const repeats = Number(arg('--architecture-repeats') || 3);
        const effort = arg('--architecture-effort') || 'medium';
        const verificationEffort = arg('--architecture-verifier-effort') || effort;
        const variants = arg('--architecture-variants')?.split(',') ?? ['baseline', 'interval'];
        assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
        assert.ok(['none', 'low', 'medium', 'high'].includes(effort));
        assert.ok(['none', 'low', 'medium', 'high'].includes(verificationEffort));
        assert.ok(variants.length && variants.every(value => ['baseline', 'interval'].includes(value)));
        console.log(JSON.stringify({ experiment: 'matcher-architecture', case: test.id, model: model.modelId, effort,
            verificationEffort,
            mediaId, episodeTitle: media.episodeTitle, track: snapshot.track, cueCount: cues.length, fingerprint: fingerprint(cues), repeats }));
        const generate = load('lib/navigator-structured-output.ts').generateNavigatorObject;
        for (let run = 1; run <= repeats; run++) {
            const order = run % 2 ? ['baseline', 'interval'] : ['interval', 'baseline'];
            for (const variant of order.filter(value => variants.includes(value))) {
                const start = Date.now(), callsBefore = profile.length;
                try {
                    if (variant === 'baseline') {
                        // Execute the actual production matcher against the same frozen
                        // snapshot. No catalog or web discovery is part of the timed run.
                        const trialSignal = AbortSignal.timeout(120_000);
                        const tool = sceneTools.skipToSubtitleContent(media, model, trialSignal, sceneContext, snapshot);
                        const result = await tool.execute({ userDescription: test.prompt, mediaId, mediaName, mediaType },
                            { toolCallId: 'matcher-baseline', messages: [], abortSignal: trialSignal });
                        const match = result.success ? { timestamp: result.timestamp, text: result.text, evidence: result.sceneEvidence } : null;
                        console.log(JSON.stringify({ case: test.id, run, variant, ms: result.timings?.matchSceneMs ?? Date.now() - start,
                            match, pass: result.failureStage ? false : score(match), error: result.failureStage ? result.failureKind : undefined,
                            calls: profile.slice(callsBefore).filter(item => item.kind === 'generation').length,
                            timings: result.timings }));
                    } else {
                        const result = await experimentalMatcher({ cues, context, model, z: dependencies.zod.z, generate, effort, verificationEffort });
                        for (const [name, match] of [['interval-single', result.single], ['interval-verified', result.verified]]) {
                            console.log(JSON.stringify({ case: test.id, run, variant: name,
                                ms: name === 'interval-single' ? result.proposalMs : Date.now() - start, match,
                                pass: name === 'interval-verified' && result.verificationError ? false : score(match),
                                error: name === 'interval-verified' ? result.verificationError : undefined,
                                status: name === 'interval-single' ? result.proposalStatus : result.verificationStatus || result.proposalStatus,
                                proposals: result.proposals, verification: name === 'interval-verified' ? result.verification : undefined,
                                usage: name === 'interval-single' ? result.usage.slice(0, 1) : result.usage }));
                        }
                    }
                } catch (error) {
                    console.log(JSON.stringify({ case: test.id, run, variant, ms: Date.now() - start, error: error.name, pass: false }));
                }
            }
        }
        return;
    }
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
    // Opt-in comparison of the outer agent engine only. The same app tools,
    // argument validation, model-backed subtitle matcher and output projection
    // remain in use. No browser actions or persistent sessions are created.
    const fxModule = arg('--fx-module');
    if (fxModule) {
        assert.ok(['groq', 'gemini', 'openai'].includes(provider), 'Use Groq, OpenAI or the Gemini OpenAI-compatible endpoint for libfx');
        assert.ok(arg('--model'), 'Pass --model for the libfx comparison');
        const { createFxEngine } = require(path.resolve(fxModule));
        const modelId = arg('--model'), prompt = arg('--prompt');
        assert.ok(prompt, 'Pass --prompt for the libfx comparison');
        const apiKey = process.env[{ groq: 'GROQ_API_KEY', gemini: 'GOOGLE_GENERATIVE_AI_API_KEY', openai: 'OPENAI_API_KEY' }[provider]];
        const model = provider === 'groq' ? dependencies['@ai-sdk/groq'].createGroq({ apiKey })(modelId)
            : provider === 'openai' ? dependencies['@ai-sdk/openai'].createOpenAI({ apiKey })(modelId)
                : dependencies['@ai-sdk/google'].createGoogle({ apiKey })(modelId);
        const toolsModule = dependencies['@/app/tools'] || load('app/tools/index.ts');
        const { actionToolNames, modelToolOutput } = load('lib/navigator-chat.ts');
        const signal = AbortSignal.timeout(120_000);
        const definitions = toolsModule.createAllTools(null, 0, model, signal, { originalRequest: prompt, conversation: [], titleReferences: [] });
        const inputs = [], outputs = [], errors = [], progress = [];
        let reserved = false, terminal = false, answerText = '', engine, stopReason;
        const start = Date.now(); profileStart = start;
        const tools = await Promise.all(Object.entries(definitions)
            .filter(([name, definition]) => definition.execute && !['completeAction', 'findEpisodeByTitle', 'explainScene', 'analyzeMedia'].includes(name))
            .map(async ([name, definition]) => {
                const schema = dependencies.ai.asSchema(definition.inputSchema);
                const action = actionToolNames.has(name);
                return { name, description: definition.description || '', inputSchema: await schema.jsonSchema,
                    idempotent: !action, writes: action,
                    execute: async (input, context) => {
                        if (terminal || (action && reserved)) return { success: false, error: 'Turn has already prepared an action.' };
                        const validated = await schema.validate?.(input);
                        if (!validated?.success) return { success: false, error: 'Invalid tool arguments. Correct the arguments using the schema.' };
                        if (action) reserved = true;
                        inputs.push({ toolName: name, input: validated.value });
                        try {
                            const output = await definition.execute(validated.value, { toolCallId: context.executionId, messages: [], abortSignal: context.signal,
                                context: { onSceneProgress: data => progress.push({ type: 'scene', ...data }), onEpisodeProgress: data => progress.push({ type: 'episode', ...data }) } });
                            outputs.push(output);
                            if (action) terminal = output.execution === 'prepared' || (output.success === false && (name === 'skipToSubtitleContent' || ['not_found', 'ambiguous', 'unavailable'].includes(output.status)));
                            return modelToolOutput(name, output);
                        } finally { reserved = false; }
                    } };
            }));
        try {
            engine = await createFxEngine({
                backend: 'native', model: modelId, instructions: toolsModule.createSystemPrompt(null, 0, null), tools,
                provider: { name: provider, baseUrl: { groq: 'https://api.groq.com/openai/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta/openai', openai: 'https://api.openai.com/v1' }[provider],
                    models: { [modelId]: { supportsToolUse: true, contextWindow: 128000, maxOutputTokens: 1400, ...(provider === 'openai' ? {
                        outputLimitField: 'max_completion_tokens',
                        ...(process.argv.includes('--openai-chat-none') ? { request: { reasoning_effort: 'none' } } : {}),
                    } : {}) } } },
                credentials: () => ({ apiKey }),
            });
            const turn = engine.prompt(prompt, { signal });
            for await (const event of turn) {
                if (event.type === 'text_delta') answerText += event.delta;
                if (terminal && event.type === 'tool_end') { turn.cancel(); break; }
            }
            const result = await turn.result;
            stopReason = result.stopReason;
            if (stopReason === 'refused') errors.push({ errorText: 'Provider refused the request.' });
            profile.push({ kind: 'fx-usage', usage: result.usage });
        } catch (error) { errors.push({ errorText: error.message }); }
        finally { await engine?.close(); }
        console.log(JSON.stringify({ model: modelId, provider, engine: 'libfx', prompt, promptFile,
            durationMs: Date.now() - start, tools: inputs, results: outputs.map(output => ({
                success: output.success, status: output.status, execution: output.execution, mediaId: output.mediaId, mediaName: output.mediaName,
                episodeTitle: output.episodeTitle, failureStage: output.failureStage, failureKind: output.failureKind,
                url: output.url, timestamp: output.timestamp, text: output.text, sceneEvidence: output.sceneEvidence, error: output.error, timings: output.timings,
            })), errors, services, answerText, stopReason, terminalActionResult: terminal, profile, progress }));
        await repeatMatcher();
        return;
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
            aiProvider: provider, opencodeModel: model, geminiModel: model, groqModel: model, openaiModel: model,
            opencodeSessionId: `navigator-episode-validation-${model}`, pathname: '/',
        }) }));
        if (response.status !== 200) {
            console.log(JSON.stringify({ model, prompt, durationMs: Date.now() - start, httpStatus: response.status, error: await response.text() }));
        }
        assert.equal(response.status, 200);
        const body = await response.text();
        const events = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
        const errors = events.filter(event => event.type === 'error');
        const aborted = events.some(event => event.type === 'abort');
        const inputs = events.filter(event => event.type === 'tool-input-available').map(({ toolName, input }) => ({ toolName, input }));
        const outputs = events.filter(event => event.type === 'tool-output-available').map(event => event.output);
        console.log(JSON.stringify({ model, provider, prompt, ...(sourceRef ? { sourceRef } : {}), ...(promptFile ? { promptFile } : {}), durationMs: Date.now() - start, tools: inputs,
            results: outputs.map(output => ({ success: output.success, status: output.status, url: output.url,
                failureStage: output.failureStage, failureKind: output.failureKind,
                mediaId: output.mediaId, mediaName: output.mediaName, execution: output.execution,
                episodeTitle: output.episodeTitle, episodes: output.episodes?.map(episode => episode.id),
                evidence: output.evidence?.map(({ sourceId, url }) => ({ sourceId, url })), error: output.error,
                timestamp: output.timestamp, text: output.text, sceneEvidence: output.sceneEvidence, timings: output.timings })), errors, services,
            answerText: events.filter(event => event.type === 'text-delta').map(event => event.delta).join(''), aborted,
            progress: events.filter(event => ['data-sceneProgress', 'data-episodeProgress'].includes(event.type)).map(({ type, data }) => ({ type, ...data })),
            ...(process.argv.includes('--timings') ? { profile } : {}) }));
        assert.equal(errors.length, 0, 'No provider continuation failure');
        await repeatMatcher();
        if (process.argv.includes('--report-only')) continue;
        assert.equal(aborted, false, 'No aborted provider turn');
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
        const expectedMediaId = arg('--expected-media-id');
        if (expectedMediaId) assert.equal(actions[0].mediaId, expectedMediaId, 'Resolve the expected playback identity');
        else {
            const expectedPath = arg('--expected-path') || '/series/tt2297757/4/4';
            const [, , series, season, episode] = expectedPath.split('/');
            assert.ok(actions[0].url === expectedPath || actions[0].mediaId === `${series}:${season}:${episode}`, `Resolve the expected episode ${expectedPath}`);
        }
        if (arg('--timestamp-min') !== undefined || arg('--timestamp-max') !== undefined) {
            assert.ok(inputs.some(input => input.toolName === 'skipToSubtitleContent'), 'Expected a scene seek, not ordinary playback');
        }
        if (inputs.some(input => input.toolName === 'skipToSubtitleContent')) {
            assert.ok(actions[0].timestamp > 0, 'Scene requests must prepare a verified subtitle timestamp, not just the episode');
            if (arg('--timestamp-min') !== undefined) assert.ok(actions[0].timestamp >= Number(arg('--timestamp-min')), 'Scene timestamp is too early');
            if (arg('--timestamp-max') !== undefined) assert.ok(actions[0].timestamp <= Number(arg('--timestamp-max')), 'Scene timestamp is too late');
            console.log(JSON.stringify({ timestamp: actions[0].timestamp, text: actions[0].text }));
            if (/jimmy kimmel/i.test(prompt) && /skip to the scene where he goes on/i.test(prompt)) {
                assert.ok(actions[0].timestamp >= 1040 && actions[0].timestamp <= 1080,
                    'The 525-line Anecdote track introduces Nathan around 17:26–17:40; early narration or planning is not the requested appearance');
            }
        }
    }
    if (process.argv.includes('--report-only')) console.log('REPORT: provider responses captured without asserting task correctness.');
    else if (!process.argv.includes('--intent-only')) console.log('PASS: live source route prepares the expected verified media action. Browser execution is not part of this check.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
