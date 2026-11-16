const assert = require('node:assert/strict');
const details = require('./test-support/playback-context.cjs').details;
const poster = 'https://image.tmdb.org/t/p/w500/poster.jpg';
const background = 'https://image.tmdb.org/t/p/w1280/backdrop.jpg';
const request = { id: 'tt123', type: 'movie', name: 'Movie', backdropUrl: poster,
  details: { id: 'tt123', type: 'movie', name: 'Movie', poster } };
const initial = details.initialPlaybackDetails(request);
assert.equal(initial.background, undefined, 'A catalog poster must not become a player backdrop');
assert.equal(details.playbackBackdrop(request, initial), undefined);
assert.equal(details.playbackBackdrop({ ...request, backdropUrl: poster.replace('/w500/', '/original/') }, initial), undefined, 'A resized poster is still a poster');
const enriched = details.mergePlaybackDetails(initial, { ...request.details, background });
assert.equal(details.playbackBackdrop(request, enriched), background, 'Fetched movie backdrop replaces the original poster fallback');
assert.equal(details.playbackBackdrop({ ...request, backdropUrl: background }, request.details), background, 'Continue Watching can use its supplied backdrop immediately');
assert.equal(details.playbackBackdrop({ ...request, type: 'series', backdropUrl: '/episode-still.jpg' }, request.details), '/episode-still.jpg', 'Episode stills remain valid');
const player = require('node:fs').readFileSync('components/global-media-player.tsx', 'utf8');
assert.match(player, /fallbackBackdrop\s*=\s*playbackBackdrop\(currentMedia, mediaDetails\)/, 'The actual player uses the same artwork selection');
console.log('PASS: catalog poster rejection, metadata enrichment, Continue Watching and episode still backdrops');
