const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
class OutboundRequestError extends Error {}
const logs = [];
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/streams/addon/route.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, URL, Response, console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  require: name => name === '@/lib/server/outbound-fetch' ? { OutboundRequestError,
    outboundFetch: async () => { throw new OutboundRequestError('Private and reserved network destinations are not allowed.'); },
  } : name === 'next/server' ? { NextResponse: { json: (body, init) => Response.json(body, init) } }
    : name === '@/app/actions/auth' ? { getInstalledAddons: async () => [{ transportUrl: 'http://192.168.1.5/private-secret/manifest.json', manifest: { id: 'local', resources: ['stream'] } }] } : {},
});
(async () => {
  const response = await exportsObject.GET(new Request('https://navigator.test/api/streams/addon?mediaItemId=tt123&type=movie&addonId=local'));
  assert.equal(response.status, 422, 'Unavailable private-network addons are configuration errors, not application crashes');
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.deepEqual((await response.json()).streams, []);
  assert.equal(logs.length, 0, 'Expected blocked destinations must not emit repeated exception stacks');
  console.log('PASS: blocked addon destination stays blocked, returns private 422 and emits no exception stack');
})().catch(error => { console.error(error); process.exitCode = 1; });
