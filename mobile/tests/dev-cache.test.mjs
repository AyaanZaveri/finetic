import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/restore-dev-client.sh', import.meta.url));
const hash = 'a'.repeat(64);
const sha = 'b'.repeat(40);
const artifact = `navigator-dev-android-${hash}`;

function fixture(t, producerEvent = 'push', corruptDigest = false) {
  const dir = mkdtempSync(join(tmpdir(), 'navigator-dev-cache-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(script, join(dir, 'scripts', 'restore-dev-client.sh'));
  // Synthetic APK shape only; no simulator or real development build.
  const python = spawnSync('python3', ['-c', `
import sys, zipfile, hashlib, json
from pathlib import Path
p = Path(sys.argv[1])
with zipfile.ZipFile(p / 'android.apk', 'w') as apk:
    apk.writestr('AndroidManifest.xml', b'fixture')
    apk.writestr('classes.dex', b'fixture' * 1000)
with zipfile.ZipFile(p / 'artifact.zip', 'w') as z:
    z.write(p / 'android.apk', 'android.apk')
digest = hashlib.sha256((p / 'artifact.zip').read_bytes()).hexdigest()
if sys.argv[2] == 'true': digest = '0' * 64
(p / 'artifacts.json').write_text(json.dumps({'artifacts':[{'id':11,'name':sys.argv[3],'size_in_bytes':10000,'expired':False,'created_at':'2026-11-27','digest':'sha256:'+digest,'workflow_run':{'id':22,'repository_id':123,'head_repository_id':123,'head_branch':'mobile','head_sha':sys.argv[4]}}]}))
(p / 'run.json').write_text(json.dumps({'path':'.github/workflows/mobile-development.yml','event':sys.argv[5],'repository':{'id':123},'head_repository':{'id':123},'head_branch':'mobile','head_sha':sys.argv[4],'status':'completed','conclusion':'success'}))
`, dir, String(corruptDigest), artifact, sha, producerEvent], { encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr);
  const gh = join(dir, 'bin', 'gh');
  writeFileSync(gh, `#!/usr/bin/env bash
set -eu
case "$*" in
  */artifacts/11/zip*) cat "$MOCK_CACHE_ROOT/artifact.zip" ;;
  */runs/22*) cat "$MOCK_CACHE_ROOT/run.json" ;;
  */actions/artifacts*) cat "$MOCK_CACHE_ROOT/artifacts.json" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(gh, 0o755);
  return {
    dir,
    restore(event = 'push') {
      const out = join(dir, 'output.txt');
      const result = spawnSync('bash', [join(dir, 'scripts', 'restore-dev-client.sh'), 'android', hash], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          MOCK_CACHE_ROOT: dir,
          GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event, GITHUB_REF_TYPE: 'branch',
          GITHUB_REPOSITORY: 'owner/repo', GITHUB_REPOSITORY_ID: '123', GITHUB_REF_NAME: 'mobile',
          GITHUB_SHA: sha, GITHUB_RUN_ID: '33', GITHUB_OUTPUT: out, GH_TOKEN: 'test-token',
        },
      });
      assert.equal(result.status, 0, result.stderr);
      return { hit: readFileSync(out, 'utf8').trim(), binary: existsSync(join(dir, 'test-results/dev-client/android.apk')) };
    },
  };
}

test('trusted same-branch development build is restored after digest validation', t => {
  assert.deepEqual(fixture(t).restore(), { hit: 'hit=true', binary: true });
});

test('artifact from pull request producer is never restored', t => {
  assert.deepEqual(fixture(t, 'pull_request').restore(), { hit: 'hit=false', binary: false });
});

test('pull request consumer does not attempt a cache restore', t => {
  assert.deepEqual(fixture(t).restore('pull_request'), { hit: 'hit=false', binary: false });
});

test('artifact digest mismatch is a clean cache miss', t => {
  assert.deepEqual(fixture(t, 'push', true).restore(), { hit: 'hit=false', binary: false });
});
