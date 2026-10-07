const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const network = require('../src/network');
const mods = require('../src/mods');
function fakeResponse(bytes, options = {}) { const stream = Readable.from([bytes]); stream.statusCode = options.status || 200; stream.headers = {}; return stream; }
const { Launcher, allowed, expandArgs, safePath, validateProfile, libraryPlan, legacyArguments, normalizeVersionMetadata, download, pool, extractNatives } = require('../src/core');
const windows = { name: 'windows', arch: 'x86_64', version: '10.0.22631' };
const digest = data => crypto.createHash('sha1').update(data).digest('hex');
const md5 = data => crypto.createHash('md5').update(data).digest('hex');
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }

test('ordered Mojang OS rules and feature flags', () => {
  assert.equal(allowed(undefined), true);
  assert.equal(allowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'windows' } }], {}, windows), false);
  assert.equal(allowed([{ action: 'allow', os: { name: 'osx' } }], {}, windows), false);
  assert.equal(allowed([{ action: 'allow', features: { is_demo_user: true } }], { is_demo_user: true }, windows), true);
  assert.equal(allowed([{ action: 'allow', features: { has_quick_plays_support: true } }], {}, windows), false);
  assert.equal(allowed([{ action: 'allow', os: { versionRange: { min: '10.0.17134' } } }], {}, windows), true);
  assert.equal(allowed([{ action: 'allow', os: { versionRange: { max: '10.0.17134' } } }], {}, windows), false);
});

test('arguments preserve paths with spaces as one argument and include demo only when enabled', () => {
  const args = ['-cp', '${classpath}', { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' }];
  assert.deepEqual(expandArgs(args, { classpath: 'C:\\My Games\\client.jar' }, { is_demo_user: true }), ['-cp', 'C:\\My Games\\client.jar', '--demo']);
  assert.equal(expandArgs(args, { classpath: 'a' }, {}).includes('--demo'), false);
  assert.throws(() => expandArgs(['${unknown}'], {}, {}), /Unsupported/);
});

test('legacy Minecraft arguments are normalized for Java 8 launch metadata', () => {
  assert.deepEqual(legacyArguments('--username ${auth_player_name} --gameDir "${game_directory}"'), ['--username', '${auth_player_name}', '--gameDir', '${game_directory}']);
  const metadata = normalizeVersionMetadata({ id: '1.12.2', minecraftArguments: '--username ${auth_player_name} --version "${version_name}"', downloads: { client: { url: 'https://piston-data.mojang.com/client' } }, libraries: [] });
  assert.equal(metadata.javaVersion.majorVersion, 8);
  assert.deepEqual(metadata.arguments.game, ['--username', '${auth_player_name}', '--version', '${version_name}']);
  assert.ok(metadata.arguments.jvm.includes('${classpath}'));
});

test('download paths reject traversal, Windows drive paths, and alternate separators', () => {
  for (const name of ['../escape', 'a/../../escape', 'C:/Windows/test', '..\\escape', '/outside']) assert.throws(() => safePath(path.resolve('sandbox'), name));
  assert.equal(safePath(path.resolve('sandbox'), 'lib/file.jar'), path.resolve('sandbox/lib/file.jar'));
});

test('profiles validate RAM, names and version identifiers', () => {
  const p = { name: ' Survival ', version: '1.21.1', memory: 4, javaPath: 'java' };
  assert.equal(validateProfile(p).name, 'Survival');
  assert.throws(() => validateProfile({ ...p, version: '../../x' }));
  assert.throws(() => validateProfile({ ...p, memory: 0 }));
  assert.throws(() => validateProfile({ ...p, memory: 4.5 }));
  assert.throws(() => validateProfile({ ...p, name: '' }));
});

test('library planning filters operating systems and resolves legacy native classifiers', () => {
  const meta = { libraries: [
    { downloads: { artifact: { path: 'common.jar' }, classifiers: { 'natives-windows-64': { path: 'native.jar' } } }, natives: { windows: 'natives-windows-${arch}' } },
    { rules: [{ action: 'allow', os: { name: 'osx' } }], downloads: { artifact: { path: 'mac.jar' } } }
  ] };
  const plan = libraryPlan(meta, path.resolve('game'), windows);
  assert.equal(plan.artifacts.length, 1); assert.equal(plan.natives.length, 1);
  assert.match(plan.natives[0].dest, /native.jar$/);
});

test('downloads skip verified files, repair corruption, and never promote bad bytes', async t => {
  const root = await temp(t), dest = path.join(root, 'asset');
  const bytes = Buffer.from('good payload'), item = { sha1: digest(bytes), size: bytes.length, url: 'https://libraries.minecraft.net/test' };
  let calls = 0; const progress = [];
  t.mock.method(network, 'open', async () => { calls++; return fakeResponse(bytes); });
  await download(item, dest, undefined, (done, total) => progress.push([done, total])); await download(item, dest); assert.equal(calls, 1);
  assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);
  await fs.writeFile(dest, 'broken'); await download(item, dest); assert.equal(calls, 2);
  await assert.rejects(download({ ...item, sha1: '0'.repeat(40) }, path.join(root, 'bad')), /integrity/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['asset']);
});

test('downloads accept LiteLoader MD5 checksums and reject mismatches', async t => {
  const root = await temp(t), bytes = Buffer.from('legacy loader'), destination = path.join(root, 'liteloader.jar');
  t.mock.method(network, 'open', async () => fakeResponse(bytes));
  await download({ md5: md5(bytes), size: bytes.length, url: 'https://dl.liteloader.com/versions/test.jar' }, destination);
  assert.deepEqual(await fs.readFile(destination), bytes);
  await assert.rejects(download({ md5: '0'.repeat(32), url: 'https://dl.liteloader.com/versions/bad.jar' }, path.join(root, 'bad.jar')), /integrity/);
});

test('download cancellation leaves no partial final file', async t => {
  const root = await temp(t), c = new AbortController(); c.abort();
  await assert.rejects(download({ sha1: '0'.repeat(40), url: 'https://libraries.minecraft.net/test' }, path.join(root, 'asset'), c.signal));
  assert.deepEqual(await fs.readdir(root), []);
});

test('worker pool waits for in-flight work before reporting failure', async () => {
  let active = 0;
  await assert.rejects(pool([1, 2, 3, 4], async n => { active++; try { await new Promise(r => setTimeout(r, n * 5)); if (n === 1) throw new Error('failed'); } finally { active--; } }, null, 2), /failed/);
  assert.equal(active, 0);
});

test('content downloads run concurrently and report independent item progress', async t => {
  const root = await temp(t), events = [], launcher = new Launcher(root, (event, value) => { if (event === 'content-progress') events.push(value); }); await launcher.init();
  let active = 0, maximum = 0;
  const run = projectId => launcher.runContentTask('resourcepack', 'profile', projectId, async (_signal, report) => {
    active++; maximum = Math.max(maximum, active); report(`Downloading ${projectId}`, 5, 10); await new Promise(resolve => setTimeout(resolve, 20)); active--; return projectId;
  });
  assert.deepEqual(await Promise.all([run('abcdefgh'), run('ijklmnop')]), ['abcdefgh', 'ijklmnop']);
  assert.equal(maximum, 2); assert.equal((await launcher.snapshot()).downloads, 0);
  assert.ok(events.some(event => event.key === 'resourcepack:profile:abcdefgh' && event.doneBytes === 5 && event.totalBytes === 10));
  assert.ok(events.some(event => event.key === 'resourcepack:profile:ijklmnop' && event.status === 'complete'));
});

function zipEntry(name, content, mode = 0x81a4) {
  const filename = Buffer.from(name), data = Buffer.from(content), crc = zlib.crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode * 65536) >>> 0, 38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}

