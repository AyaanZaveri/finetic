// Run against a production build: npm run build && npm run test:navigation
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { EncryptJWT } from 'jose';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('./navigation-fixture.cjs', import.meta.url));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const { port } = socket.address();
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const sessionSecret = randomBytes(32);
const token = await new EncryptJWT({ authKey: 'navigation-perf-fixture', user: { _id: 'navigation-fixture', email: 'fixture@example.invalid' } })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' }).setIssuer('navigator').setAudience('navigator-session')
    .setSubject('navigation-fixture').setIssuedAt().setExpirationTime('1h').encrypt(sessionSecret);
const cookie = `stremio-auth=${token}`;
const server = spawn(process.execPath, [
    '--require', fixture, 'node_modules/next/dist/bin/next',
    'start', '--hostname', '127.0.0.1', '--port', String(port),
], { cwd: root, env: { ...process.env, NAVIGATOR_SESSION_SECRET: sessionSecret.toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', (chunk) => { logs += chunk; });
server.stderr.on('data', (chunk) => { logs += chunk; });
const stopped = once(server, 'exit');

try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
        try {
            const response = await fetch(`${origin}/login`);
            await response.text();
            if (response.ok) { ready = true; break; }
        } catch { /* Wait for the listening socket. */ }
        await pause(100);
    }
    assert.ok(ready, 'Production server did not become ready');

    const cases = [
        ['/series/show-1', 'Navigation Test Show', false],
        ['/series/show-1/1/2', '2. Fixture Episode 2', false],
        ['/series/show-1/1/1', '1. Fixture Episode 1', false],
        ['/movie/movie-1', 'Navigation Test Movie', false],
    ];
    for (const [path, title, hasProgress] of cases) {
        const start = performance.now();
        const response = await fetch(origin + path, {
            headers: { cookie, 'Accept-Encoding': 'identity' },
        });
        assert.equal(response.status, 200, path);
        let html = '';
        let titleMs;
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
            html += decoder.decode(chunk, { stream: true });
            const renderedTitles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
            if (titleMs === undefined && renderedTitles.some((match) =>
                match[1].replace(/<[^>]*>/g, '') === title
            )) titleMs = performance.now() - start;
        }
        assert.ok(titleMs !== undefined, `${path}: title did not render`);
        assert.ok(titleMs < 700, `${path}: title blocked for ${Math.round(titleMs)}ms`);
        assert.ok(performance.now() - start >= 1100, `${path}: slow services were not exercised`);
        assert.equal(html.includes('width:50%'), hasProgress, `${path}: detail artwork should not show a progress overlay`);
        assert.ok(html.includes('More like this'), `${path}: recommendations did not stream`);
        console.log(`${path}: title ${Math.round(titleMs)}ms; slow extras streamed separately`);
    }

    // An uncached metadata request must still reveal the route's loading UI
    // immediately, including above the async series layout.
    for (const path of ['/movie/movie-slow', '/series/show-slow']) {
        const start = performance.now();
        const response = await fetch(origin + path, { headers: { cookie } });
        assert.equal(response.status, 200);
        let html = '';
        let loadingMs;
        for await (const chunk of response.body) {
            html += new TextDecoder().decode(chunk);
            if (loadingMs === undefined && html.includes('aria-label="Loading media details"')) {
                loadingMs = performance.now() - start;
            }
        }
        assert.ok(loadingMs < 700, `${path}: loading UI was blocked by metadata`);
        assert.ok(performance.now() - start >= 1100, `${path}: slow metadata was not exercised`);
        console.log(`${path}: loading UI ${Math.round(loadingMs)}ms`);
    }
    const unauthenticated = await fetch(`${origin}/movie/movie-1`, { redirect: 'manual' });
    assert.equal(unauthenticated.status, 307);
    assert.equal(new URL(unauthenticated.headers.get('location'), origin).pathname, '/login');
    console.log('Navigation streaming and authentication checks passed.');
} catch (error) {
    console.error(logs.slice(-3000));
    throw error;
} finally {
    server.kill('SIGTERM');
    await stopped;
}
