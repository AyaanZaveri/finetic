import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, lstat, symlink, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchSparkle } from './fetch-sparkle.mjs';
if (process.platform === 'darwin') {
    const exec=promisify(execFile),sdk=await fetchSparkle();
    const directory=await mkdtemp(join(tmpdir(),'navigator-delta-unit-'));
    try {
        const old=join(directory,'old'),next=join(directory,'new'),restored=join(directory,'restored'),patch=join(directory,'fixture.delta');
        await mkdir(old);await mkdir(next);
        for(const root of [old,next]) {
            await writeFile(join(root,'unchanged'),Buffer.alloc(128*1024,42));
            await symlink('unchanged',join(root,'link'));
        }
        await writeFile(join(old,'screen.js'),'old UI');await writeFile(join(next,'screen.js'),'new UI');
        await writeFile(join(old,'removed'),'removed');await writeFile(join(next,'added'),'added');
        await chmod(join(next,'screen.js'),0o755);
        await exec(join(sdk,'bin/BinaryDelta'),['create',old,next,patch]);
        await exec(join(sdk,'bin/BinaryDelta'),['apply',old,restored,patch]);
        assert.equal(await readFile(join(restored,'screen.js'),'utf8'),'new UI');
        assert.equal(await readFile(join(restored,'added'),'utf8'),'added');
        assert.equal(await readlink(join(restored,'link')),'unchanged');
        assert.equal((await lstat(join(restored,'screen.js'))).mode & 0o777,0o755);
        await assert.rejects(readFile(join(restored,'removed')),/ENOENT/);
        await writeFile(join(old,'unchanged'),'corrupted base');
        await assert.rejects(exec(join(sdk,'bin/BinaryDelta'),['apply',old,join(directory,'bad'),patch]));
        console.log('PASS: verified Sparkle binary delta round trip, file additions/removals, permissions, symlinks, and corrupt-base rejection (fixture files only).');
    } finally { await rm(directory,{recursive:true,force:true}); }
}
