const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/addons.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { toAddonListItem, filterAddons, addonTypeLabel } = context.exports;
for (const [type, label] of Object.entries({
  movie: 'Movies', series: 'TV Shows', 'anime.movie': 'Anime Movies',
  'anime.series': 'Anime TV Shows', anime: 'Anime', Trakt: 'Trakt',
  collection: 'Collection', library: 'Library', other: 'Other', tv: 'TV',
  events: 'Events', subtitles: 'Subtitles', 'custom_category.name': 'Custom Category Name',
})) assert.equal(addonTypeLabel(type), label);
const addon = toAddonListItem({
  transportUrl: 'https://example.com/private-configuration-token/manifest.json',
  manifest: {
    id: 'sample', name: ' Example ', description: 'Independent cinema', version: '1.0',
    resources: ['streams', { name: 'stream', types: ['movie'] }, 'meta'],
    types: ['movie', 'movie'], catalogs: [{ id: 'popular' }],
  },
}, 0);
assert.equal(addon.name, 'Example');
assert.equal(addon.capabilities.join(','), 'stream,meta,catalog');
assert.equal(addon.types.join(','), 'movie');
assert.equal(addon.catalogCount, 1);
assert.ok(!JSON.stringify(addon).includes('private-configuration-token'));
assert.equal(filterAddons([addon], '  CINEMA  ', 'stream').length, 1);
assert.equal(filterAddons([addon], 'Metadata').length, 1);
assert.equal(filterAddons([addon], '', 'subtitles').length, 0);
assert.equal(filterAddons([addon], 'missing', 'stream').length, 0);
const empty = toAddonListItem({ manifest: { id: 'empty', name: ' ' } }, 1);
assert.equal(empty.name, 'Unnamed addon');
assert.equal(empty.capabilities.length, 0);
assert.equal(empty.types.length, 0);
console.log('PASS: addon capabilities, search/filter combinations, missing metadata, and private configuration handling');

async function managementTests() {
  const protectedAddon = {
    transportUrl: 'https://core.example/manifest.json', flags: { protected: true, official: true },
    manifest: { id: 'core' },
  };
  const configured = {
    transportUrl: 'https://example.com/personal-config/manifest.json?option=1',
    transportName: 'http', flags: {}, otherField: 'preserve me',
    manifest: { id: 'same-addon', behaviorHints: { configurable: true } },
  };
  const secondConfig = { ...configured, transportUrl: 'https://example.com/other-config/manifest.json' };
  let collection;
  let malformed = false;
  let failure = false;
  let writes = [];
  const server = { exports: {}, URL, AbortSignal, require: name => name === 'server-only' ? {} : require(name),
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.authKey, 'account-token');
      assert.equal(options.cache, 'no-store');
      if (url.endsWith('/addonCollectionGet')) {
        assert.equal(body.type, 'AddonCollectionGet');
        return { ok: true, json: async () => malformed ? { result: {} } : { result: { addons: collection } } };
      }
      assert.ok(url.endsWith('/addonCollectionSet'));
      assert.equal(body.type, 'AddonCollectionSet');
      writes.push(body.addons);
      if (failure) return { ok: true, json: async () => ({ error: { message: 'failure' } }) };
      collection = body.addons;
      return { ok: true, json: async () => ({ result: { success: true } }) };
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/addon-management.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, server);
  const { addonKey, addonLinks, removeInstalledAddon, addInstalledAddon } = server.exports;
  assert.equal(addonLinks(configured).configureUrl, 'https://example.com/personal-config/configure?option=1');
  assert.equal(addonLinks(protectedAddon).configureUrl, null);
  assert.equal(addonLinks({ ...configured, transportUrl: 'stremio://example.com/manifest.json' }).shareUrl,
    'https://example.com/manifest.json');
  assert.throws(() => addonLinks({ ...configured, transportUrl: 'javascript:alert(1)' }));
  assert.throws(() => addonLinks({ ...configured, transportUrl: 'https://user:pass@example.com/manifest.json' }));
  assert.equal(addonKey(configured.transportUrl).length, 64);
  collection = [protectedAddon, configured, secondConfig];
  await removeInstalledAddon('account-token', addonKey(configured.transportUrl));
  assert.equal(collection.length, 2);
  assert.equal(collection[1].transportUrl, secondConfig.transportUrl, 'Other configurations of the same addon survive');
  assert.equal(collection[1].otherField, 'preserve me', 'Descriptors and unknown fields survive unchanged');
  writes = [];
  await assert.rejects(removeInstalledAddon('account-token', addonKey(protectedAddon.transportUrl)), /protected/);
  await assert.rejects(removeInstalledAddon('account-token', addonKey('not-installed')), /no longer installed/);
  malformed = true;
  await assert.rejects(removeInstalledAddon('account-token', addonKey(secondConfig.transportUrl)), /Couldn’t load your add-ons/);
  assert.equal(writes.length, 0, 'Invalid reads and protected/missing addons never write the collection');
  malformed = false;
  failure = true;
  await assert.rejects(removeInstalledAddon('account-token', addonKey(secondConfig.transportUrl)), /couldn’t update your add-ons/);
  assert.equal(collection.length, 2, 'API errors preserve the installed collection');
  failure = false;
  collection = [protectedAddon, configured, secondConfig];
  await Promise.all([
    removeInstalledAddon('account-token', addonKey(configured.transportUrl)),
    removeInstalledAddon('account-token', addonKey(secondConfig.transportUrl)),
  ]);
  assert.equal(collection.length, 1, 'Concurrent removals read fresh and never restore a removed addon');
  assert.equal(collection[0].transportUrl, protectedAddon.transportUrl);
  await addInstalledAddon('account-token', configured);
  assert.equal(collection.length, 2);
  assert.equal(collection[0].flags.protected, true, 'Installing preserves protected addons');
  const beforeDuplicate = writes.length;
  await assert.rejects(addInstalledAddon('account-token', configured), /already installed/);
  assert.equal(writes.length, beforeDuplicate, 'Duplicate installs never replace the collection');
  failure = true;
  await assert.rejects(addInstalledAddon('account-token', secondConfig), /couldn’t update your add-ons/);
  assert.equal(collection.length, 2, 'Failed installs preserve the collection');
  failure = false;
  await Promise.all([
    addInstalledAddon('account-token', secondConfig),
    removeInstalledAddon('account-token', addonKey(configured.transportUrl)),
  ]);
  assert.equal(collection.length, 2, 'Concurrent install and uninstall preserve both changes');
  assert.equal(collection[1].transportUrl, secondConfig.transportUrl);
  console.log('PASS: configuration/share links, protected addons, exact configuration removal, API failures, and concurrent writes');
}
managementTests().catch(error => { console.error(error); process.exitCode = 1; });
