import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { createPrefetchScheduler, rememberTitleSummary, selectPrefetchTitles, titleQueryOptions, titleSummaryKey } from '../lib/title-cache-core.ts';

const title = (id, type = 'movie', fields = {}) => ({ id, type, name: id, ...fields });
const turn = () => new Promise(resolve => setImmediate(resolve));

test('prefetch selects only a bounded number of unique valid identities in priority order', () => {
  const a = title('tt1');
  const b = title('tt1', 'series');
  const c = title('tt2');
  assert.deepEqual(selectPrefetchTitles([a, a, title('invalid'), b, title('tmdb:1'), c, title('tt3')], 3), [a, b, c]);
  assert.deepEqual(selectPrefetchTitles([a, b], 0), []);
});

test('summary writes retain known artwork but do not overwrite full title metadata', () => {
  const client = new QueryClient();
  try {
    const summary = title('tt1', 'movie', { logo: 'https://images.metahub.space/logo/medium/tt1/img' });
    const full = { ...summary, description: 'Full metadata' };
    client.setQueryData(titleQueryOptions('movie', 'tt1').queryKey, full);
    rememberTitleSummary(client, summary);
    rememberTitleSummary(client, title('tt1', 'movie', { logo: undefined, year: 2020 }));
    assert.equal(client.getQueryData(titleSummaryKey('movie', 'tt1')).logo, summary.logo);
    assert.equal(client.getQueryData(titleSummaryKey('movie', 'tt1')).year, 2020);
    assert.equal(client.getQueryData(titleQueryOptions('movie', 'tt1').queryKey).description, 'Full metadata');
  } finally { client.clear(); }
});

test('one canonical title key deduplicates prefetch with an overlapping detail load and serves fresh cache', async () => {
  const client = new QueryClient();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    await turn();
    return new Response(JSON.stringify({ meta: title('tt1') }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const options = titleQueryOptions('movie', 'tt1');
    await Promise.all([client.prefetchQuery(options), client.fetchQuery(titleQueryOptions('movie', 'tt1'))]);
    assert.equal((await client.fetchQuery(options)).id, 'tt1');
    assert.equal(requests, 1);
    assert.notDeepEqual(options.queryKey, titleQueryOptions('movie', 'tt2').queryKey);
    assert.notDeepEqual(options.queryKey, titleQueryOptions('series', 'tt1').queryKey);
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test('prefetch queue bounds running work, shares overlapping requests and removes obsolete pending items', async () => {
  const started = [];
  const finish = new Map();
  const schedule = createPrefetchScheduler(item => item, item => new Promise(resolve => {
    started.push(item);
    finish.set(item, resolve);
  }));
  const cancel = schedule(['a', 'b', 'c', 'd']);
  const cancelOther = schedule(['a', 'c', 'e']);
  await turn();
  assert.deepEqual(started, ['a', 'b']);
  cancel();
  finish.get('a')();
  await turn();
  assert.deepEqual(started, ['a', 'b', 'c']);
  cancelOther();
  finish.get('b')();
  finish.get('c')();
  await turn();
  assert.deepEqual(started, ['a', 'b', 'c']);
});
