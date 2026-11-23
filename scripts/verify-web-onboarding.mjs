import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
async function response(path, init) {
    return fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
}
async function json(path, init) {
    const result = await response(path, init);
    assert.equal(result.status, 200, path);
    return result.json();
}

for (const type of ["movie", "series"]) {
    const feed = await json(`/api/discovery/home?feed=cinemeta-${type}`);
    assert.equal(feed.status, "ready");
    assert.ok(feed.section.mediaItems.length > 0);
    assert.ok(feed.section.mediaItems.some(item => item.poster?.startsWith("https://images.metahub.space/poster/")));
    assert.ok(feed.section.mediaItems.every(item => item.type === type && /^tt\d+$/.test(item.id)));
}
assert.equal((await response("/api/discovery/home?feed=unlisted")).status, 404);
const suggestions = await json("/api/search/suggestions?q=alien");
assert.equal(suggestions.sections[0].title, "Cinemeta");
assert.ok(suggestions.sections[0].items.some(item => item.id === "tt0078748"));
const search = await json("/api/search/results?q=breaking%20bad&type=series");
assert.equal(search.provider, "Cinemeta");
assert.ok(search.results.some(item => item.id === "tt0903747"));
assert.equal((await json("/api/search/results?q=alien&type=person")).totalResults, 0);
for (const provider of ["cinemeta", "tmdb"]) {
    const preference = { headers: { cookie: `navigator-metadata-provider=${provider}` } };
    const episodes = await json("/api/series/episodes?id=tt0903747&season=1", preference);
    assert.equal(episodes.find(item => item.episode === 1)?.title, "Pilot");
    assert.ok(episodes.some(item => item.thumbnail?.startsWith("https://episodes.metahub.space/")));
}
assert.equal((await response("/api/home/catalogs", { method: "POST" })).status, 401);
assert.equal((await response("/settings/connections")).status, 307);
assert.equal((await response("/movie/tt0078748.json")).status, 307);
console.log("PASS: live no-token catalogs, retry allowlist, suggestions, search, episode metadata, and guest access boundaries.");
