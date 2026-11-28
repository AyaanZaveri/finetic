import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStreamClient } from '../lib/stream-api.ts';

const target = { type: 'series', id: 'tt123', season: 2, episode: 3 };
const api = 'https://api.strem.io/api';
const fixtureKey = 'stremio-fixture-key';
const installed = (name, options = {}) => ({
  transportUrl: `https://${name}.example.test/manifest.json`,
  manifest: { id: 'example.streams', name, resources: ['stream'], types: ['series'], ...options },
});
const collection = (...addons) => Response.json({ result: { addons } });

function testSession(initial = null) {
  let key = initial;
  return {
    read: async () => key,
    write: async value => { key = value; },
    clear: async () => { key = null; },
  };
}

test('signed-out discovery does not make a network request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network call'); });
  const result = await createStreamClient(testSession()).loadStreamSnapshot(target);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(result.signedIn, false);
  assert.equal(result.complete, true);
});

test('only Stremio receives the email, password or session key', async t => {
  const session = testSession();
  const client = createStreamClient(session);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    if (url === `${api}/login`) return Response.json({ result: { authKey: fixtureKey, user: { id: 'unneeded' } } });
    if (url === `${api}/addonCollectionGet`) return collection(installed('provider'));
    return Response.json({ streams: [] });
  });
  await client.signIn('account@example.test', 'fixture-password');
  assert.equal(await session.read(), fixtureKey);
  const restoredClient = createStreamClient(session);
  const results = await restoredClient.loadStreamSnapshot(target);
  assert.equal(results.signedIn, true);
  await restoredClient.signOut();
  assert.equal(await session.read(), null);
  assert.deepEqual(calls.map(({ url }) => url), [
    `${api}/login`, `${api}/addonCollectionGet`, 'https://provider.example.test/stream/series/tt123%3A2%3A3.json',
  ]);
  assert.deepEqual(JSON.parse(calls[0].body), { type: 'Login', email: 'account@example.test', password: 'fixture-password', facebook: false });
  assert.deepEqual(JSON.parse(calls[1].body), { type: 'AddonCollectionGet', authKey: fixtureKey, update: false });
  assert.ok(calls.slice(0, 2).every(call => call.redirect === 'error'));
  assert.ok(calls.every(call => call.credentials === 'omit'));
  assert.deepEqual(calls[2].headers, { Accept: 'application/json' });
  assert.equal(calls[2].body, undefined);
});

test('progressive direct results retain provider order and keep add-on configuration out of snapshots', { timeout: 2000 }, async t => {
  const first = Promise.withResolvers();
  const later = Promise.withResolvers();
  const provider = { ...installed('first'), transportUrl: 'stremio://first.example.test/config%2Fvalue/manifest.json?key=provider-fixture' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async raw => {
    if (raw === `${api}/addonCollectionGet`) return collection(provider, installed('second'), installed('third'), provider,
      installed('wrong-prefix', { resources: [{ name: 'stream', idPrefixes: ['other:'] }] }), installed('wrong-type', { types: ['movie'] }),
      { ...installed('invalid'), transportUrl: 'file:///manifest.json' });
    calls.push(raw);
    switch (new URL(raw).hostname) {
      case 'first.example.test': return first.promise;
      case 'second.example.test': return Response.json({ streams: [{ url: 'https://media.example.test/video.mp4' }, null, {}] });
      default: return Response.json({ streams: [] }, { status: 401 });
    }
  });
  const snapshots = [];
  const session = testSession(fixtureKey);
  const promise = createStreamClient(session).loadStreamSnapshot(target, undefined, snapshot => {
    snapshots.push(snapshot);
    if (snapshot.streams.length) later.resolve();
  });
  await later.promise;
  first.resolve(Response.json({ streams: [{ title: 'Provider notice' }] }));
  const result = await promise;
  assert.deepEqual(calls, [
    'https://first.example.test/config%2Fvalue/stream/series/tt123%3A2%3A3.json?key=provider-fixture',
    'https://second.example.test/stream/series/tt123%3A2%3A3.json',
    'https://third.example.test/stream/series/tt123%3A2%3A3.json',
  ]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.pending), [3, 2, 1, 0]);
  assert.deepEqual(result.streams.map(stream => stream.addonName), ['first', 'second']);
  assert.equal(result.complete, true);
  assert.equal(result.signedIn, true);
  assert.equal(await session.read(), fixtureKey);
  assert.doesNotMatch(JSON.stringify(snapshots), /provider-fixture|config%2Fvalue/);
  assert.match(result.error, /add-ons could not load/);
});

test('dismissal aborts provider requests without emitting stale results', { timeout: 2000 }, async t => {
  const started = Promise.withResolvers();
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (raw, options) => {
    if (raw === `${api}/addonCollectionGet`) return collection(installed('provider'));
    started.resolve(options.signal);
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const snapshots = [];
  const promise = createStreamClient(testSession(fixtureKey)).loadStreamSnapshot(target, controller.signal, snapshot => snapshots.push(snapshot));
  const providerSignal = await started.promise;
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(providerSignal.aborted, true);
  assert.equal(snapshots.length, 1);
});

test('Stremio invalid-session code clears the saved key, even over HTTP 200', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 1, message: 'Session does not exist' } }));
  const session = testSession(fixtureKey);
  const result = await createStreamClient(session).loadStreamSnapshot(target);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(await session.read(), null);
  assert.equal(result.signedIn, false);
  assert.equal(result.complete, true);
});

test('failed and cancelled sign-ins do not save a session', async t => {
  const session = testSession();
  const client = createStreamClient(session);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    if (JSON.parse(options.body).password === 'bad-fixture') return Response.json({ error: { code: 2 } });
    controller.abort();
    return Response.json({ result: { authKey: fixtureKey } });
  });
  await assert.rejects(client.signIn('account@example.test', 'bad-fixture'), /Check your email and password/);
  await assert.rejects(client.signIn('account@example.test', 'cancelled-fixture', controller.signal), { name: 'AbortError' });
  assert.equal(await session.read(), null);
});
