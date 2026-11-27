const assert = require('node:assert/strict');

const base = process.env.NAVIGATOR_TEST_BASE_URL || 'http://localhost:3000';

async function main() {
    const scenarios = [
        { state: 'ready', company: 'T-Street', collection: true },
        { state: 'guest', company: 'T-Street', collection: true },
        { state: 'recommendations-empty', company: 'T-Street', collection: true },
        { state: 'series-ready', company: 'Sony Pictures Television', collection: false },
        { state: 'series-guest', company: 'Sony Pictures Television', collection: false },
        { state: 'loading', collection: false },
        { state: 'not-found', collection: false },
    ];
    for (const { state, company, collection } of scenarios) {
        const url = new URL('/states/movie-detail', base);
        url.searchParams.set('__stage', '1');
        url.searchParams.set('__state', state);
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        assert.ok(response.ok, `${state}: workbench HTTP ${response.status}`);
        const html = await response.text();
        const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(match => match[1]);
        assert.equal(headings.filter(heading => heading === 'Production companies').length, company ? 1 : 0, state);
        assert.equal(headings.includes('Knives Out Collection'), collection, state);
        if (company) assert.ok(html.includes(company), `${state}: real fixture company`);
    }
    console.log('PASS: movie and TV detail workbench routes include the correct production companies and movie collection');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
