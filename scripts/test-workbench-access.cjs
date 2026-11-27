const assert = require('node:assert/strict');
const fs = require('node:fs');
const { NextResponse } = require('next/server');
const { load } = require('./test-support/react-hooks.cjs');

const workbenches = fs.readdirSync('app/states', { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(`app/states/${entry.name}/page.tsx`))
    .map(entry => `/states/${entry.name}`);

async function main() {
    for (const mode of ['development', 'production']) {
        const globals = { process: { env: { NODE_ENV: mode } } };
        const { proxy } = load('proxy.ts', {
            'next/server': { NextResponse },
            '@/lib/server/session': { readSession: async () => ({ user: { _id: 'fixture' } }), SESSION_COOKIE: 'session' },
        }, globals);
        const { default: layout } = load('app/states/layout.tsx', {
            'next/navigation': { notFound: () => { throw Error('not found'); } },
        }, globals);
        for (const path of workbenches) {
            for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://navigator.example']) {
                const request = { nextUrl: new URL(path, origin), cookies: { get: () => ({ value: 'signed-in' }) } };
                const local = origin.startsWith('http://');
                assert.equal((await proxy(request)).status, mode === 'development' && local ? 200 : 404, `${mode} ${origin}${path}`);
            }
        }
        if (mode === 'development') assert.equal(layout({ children: 'preview' }), 'preview');
        else assert.throws(() => layout({ children: 'preview' }), /not found/);
    }
    console.log(`PASS: ${workbenches.length} workbenches are available only in local development`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
