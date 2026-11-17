const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const React = require('react');
const { renderToPipeableStream } = require('react-dom/server');
const { load } = require('./test-support/react-hooks.cjs');
const css = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
const shared = { react: React, 'react/jsx-runtime': require('react/jsx-runtime') };
const { PersonCreditsSample } = load('components/person-credits-sample.tsx', {
    ...shared, './person-page.module.css': css, './media-section.module.css': css,
});
const { PersonCreditsBoundary } = load('components/person-credits-boundary.tsx', {
    ...shared, 'skullet/react': require('skullet/react'), './person-credits-boundary.module.css': css,
});
(async () => {
    let ready = false, finish;
    const waiting = new Promise(resolve => { finish = resolve; });
    function Credits() {
        if (!ready) throw waiting;
        return React.createElement('p', null, 'Loaded person credits');
    }
    let html = '', shell;
    const errors = [], output = new PassThrough();
    output.on('data', chunk => { html += chunk; });
    const shellReady = new Promise(resolve => { shell = resolve; });
    const ended = new Promise((resolve, reject) => { output.on('end', resolve); output.on('error', reject); });
    const stream = renderToPipeableStream(React.createElement(PersonCreditsBoundary, {
        sample: React.createElement(PersonCreditsSample),
    }, React.createElement(Credits)), {
        onShellReady() { stream.pipe(output); shell(); }, onError(error) { errors.push(error); },
    });
    await shellReady;
    await new Promise(resolve => setImmediate(resolve));
    assert.match(html, /Loading person credits/);
    assert.match(html, /skullet-block=""/);
    assert.match(html, /inert=""/);
    assert.doesNotMatch(html, /<img|<a\b|<button|Loading filmography/);
    ready = true; finish();
    await ended;
    assert.deepEqual(errors, []);
    assert.match(html, /Loaded person credits/);
    console.log('PASS: person skeleton streams inert carousel/filter/grid samples and reveals credits without loading text or sample requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
