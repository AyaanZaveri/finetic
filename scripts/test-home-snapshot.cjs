const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { QueryClient, QueryObserver, notifyManager } = require('@tanstack/react-query');
const { load, hooks } = require('./test-support/react-hooks.cjs');

const indexedDB = new IDBFactory();
let now = Date.now();
const storage = () => load('lib/home-snapshot.ts', {}, { indexedDB, Date: { now: () => now } });
const query = load('lib/media/continue-watching-query.ts');
const account = 'account:1';
const catalogKey = 'addon-' + 'a'.repeat(64);
const artwork = 'https://image.tmdb.org/t/p/w500/poster.jpg';
const movie = { id: 'tt123', type: 'movie', name: 'Saved title', poster: artwork, resumePositionTicks: 25,
    background: 'https://image.tmdb.org/t/p/w500/private.jpg?token=should-not-persist',
    streamUrl: 'https://stream.test/private', addonTransportUrl: 'https://addon.test/token', subtitleFilename: 'private' };
const result = (item, key = catalogKey) => ({ key, result: { status: 'ready', section: item && { key, sectionName: 'Favorites', mediaItems: [item] } } });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(condition) {
    for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await tick();
    }
    assert.fail('Home cache did not settle');
}

async function run() {
    const first = storage();
    await first.restoreHomeSnapshot(account);
    const heroItem = { ...movie, background: artwork, logo: 'https://image.tmdb.org/t/p/original/hero.png' };
    await Promise.all([
        first.updateHomeSnapshot(account, (snapshot, timestamp) => first.mergeHomeCatalogs(snapshot, [result(movie)], now, timestamp)),
        first.updateHomeSnapshot(account, snapshot => first.mergeHomeHero(snapshot, [heroItem], now)),
        first.updateHomeSnapshot(account, (snapshot, timestamp) => ({
            ...snapshot, resume: { data: first.snapshotItems([movie], 20), updatedAt: timestamp },
        })),
    ]);

    const reopened = storage();
    const restored = await reopened.restoreHomeSnapshot(account);
    assert.equal(restored.catalogs[0].data.mediaItems[0].poster, artwork);
    assert.equal(restored.resume.data[0].resumePositionTicks, 25);
    assert.equal(restored.hero.data[0].logo, heroItem.logo, 'Store the resolved wordmark alongside the cached hero');
    assert.doesNotMatch(JSON.stringify(restored), /should-not-persist|stream\.test|addon\.test|subtitleFilename/);

    // Mount the real persistence owner and a real TanStack observer together.
    const host = hooks();
    const client = new QueryClient();
    const { HomeSnapshotProvider } = load('components/home-snapshot-provider.tsx', {
        react: host.react, 'react/jsx-runtime': host.jsx,
        '@tanstack/react-query': { useQueryClient: () => client },
        '@/lib/home-snapshot': reopened, '@/lib/media/continue-watching-query': query,
    }, { Date: { now: () => now } });
    const provider = () => host.render(HomeSnapshotProvider, { scope: account, children: null });
    let finish, requests = 0;
    const observer = new QueryObserver(client, query.continueWatchingOptions(account, () => {
        requests++;
        return new Promise(resolve => { finish = resolve; });
    }));
    const unsubscribe = observer.subscribe(() => {});
    provider(); host.flush();
    await waitFor(() => provider().props.value.catalogs.length && observer.getCurrentResult().data?.length);
    assert.equal(requests, 1, 'Restore does not defer or skip the live refresh');
    const homeHero = () => provider().props.children.props.value;
    const home = homeHero();
    assert.equal(home.heroItems[0].logo, heroItem.logo);
    const secondSlide = { ...heroItem, id: 'tt124' };
    home.saveHero([secondSlide]);
    home.saveHeroView({ slide: 'movie:tt124', rotation: false });
    assert.equal(homeHero().heroItems[0].id, 'tt124', 'Warm navigation sees the live hero without waiting for IndexedDB');
    assert.equal(homeHero().heroView.slide, 'movie:tt124');
    assert.equal((await reopened.restoreHomeSnapshot(account)).hero.data[0].id, 'tt124');
    assert.equal(observer.getCurrentResult().fetchStatus, 'fetching');
    assert.equal(observer.getCurrentResult().data[0].name, 'Saved title');
    assert.equal(observer.getCurrentResult().dataUpdatedAt, now, 'Hydration preserves snapshot age');
    const obsoleteRead = finish;
    await query.removeContinueWatchingCard(client, account, movie, async () => true);
    obsoleteRead([movie]);
    await waitFor(() => observer.getCurrentResult().data?.length === 0);
    assert.equal(client.getQueryData(query.continueWatchingKey(account)).length, 0,
        'Canceling the in-flight refresh cannot bring back a removed saved card');
    const fresh = { ...movie, name: 'New title', resumePositionTicks: 50 };
    const refresh = observer.refetch();
    finish([fresh]);
    await refresh;
    await waitFor(() => observer.getCurrentResult().data?.[0]?.name === fresh.name);
    await query.removeContinueWatchingCard(client, account, fresh, async () => true);
    now = Math.max(now, Date.now());
    assert.equal((await reopened.restoreHomeSnapshot(account)).resume.data.length, 0, 'Store confirmed removals');
    unsubscribe(); host.unmount(); client.clear();

    now += 1000;
    const changed = await reopened.updateHomeSnapshot(account, (snapshot, timestamp) =>
        reopened.mergeHomeCatalogs(snapshot, [result(fresh)], now, timestamp));
    assert.equal(changed.catalogs[0].data.mediaItems[0].name, fresh.name);
    const failed = await reopened.updateHomeSnapshot(account, (snapshot, timestamp) => reopened.mergeHomeCatalogs(snapshot,
        [{ key: catalogKey, result: { status: 'error' } }], now + 1, timestamp));
    assert.equal(failed.catalogs[0].updatedAt, changed.catalogs[0].updatedAt, 'Failures keep usable rows without extending their life');
    const obsolete = await reopened.updateHomeSnapshot(account, (snapshot, timestamp) =>
        reopened.mergeHomeCatalogs(snapshot, [result(movie)], now - 1, timestamp));
    assert.equal(obsolete.catalogs[0].data.mediaItems[0].name, fresh.name, 'A prior request cannot overwrite a newer list');
    const empty = await reopened.updateHomeSnapshot(account, (snapshot, timestamp) =>
        reopened.mergeHomeCatalogs(snapshot, [result(null)], now + 2, timestamp));
    assert.equal(empty.catalogs.length, 0, 'A successful empty refresh removes stale content');

    await reopened.updateHomeSnapshot(account, (snapshot, timestamp) => reopened.mergeHomeCatalogs(snapshot, [result(movie)], now + 3, timestamp));
    now += 24 * 60 * 60_000;
    const expired = await storage().restoreHomeSnapshot(account);
    assert.equal(expired.catalogs.length, 0, 'Expired catalog entries are deleted on restore');
    assert.equal(expired.hero, undefined, 'The same expiry applies to the hero cache');
    await reopened.updateHomeSnapshot(account, (snapshot, timestamp) => reopened.mergeHomeCatalogs(snapshot, [result(movie)], now, timestamp));
    assert.equal((await storage().restoreHomeSnapshot('other:1')).catalogs.length, 0);
    await reopened.restoreHomeSnapshot('anonymous');
    let lateWrite = false;
    await reopened.updateHomeSnapshot(account, snapshot => { lateWrite = true; return snapshot; });
    assert.equal(lateWrite, false);
    assert.equal((await storage().restoreHomeSnapshot(account)).catalogs.length, 0, 'Sign-out removes the entire saved Home view');
    const denied = load('lib/home-snapshot.ts', {}, { indexedDB: { open() { throw Error('Storage denied'); } } });
    assert.equal(await denied.restoreHomeSnapshot(account), undefined);
    console.log('PASS: persisted Home rows, hero and artwork URLs, startup refresh, privacy, expiry, account changes, empty results and conflict-safe writes');
}

notifyManager.setScheduler(queueMicrotask);
run().catch(error => { console.error(error); process.exitCode = 1; });