test('native extraction reads files and rejects symlinks', async t => {
  const root = await temp(t), zip = path.join(root, 'test.jar');
  await fs.writeFile(zip, zipEntry('native.dll', 'native bytes'));
  await extractNatives(zip, path.join(root, 'native'), []);
  assert.equal(await fs.readFile(path.join(root, 'native/native.dll'), 'utf8'), 'native bytes');
  await fs.writeFile(zip, zipEntry('link', '../outside', 0xa1ff));
  await assert.rejects(extractNatives(zip, path.join(root, 'native'), []), /non-regular/);
});

test('local skins are prepared in the instance and install loader support', async t => {
  const root = await temp(t), launcher = new Launcher(root), bytes = Buffer.alloc(24), calls = [];
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
  const identity = { local: true, uuid: 'a'.repeat(32), name: 'OfflinePlayer' }, profile = { id: 'profile', version: '1.21.1', loader: 'fabric' }, gameDir = path.join(root, 'instances', 'profile');
  await fs.mkdir(path.join(root, 'skins'), { recursive: true }); await fs.writeFile(path.join(root, 'skins', `${identity.uuid}.png`), bytes);
  t.mock.method(mods, 'list', async () => ({ installed: [], local: [] }));
  t.mock.method(mods, 'installProject', async (p, projectId) => calls.push({ p, projectId }));
  const result = await launcher.prepareLocalSkin(profile, identity, gameDir, new AbortController().signal);
  assert.deepEqual(result, { active: true, supported: true }); assert.equal(calls[0].projectId, 'idMHQ4n2');
  assert.deepEqual(await fs.readFile(path.join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', 'OfflinePlayer.png')), bytes);
  const vanilla = await launcher.prepareLocalSkin({ ...profile, loader: 'vanilla' }, identity, path.join(root, 'vanilla'), new AbortController().signal);
  assert.deepEqual(vanilla, { active: true, supported: false }); assert.equal(calls.length, 1);
});

test('missing local skin support does not prevent the game from launching', async t => {
  const root = await temp(t), messages = [], launcher = new Launcher(root, (event, message) => { if (event === 'log') messages.push(message); }), bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
  const identity = { local: true, uuid: 'b'.repeat(32), name: 'SnapshotPlayer' }, profile = { id: 'snapshot', version: '26.3', loader: 'fabric' };
  await fs.mkdir(path.join(root, 'skins'), { recursive: true }); await fs.writeFile(path.join(root, 'skins', `${identity.uuid}.png`), bytes);
  t.mock.method(mods, 'list', async () => ({ installed: [], local: [] })); t.mock.method(mods, 'installProject', async () => { throw new Error('No compatible fabric version exists for Minecraft 26.3.'); });
  assert.deepEqual(await launcher.prepareLocalSkin(profile, identity, path.join(root, 'instances', 'snapshot'), new AbortController().signal), { active: true, supported: false });
  assert.match(messages[0], /unavailable.*26\.3.*No compatible/i);
});

function fixture() {
  const data = new Map(), id = '1.21.1';
  function asset(url, value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'object' ? JSON.stringify(value) : value); data.set(url, bytes); return { url, sha1: digest(bytes), size: bytes.length }; }
  const sound = asset('https://libraries.minecraft.net/sound', 'sound');
  data.set(`https://resources.download.minecraft.net/${sound.sha1.slice(0, 2)}/${sound.sha1}`, Buffer.from('sound'));
  const index = asset('https://piston-meta.mojang.com/index', { objects: { 'sound.ogg': { hash: sound.sha1, size: sound.size } } });
  const meta = { id, type: 'release', javaVersion: { majorVersion: 21 }, arguments: { game: [], jvm: [] }, mainClass: 'Main', downloads: { client: asset('https://piston-data.mojang.com/client', 'client jar') }, assetIndex: { ...index, id: '17' }, libraries: [{ downloads: { artifact: { ...asset('https://libraries.minecraft.net/lib', 'library'), path: 'example/lib.jar' } } }] };
  const entry = { ...asset('https://piston-meta.mojang.com/version', meta), id, type: 'release', releaseTime: '2024-08-08T00:00:00Z' };
  const manifest = { latest: { release: id, snapshot: id }, versions: [entry] };
  asset('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', manifest);
  return { data, id };
}

test('end-to-end install, cached catalog, profile persistence, repair, and removal keep worlds', async t => {
  const root = await temp(t), fixtureData = fixture();
  let offline = false;
  t.mock.method(network, 'open', async url => { if (offline) throw new Error('offline'); const data = fixtureData.data.get(String(url)); if (!data) throw new Error('Unexpected download ' + url); return fakeResponse(data); });
  const launcher = new Launcher(root); launcher.ensureJava = async () => 'managed-java'; await launcher.init();
  const catalog = await launcher.catalog(); assert.equal(catalog.cached, false);
  let snapshot = await launcher.install(fixtureData.id); assert.equal(snapshot.installed.length, 1); assert.equal(snapshot.busy, false);
  snapshot = await launcher.saveProfile({ name: 'World one', version: fixtureData.id, memory: 4, javaPath: 'java' });
  const profile = snapshot.profiles[0];
  const world = path.join(root, 'instances', profile.id, 'saves', 'world.dat'); await fs.mkdir(path.dirname(world), { recursive: true }); await fs.writeFile(world, 'keep');
  const reloaded = new Launcher(root); await reloaded.init(); assert.equal(reloaded.state.selectedProfile, profile.id);
  const client = path.join(root, 'versions', fixtureData.id, fixtureData.id + '.jar'); await fs.writeFile(client, 'corrupt'); await launcher.install(fixtureData.id); assert.equal(await fs.readFile(client, 'utf8'), 'client jar');
  offline = true; assert.equal((await launcher.catalog(true)).cached, true);
  await launcher.removeVersion(fixtureData.id); await launcher.deleteProfile(profile.id);
  assert.equal(await fs.readFile(world, 'utf8'), 'keep'); assert.equal((await launcher.snapshot()).installed.length, 0);
});

test('a failed install has no completed marker and can be retried', async t => {
  const root = await temp(t), fixtureData = fixture(); let fail = true;
  t.mock.method(network, 'open', async url => {
    if (String(url).includes('/client') && fail) return fakeResponse('unavailable', { status: 503 });
    return fakeResponse(fixtureData.data.get(String(url)));
  });
  const launcher = new Launcher(root); launcher.ensureJava = async () => 'managed-java'; await launcher.init();
  await assert.rejects(launcher.install(fixtureData.id), /503/);
  assert.equal(launcher.busy, false); assert.equal((await launcher.snapshot()).installed.length, 0);
  fail = false; assert.equal((await launcher.install(fixtureData.id)).installed.length, 1);
});
