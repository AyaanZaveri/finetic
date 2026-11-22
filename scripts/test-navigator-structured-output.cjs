const assert = require('node:assert/strict');
const { Output, generateText, streamText, NoOutputGeneratedError, NoObjectGeneratedError, APICallError } = require('ai');
const { z } = require('zod');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise helper against real AI SDK Output/error types and a controlled model boundary.
let calls = [], behavior;
const mockAi = {
  Output, streamText, NoOutputGeneratedError, NoObjectGeneratedError,
  generateText: async opts => {
    calls.push(opts);
    return behavior(opts, calls.length);
  },
};
const emitted = ts.transpileModule(fs.readFileSync('lib/navigator-structured-output.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const context = { exports: {}, require: n => n === 'ai' ? mockAi : n === '@/lib/chatgpt-provider' ? { CHATGPT_PROVIDER_ID: 'navigator-chatgpt.responses' } : require(n), console: { log() {}, warn() {} }, Date, JSON, Error, SyntaxError, AbortController, setTimeout, clearTimeout };
vm.runInNewContext(emitted, context);
const generate = context.exports.generateNavigatorObject;
const schema = z.object({ name: z.string() });
const base = { model: { provider: 'opencode.chat', modelId: 'test-model' }, schema, task: 'unit', prompt: 'hello', messages: undefined, instructions: 'keep me', timeout: 500 };
const success = () => ({ text: '{"name":"fine"}', output: { name: 'fine' }, finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } });

(async () => {
  behavior = success;
  let result = await generate(base);
  assert.deepEqual(result.output, { name: 'fine' });
  assert.equal(calls[0].output.name, 'object');
  assert.equal(calls[0].instructions, 'keep me');

  calls = [];
  behavior = success;
  await generate({ ...base, prompt: undefined, model: { provider: 'opencode.chat', modelId: 'iceman-contributor-free' }, messages: [{ role: 'user', content: 'input' }] });
  assert.equal(calls[0].output, undefined);
  assert.equal(calls[0].prompt, undefined);
  assert.equal(calls[0].messages[0].content, 'input');
  assert.match(calls[0].instructions, /matching this schema/);

  calls = [];
  behavior = (_opts, n) => { if (n === 1) throw new APICallError({ message: 'Structured response_format not enabled', url: 'https://example.test', requestBodyValues: {}, statusCode: 400 }); return success(); };
  await generate(base);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].output, undefined);

  for (const error of [new APICallError({ message: 'unauthorized', url: 'x', requestBodyValues: {}, statusCode: 401 }), new APICallError({ message: 'rate limited', url: 'x', requestBodyValues: {}, statusCode: 429 })]) {
    calls = []; behavior = () => { throw error; };
    await assert.rejects(generate(base)); assert.equal(calls.length, 1);
  }

  calls = []; behavior = () => ({ text: 'not json', finishReason: 'stop' });
  await assert.rejects(generate(base)); assert.equal(calls.length, 2);
  assert.equal(calls[1].output, undefined, 'Empty native generation recovers through the locally validated JSON protocol rather than repeating the same format');
  calls = []; behavior = () => ({ text: '{"name":2}', finishReason: 'stop' });
  await assert.rejects(generate(base)); assert.equal(calls.length, 2);

  calls = []; behavior = () => { throw new NoOutputGeneratedError({ message: 'empty', toolName: 'object' }); };
  await assert.rejects(generate(base)); assert.equal(calls.length, 2);

  const controller = new AbortController(); controller.abort(new Error('user cancelled'));
  calls = []; behavior = success;
  await assert.rejects(generate({ ...base, abortSignal: controller.signal })); assert.equal(calls.length, 0);

  // The actual SDK returns a string from result.output in text mode. A stubbed
  // object here used to hide a production-only validation failure.
  const { MockLanguageModelV4 } = await import('ai/test');
  mockAi.generateText = generateText;
  const usage = { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 4, text: 4, reasoning: 0 } };
  const generated = text => ({ content: [{ type: 'text', text }], warnings: [], usage, finishReason: { unified: 'stop', raw: 'stop' } });
  const icemanCalls = [];
  const iceman = new MockLanguageModelV4({ provider: 'opencode.chat', modelId: 'iceman-contributor-free', doGenerate: async options => {
    icemanCalls.push(options);
    return generated('```json\n{"name":"actual-sdk"}\n```');
  } });
  result = await generate({ ...base, model: iceman, prompt: undefined, messages: [{ role: 'user', content: 'Preserve this input' }], instructions: [{ role: 'system', content: 'Preserve this instruction' }] });
  assert.equal(result.output.name, 'actual-sdk');
  assert.equal(icemanCalls.length, 1);
  assert.equal(icemanCalls[0].responseFormat?.type, undefined, 'Known unsupported providers receive no response_format');
  assert.match(JSON.stringify(icemanCalls[0].prompt), /Preserve this input/);
  assert.match(JSON.stringify(icemanCalls[0].prompt), /Preserve this instruction/);

  const native = new MockLanguageModelV4({ doGenerate: async options => {
    assert.equal(options.responseFormat.type, 'json');
    assert.equal(options.responseFormat.schema.type, 'object');
    return generated('{"name":"native-sdk"}');
  } });
  assert.equal((await generate({ ...base, model: native })).output.name, 'native-sdk');

  let fallbackCalls = 0;
  const fallback = new MockLanguageModelV4({ doGenerate: async options => {
    fallbackCalls++;
    if (fallbackCalls === 1) throw new APICallError({ message: 'response_format is not supported', url: 'https://example.test', requestBodyValues: {}, statusCode: 400, isRetryable: false });
    assert.equal(options.responseFormat?.type, undefined);
    return generated('{"name":"fallback-sdk"}');
  } });
  assert.equal((await generate({ ...base, model: fallback })).output.name, 'fallback-sdk');
  assert.equal(fallbackCalls, 2);

  let emptyNativeCalls = 0;
  const emptyNative = new MockLanguageModelV4({ doGenerate: async options => {
    emptyNativeCalls++;
    if (emptyNativeCalls === 1) return { content: [{ type: 'reasoning', text: 'Hidden reasoning consumes the output budget.' }], warnings: [], usage,
      finishReason: { unified: 'length', raw: 'length' } };
    assert.equal(options.responseFormat, undefined, 'No final object changes protocol on its single recovery call');
    assert.match(JSON.stringify(options.prompt), /previous attempt did not produce/);
    return generated('{"name":"recovered-final-answer"}');
  } });
  assert.equal((await generate({ ...base, model: emptyNative })).output.name, 'recovered-final-answer');
  assert.equal(emptyNativeCalls, 2);

  let deadlineCalls = 0;
  const deadlineModel = new MockLanguageModelV4({ doGenerate: async options => {
    deadlineCalls++;
    if (deadlineCalls === 1) {
      await new Promise(resolve => setTimeout(resolve, 70));
      throw new APICallError({ message: 'response_format is not supported', url: 'https://example.test', requestBodyValues: {}, statusCode: 400, isRetryable: false });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(generated('{"name":"too-late"}')), 200);
      options.abortSignal.addEventListener('abort', () => { clearTimeout(timer); reject(options.abortSignal.reason); }, { once: true });
    });
  } });
  await assert.rejects(generate({ ...base, model: deadlineModel, timeout: { totalMs: 120 } }));
  assert.equal(deadlineCalls, 2, 'Recovery shares the original deadline rather than restarting the clock');
  console.log('PASS: Navigator structured-output native/text fallback, validation, bounded retries, and cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
