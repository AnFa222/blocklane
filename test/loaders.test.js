const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const core = require('../src/core');
const loaders = require('../src/loaders');

test('legacy profiles stay vanilla; loaders require a pinned valid version', () => {
  const p = { version: '1.21.1' };
  assert.equal(loaders.profileVersionId(p), '1.21.1');
  assert.deepEqual(loaders.loaderSettings(p), { loader: 'vanilla', loaderVersion: '' });
  assert.throws(() => loaders.loaderSettings({ loader: 'forge', loaderVersion: '../bad' }));
  assert.throws(() => loaders.loaderSettings({ loader: 'unknown' }));
  const a = { ...p, loader: 'fabric', loaderVersion: '0.16.10' };
  assert.notEqual(loaders.profileVersionId(a), loaders.profileVersionId({ ...a, loaderVersion: '0.16.11' }));
  assert.notEqual(loaders.profileVersionId(a), loaders.profileVersionId({ ...a, loader: 'forge' }));
});
test('library coordinates preserve classifiers and reject path injection', () => {
  assert.equal(loaders.mavenPath('net.fabricmc:sponge-mixin:0.17.4+mixin.0.8.7'), 'net/fabricmc/sponge-mixin/0.17.4+mixin.0.8.7/sponge-mixin-0.17.4+mixin.0.8.7.jar');
  assert.equal(loaders.mavenPath('g:a:1:client@zip'), 'g/a/1/a-1-client.zip');
  assert.throws(() => loaders.mavenPath('g:a:../../bad'));
});
test('loader inheritance retains vanilla assets, natives and arguments but overrides conflicting libraries', () => {
  const base = { id: '1.21.1', mainClass: 'Vanilla', javaVersion: { majorVersion: 21 }, assetIndex: { id: '17' }, libraries: [{ name: 'g:a:1' }, { name: 'g:a:1:natives-windows' }], arguments: { jvm: ['-cp', '${classpath}'], game: ['--demo'] } };
  const child = { id: 'fabric-1', inheritsFrom: '1.21.1', mainClass: 'KnotClient', libraries: [{ name: 'g:a:2' }], arguments: { jvm: ['-Dloader=true'], game: ['--loader'] } };
  const merged = loaders.mergeMetadata(base, child, 'test');
  assert.deepEqual(merged.libraries.map(l => l.name), ['g:a:2', 'g:a:1:natives-windows']);
  assert.deepEqual(merged.arguments.game, ['--demo', '--loader']);
  assert.deepEqual(merged.arguments.jvm, ['-cp', '${classpath}', '-Dloader=true']);
  assert.equal(merged.mainClass, 'KnotClient'); assert.equal(merged.baseVersion, '1.21.1');
  assert.equal(merged.javaVersion.majorVersion, 21); assert.equal(merged.assetIndex.id, '17');
  assert.throws(() => loaders.mergeMetadata(base, { ...child, inheritsFrom: '1.20.1' }, 'bad'), /match/);
});
test('catalogs filter Forge and NeoForge to matching Minecraft releases', async () => {
  const io = { remoteText: async () => '<versions><version>1.21.1-52.1.0</version><version>1.20.1-47.4.0</version><version>21.1.9</version><version>21.1.10</version><version>21.0.2</version><version>26.1.0.0-alpha.1+snapshot-1</version></versions>' };
  assert.deepEqual((await loaders.versions('forge', '1.21.1', io)).map(v => v.version), ['1.21.1-52.1.0']);
  assert.deepEqual((await loaders.versions('neoforge', '1.21.1', io)).map(v => v.version), ['21.1.10', '21.1.9']);
  assert.equal(loaders.compatibleNeo('21.0.2', '1.21'), true);
  assert.equal(loaders.compatibleNeo('26.1.0.0-alpha.1+snapshot-1', '26.1'), false);
});
test('unsupported Fabric game versions do not offer unrelated builds', async () => {
  let calls = 0;
  assert.deepEqual(await loaders.versions('fabric', '1.13', { remoteJson: async () => { calls++; return [{ version: '1.21.1' }]; } }), []);
  assert.equal(calls, 1);
});
test('Fabric libraries require official checksums and reject unrelated repositories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-loaders-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let downloaded;
  const io = { ...core, remoteText: async () => 'a'.repeat(40), download: async (item, dest) => { downloaded = { item, dest }; } };
  await loaders.normalizeLibraries({ libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.10', url: 'https://maven.fabricmc.net/' }] }, root, io, undefined, true);
  assert.equal(downloaded.item.sha1, 'a'.repeat(40)); assert.ok(downloaded.dest.startsWith(root));
  await assert.rejects(loaders.normalizeLibraries({ libraries: [{ name: 'g:a:1', url: 'https://evil.example/' }] }, root, io, undefined, true), /Untrusted/);
});

test('cancelled loader install leaves no completed marker and preserves existing worlds', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-loader-cancel-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = { id: 'world-one', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10' };
  const world = path.join(root, 'instances', profile.id, 'saves', 'world.dat');
  await fs.mkdir(path.dirname(world), { recursive: true }); await fs.writeFile(world, 'keep');
  const base = { id: profile.version, arguments: { jvm: [], game: [] }, libraries: [] };
  const controller = new AbortController();
  const io = { ...core,
    remoteJson: async url => url.endsWith('/game') ? [{ version: profile.version }] : url.endsWith('/profile/json') ? { inheritsFrom: profile.version, mainClass: 'KnotClient', arguments: { jvm: [], game: [] }, libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.10', url: 'https://maven.fabricmc.net/', sha1: 'a'.repeat(40) }] } : [{ loader: { version: profile.loaderVersion, stable: true } }],
    download: async () => { controller.abort(); controller.signal.throwIfAborted(); }
  };
  await assert.rejects(loaders.install(profile, root, base, 'java', io, controller.signal, () => {}));
  await assert.rejects(fs.access(path.join(root, 'versions', loaders.profileVersionId(profile), 'installed.json')));
  assert.equal(await fs.readFile(world, 'utf8'), 'keep');
});
