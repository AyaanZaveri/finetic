const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const seasonList = [{ number: 0, name: 'Specials', episodeCount: 1 }, { number: 1, name: 'Season 1', episodeCount: 2 }, { number: 20, name: 'Season 20', episodeCount: 2 }];
const episode = (season, number = 1) => ({ id: `tmdb:20:${season}:${number}`, title: `Title ${season}/${number}`, season, episode: number, overview: 'Overview' });
(async () => {
  const selectedSeasons = [];
  const { getSeriesLayoutData, getSeriesEpisodeSelectionData } = load('app/(main)/series/[id]/_shared/series-data.ts', {
    react: { cache: fn => { const values = new Map(); return (...args) => { const key = JSON.stringify(args); if (!values.has(key)) values.set(key, fn(...args)); return values.get(key); }; } },
    '@/lib/server/metadata-readers': { cachedHeaderEpisode: async () => null },
    '@/app/actions': { fetchMediaDetails: async () => ({ id: 'tmdb:20', type: 'series', name: 'Show', seasons: seasonList }) },
    '@/app/actions/tv-shows': { fetchEpisodeDetails: async (_id, season, number) => { selectedSeasons.push([season, number]); return episode(season, number); }, fetchEpisodes: async (_id, season) => { selectedSeasons.push(season); return [episode(season)]; } },
  });
  const overview = await getSeriesLayoutData('tmdb:20');
  assert.equal(overview.regularSeasonCount, 2);
  assert.deepEqual(selectedSeasons, [], 'Overview requires no episode requests');
  const detail = await getSeriesEpisodeSelectionData('tmdb:20', '20', '1');
  assert.deepEqual(selectedSeasons, [[20, 1]], 'A direct episode route requests exactly one episode, without a season list');
  assert.equal(detail.selectedEpisodeTitle, 'Title 20/1');
  assert.equal(detail.episodeMedia.mediaSourceId, undefined);
  assert.equal(detail.episodeMedia.id, 'tmdb:20:20:1');
  assert.equal((await getSeriesEpisodeSelectionData('tmdb:20', '0', '1')).selectedEpisode.season, 0);
  assert.equal(await getSeriesEpisodeSelectionData('tmdb:20', '-1', '1'), null);

  const sourceId = 'provider:show:2:2';
  let detailReads = 0;
  const embeddedDetails = load('app/(main)/series/[id]/_shared/series-data.ts', {
    react: { cache: fn => fn },
    '@/lib/server/metadata-readers': { cachedHeaderEpisode: async () => null },
    '@/app/actions': { fetchMediaDetails: async () => ({ id: 'tt123', type: 'series', name: 'Show', videos: [
      { id: sourceId, title: 'Star Potential', season: 2, episode: 2, released: '2025-04-27' },
    ] }) },
    '@/app/actions/tv-shows': { fetchEpisodeDetails: async () => {
      detailReads++;
      return { ...episode(2, 2), thumbnail: 'https://image.tmdb.org/t/p/w500/still.jpg' };
    } },
  });
  const repaired = await embeddedDetails.getSeriesEpisodeSelectionData('tt123', '2', '2');
  assert.equal(detailReads, 1, 'Embedded metadata without a still must resolve episode artwork');
  assert.equal(repaired.selectedEpisode.thumbnail, 'https://image.tmdb.org/t/p/w500/still.jpg');
  assert.equal(repaired.episodeMedia.id, sourceId, 'Artwork repair must preserve the add-on stream ID');

  let reads = 0;
  const pending = [];
  const client = load('lib/media/series-season.ts', {}, {
    URLSearchParams, AbortController,
    fetch: (url, options) => { reads++; return new Promise((resolve, reject) => {
      pending.push({ url, signal: options.signal, finish: value => resolve({ ok: true, json: async () => value }) });
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }); },
  });
  const a = client.acquireSeriesSeason('tmdb:20', 20), b = client.acquireSeriesSeason('tmdb:20', 20);
  assert.equal(a.promise, b.promise);
  assert.equal(reads, 1, 'Cards and streams share one metadata request');
  a.release(); assert.equal(pending[0].signal.aborted, false, 'One consumer cannot cancel another');
  const aborted = assert.rejects(a.promise); b.release(); await aborted;
  assert.equal(pending[0].signal.aborted, true);
  const replay = client.acquireSeriesSeason('tmdb:20', 20);
  assert.equal(reads, 2, 'Strict Mode or later navigation retries an aborted request');
  pending[1].finish([episode(20)]); await replay.promise; replay.release();
  const cached = client.acquireSeriesSeason('tmdb:20', 20);
  assert.equal((await cached.promise)[0].id, 'tmdb:20:20:1');
  assert.equal(reads, 2, 'Revisiting a completed season reuses cached metadata');
  cached.release();
  assert.equal(client.peekSeriesSeason('tmdb:20', 20)[0].episode, 1);

  const streamHooks = hooks();
  let routeParams = { season: '20', episode: '1' };
  const { EpisodeStreamsRouteAware } = load('components/episode-streams-route-aware.tsx', {
    react: streamHooks.react, 'react/jsx-runtime': streamHooks.jsx,
    'next/navigation': { useParams: () => routeParams },
    '@/components/media-actions': { MediaActions: 'MediaActions' },
    '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
    '@/components/ui/button': { Button: 'Button' },
    '@/lib/media/series-season': client,
  });
  const show = { id: 'tmdb:20', type: 'series', name: 'Show', seasons: seasonList };
  const renderStreams = () => { const tree = streamHooks.render(EpisodeStreamsRouteAware, { show }); streamHooks.flush(); return tree; };
  renderStreams(); await tick();
  assert.equal(renderStreams().props.children.props.media.id, 'tmdb:20:20:1', 'Manual streams use the selected episode after lazy loading');
  assert.equal(reads, 2, 'Manual streams reuse the same completed season read');
  routeParams = { season: '0', episode: '1' };
  renderStreams();
  pending[2].finish([episode(0)]); await tick();
  assert.equal(renderStreams().props.children.props.media.id, 'tmdb:20:0:1', 'Manual streams remain available for explicit specials');
  streamHooks.unmount();
  client.warmSeriesSeason('tmdb:20', 1);
  client.warmSeriesSeason('tmdb:20', 1);
  client.warmSeriesSeason('tmdb:20', 2);
  client.warmSeriesSeason('tmdb:20', 3);
  assert.equal(reads, 5, 'Season intent is deduplicated and limited to two speculative requests');
  const selectedWarm = client.acquireSeriesSeason('tmdb:20', 1);
  assert.equal(reads, 5, 'Selecting a highlighted season joins the speculative read');
  pending[3].finish([episode(1)]); pending[4].finish([episode(2)]);
  await selectedWarm.promise; selectedWarm.release(); await tick();
  assert.equal(client.peekSeriesSeason('tmdb:20', 1)[0].season, 1);

  const shuffleSeasons = [];
  const shuffle = load('lib/media/shuffle-episode.ts');
  const nativeActions = load('app/actions/tv-shows.ts', {
    'server-only': {},
    '@/lib/server/media-artwork': {},
    '@/lib/tmdb-artwork': { getTMDBArtwork: async () => undefined },
    '@/lib/server/outbound-fetch': { outboundFetch: async () => { throw Error('Unexpected addon request'); } },
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
    '@/lib/artwork': { publicArtworkUrl: value => value }, '@/lib/media/shuffle-episode': shuffle,
    './auth': { getAuthData: async () => ({}) }, "@/lib/server/auth": { getAuthData: async () => ({}) },
    '@/lib/tmdb-discovery': {
      getTMDBSeasons: async () => seasonList,
      getTMDBEpisodes: async (_id, season) => { shuffleSeasons.push(season); return [episode(season)]; },
      mapTMDBSeasons: async (values, read) => Promise.all(values.map(read)),
    },
  });
  const chosen = await nativeActions.getRandomEpisodeForSeries('tmdb:20');
  assert.deepEqual(shuffleSeasons, [1, 20], 'Whole-show shuffle still loads its complete regular-episode pool on demand');
  assert.ok(chosen.season === 1 || chosen.season === 20);

  let authorized = false, serverCalls = 0;
  const api = load('app/api/series/episodes/route.ts', {
    '@/app/actions/auth': { getAuthData: async () => { if (!authorized) throw Error('auth'); } }, "@/lib/server/auth": { getAuthData: async () => { if (!authorized) throw Error('auth'); } },
    '@/lib/tmdb-discovery': { getTMDBEpisodes: async (id, season, signal) => { serverCalls++; assert.equal(id, 'tmdb:20'); assert.ok(signal); return [episode(season)]; } },
  }, { Request, Response, URL });
  assert.equal((await api.GET(new Request('http://app/api/series/episodes?id=unknown&season=1'))).status, 400);
  assert.equal((await api.GET(new Request('http://app/api/series/episodes?id=tmdb:20&season=1'))).status, 200, 'Public episode metadata stays available before sign-in');
  assert.equal(serverCalls, 1);
  authorized = true;
  const response = await api.GET(new Request('http://app/api/series/episodes?id=tmdb:20&season=0'));
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal((await response.json())[0].season, 0, 'Explicit specials remain accessible');

  const h = hooks(), uiRequests = [], cardIntents = [];
  let failedSeason = 1;
  let reducedMotion = false;
  const scrolls = [], onScroll = new Set(), onResize = new Set();
  const windowFixture = {
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener: (_, callback) => onResize.add(callback),
    removeEventListener: (_, callback) => onResize.delete(callback),
  };
  const viewport = {
    clientWidth: 320, scrollWidth: 900, scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0 }),
    addEventListener: (_, callback) => onScroll.add(callback),
    removeEventListener: (_, callback) => onScroll.delete(callback),
    scrollBy(command) {
      scrolls.push(command);
      this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, this.scrollLeft + command.left));
      onScroll.forEach(callback => callback());
    },
  };
  const track = {
    closest: () => ({ querySelector: () => viewport }),
    querySelector: () => ({ clientWidth: 288, getBoundingClientRect: () => ({ left: 220 - viewport.scrollLeft }) }),
  };
  const modules = new Proxy({
    react: { ...require('react'), ...h.react }, 'react/jsx-runtime': h.jsx,
    '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
    '@/lib/artwork': { episodeThumbnailUrl: url => url, episodeHeroStillUrl: url => url },
    '@/lib/series-route': load('lib/series-route.ts'),
    '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({ playMedia() {} }) },
    '@/lib/media/resume-playback': load('lib/media/resume-playback.ts'),
    '@/lib/media/carousel-controls': load('lib/media/carousel-controls.ts', {}, { window: windowFixture }),
    '@/components/metadata-preload': { useSeasonMetadataIntent: () => () => {}, useMetadataIntent: media => ({
      start() { cardIntents.push(media); }, cancel() { cardIntents.push(null); },
    }) },
    '@/lib/media/series-season': { peekSeriesSeason: () => undefined, acquireSeriesSeason: (id, season) => {
      const record = { id, season, released: false };
      uiRequests.push(record);
      const episodes = season === 20 ? [episode(season), episode(season, 2), episode(season, 3)] : [episode(season)];
      return { promise: season === failedSeason ? Promise.reject(Error('offline')) : Promise.resolve(episodes), release: () => { record.released = true; } };
    } },
    '@/app/actions': { fetchPlaybackProgress: async () => null },
    '@/app/actions/tv-shows': { fetchSeasons: () => { throw Error('Known seasons cannot be fetched again'); }, fetchEpisodes: () => { throw Error('TMDB reads must avoid the client action queue'); } },
  }, { has: () => true, get: (object, name) => name in object ? object[name] : new Proxy({}, { get: (_, key) => key }) });
  const { SeasonEpisodes } = load('components/season-episodes.tsx', modules, { window: windowFixture, console: { error() {} } });
  const embeddedVideos = [episode(20)];
  const find = (node, predicate) => !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, predicate))];
  let trackRef;
  let currentEpisodeNumber = 1;
  const render = () => {
    const tree = h.render(SeasonEpisodes.type, { showId: 'tmdb:20', initialSeasons: seasonList, currentSeasonNumber: 20, currentEpisodeNumber, prefetchedVideos: embeddedVideos });
    if (trackRef) trackRef.current = null;
    trackRef = find(tree, node => node.type === 'div' && node.props?.ref && node.props.className?.includes('w-max'))[0]?.props.ref;
    if (trackRef) trackRef.current = track;
    h.flush();
    return tree;
  };
  render(); await tick(); let tree = render();
  assert.deepEqual(uiRequests.map(row => row.season), [20]);
  assert.equal(scrolls[0].behavior, 'instant', 'The selected episode is positioned before paint');
  const selectEpisode = (number, event) => {
    const card = find(tree, node => node.props?.episode?.episode === number)[0];
    card.props.onSelect({ button: 0, ...event }, `20:${number}`);
    const previousScrollCount = scrolls.length;
    currentEpisodeNumber = number;
    tree = render();
    assert.equal(scrolls.length, previousScrollCount + 1, 'Center the selection exactly once');
    return scrolls.at(-1).behavior;
  };
  assert.equal(selectEpisode(2, { detail: 1 }), 'smooth', 'Center the clicked episode with a slide');
  assert.equal(selectEpisode(3, { detail: 0 }), 'instant', 'Keyboard selection centers immediately');
  reducedMotion = true;
  assert.equal(selectEpisode(1, { detail: 1 }), 'instant', 'Reduced motion skips the selection slide');
  reducedMotion = false;
  const secondCard = find(tree, node => node.props?.episode?.episode === 2)[0];
  secondCard.props.onSelect({ button: 0, detail: 1, metaKey: true }, '20:2');
  currentEpisodeNumber = 2;
  tree = render();
  assert.equal(scrolls.at(-1).behavior, 'instant', 'Opening a card in another tab does not arm a slide');
  const getArrow = (tree, direction) => find(tree, node => node.props?.['aria-label'] === `Scroll ${direction}`)[0];
  viewport.scrollLeft = 0; onScroll.forEach(callback => callback());
  tree = render();
  assert.equal(getArrow(tree, 'left').props.disabled, true);
  getArrow(tree, 'right').props.onClick({ detail: 1 });
  assert.equal(scrolls.at(-1).behavior, 'smooth', 'Pointer clicks slide the episode rail');
  getArrow(tree, 'right').props.onClick({ detail: 0 });
  assert.equal(scrolls.at(-1).behavior, 'instant', 'Keyboard activation moves the rail immediately');
  reducedMotion = true;
  getArrow(tree, 'right').props.onClick({ detail: 1 });
  assert.equal(scrolls.at(-1).behavior, 'instant', 'Reduced motion moves the rail immediately');
  tree = render();
  assert.equal(getArrow(tree, 'right').props.disabled, true);
  viewport.scrollWidth = viewport.clientWidth; onResize.forEach(callback => callback());
  tree = render();
  assert.equal(getArrow(tree, 'right'), undefined, 'Hide arrows when the cards fit');
  const select = find(tree, node => node.type === 'Select')[0];
  assert.deepEqual(Array.from(select.props.options, option => option.value), ['1', '20', '0'], 'Regular seasons precede explicit specials');
  select.props.onValueChange('0'); render(); await tick(); tree = render();
  assert.deepEqual(uiRequests.map(row => row.season), [20, 0], 'Missing prefetched stills resolve only the selected season');
  assert.equal(uiRequests[0].released, true);
  find(tree, node => node.type === 'Select')[0].props.onValueChange('1'); render(); await tick(); tree = render();
  const retryButton = find(tree, node => node.type === 'Button' && node.props.children === 'Try again')[0];
  assert.ok(retryButton, 'Season failures expose recovery rather than old-season cards');
  assert.equal(find(tree, node => node.props?.children === 'No episodes found for this season').length, 0);
  failedSeason = -1; retryButton.props.onClick(); render(); await tick(); tree = render();
  assert.equal(find(tree, node => node.type === 'Button' && node.props.children === 'Try again').length, 0);
  assert.equal(uiRequests.at(-1).season, 1);
  const episodeNode = find(tree, node => node.props?.episode?.episode === 1)[0];
  h.unmount();
  const cardHost = hooks();
  Object.assign(modules.react, cardHost.react);
  const card = cardHost.render(episodeNode.type.type, episodeNode.props);
  const link = find(card, node => node.type === 'IntentLink')[0];
  link.props.onPointerEnter({ pointerType: 'mouse' });
  assert.equal(cardIntents[0].id, 'tmdb:20');
  assert.equal(cardIntents[0].seasonNumber, 1);
  assert.equal(cardIntents[0].episodeNumber, 1);
  link.props.onPointerLeave();
  assert.equal(cardIntents[1], null);
  cardHost.unmount();
  console.log('PASS: lightweight overview/counts, single-episode headers without season requests, explicit specials, shared/retryable reads, auth, cancellation and on-demand season browsing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
