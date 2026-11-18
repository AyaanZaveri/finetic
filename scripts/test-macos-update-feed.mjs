import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeMacOSFeed, KEYCHAIN_ACCOUNT } from "./macos-update-feed.mjs";
import { updateReleaseNotesXml } from "./update-release-notes.mjs";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const bytes = Buffer.from("immutable macOS release archive fixture");
const options = { version: "0.5.3", tag: "release-v0.5.3", filename: "Navigator-0.5.3-macos-arm64.zip", bytes,
    signature: sign(null, bytes, privateKey).toString("base64"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64") };
const feed = makeMacOSFeed(options);
assert.ok(feed.includes(`<description>${updateReleaseNotesXml}</description>`), "macOS feeds embed the same theme-aware release notes as Windows");
assert.match(feed, /sparkle:version="0.5.3"/);
assert.match(feed, /minimumSystemVersion>13.5/);
assert.match(feed, /releases\/download\/release-v0.5.3\/Navigator-0.5.3-macos-arm64.zip/);
assert.ok(feed.includes(`length="${bytes.length}"`));
assert.throws(() => makeMacOSFeed({ ...options, bytes: Buffer.from("tampered") }), /signature/);
const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
assert.throws(() => makeMacOSFeed({ ...options, publicKey: other }), /signature/);
for (const invalid of [{ filename: "../Navigator.zip" }, { filename: "Navigator-0.5.3-windows-x64-portable.zip" }, { version: "0.5.3-beta" }, { tag: "release-v0.5.2" }]) {
    assert.throws(() => makeMacOSFeed({ ...options, ...invalid }), /metadata/);
}
assert.equal(KEYCHAIN_ACCOUNT, "app.navigator.desktop.sparkle");
const key = readFileSync("desktop/macos/update-public-key.txt", "utf8").trim();
assert.equal(Buffer.from(key, "base64").length, 32);
const deltaBytes = Buffer.from('small delta');
const delta = {from:'0.5.2',filename:'Navigator-0.5.3-macos-arm64-from-0.5.2.delta',bytes:deltaBytes,signature:sign(null,deltaBytes,privateKey).toString('base64')};
const incremental = makeMacOSFeed({...options,deltas:[delta]});
assert.match(incremental, /<sparkle:deltas>/);
assert.match(incremental, /sparkle:deltaFrom="0.5.2"/);
assert.ok(incremental.includes(options.filename), 'Delta feeds retain the signed full archive for fallback');
assert.throws(()=>makeMacOSFeed({...options,deltas:[{...delta,bytes:Buffer.from('corrupted')}]}),/delta/);
assert.throws(()=>makeMacOSFeed({...options,deltas:[delta,delta]}),/delta/);
console.log("PASS: macOS archive signatures, tamper and wrong-key rejection, stable release metadata, platform isolation and minimum OS.");
