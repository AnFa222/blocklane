const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const modpacks = require('../src/modpacks');

async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-pack-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
function index(overrides = {}) { return { formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: 'Test Pack', summary: '', files: [{ path: 'mods/example.jar', hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) }, env: { client: 'required', server: 'required' }, downloads: ['https://cdn.modrinth.com/data/test.jar'], fileSize: 4 }], dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.10' }, ...overrides }; }
async function zipFile(file, entries) { const zip = new yazl.ZipFile(); for (const [name, value] of Object.entries(entries)) zip.addBuffer(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), name); zip.end(); await pipeline(zip.outputStream, createWriteStream(file)); }

test('mrpack indexes produce pinned profiles and reject unsafe or conflicting loaders', () => {
  assert.deepEqual(modpacks.profileSpec(modpacks.validateIndex(index())), { name: 'Test Pack', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10', memory: 4, javaPath: 'auto', javaArgs: [], gameArgs: [] });
  assert.throws(() => modpacks.safePackPath('../outside.jar'), /unsafe/);
  assert.throws(() => modpacks.validateIndex(index({ files: [{ path: '../bad', hashes: { sha1: 'a'.repeat(40) }, downloads: ['https://cdn.modrinth.com/x'], fileSize: 1 }] })), /unsafe/);
  assert.throws(() => modpacks.profileSpec(index({ dependencies: { minecraft: '1.21.1', forge: '1', 'fabric-loader': '2' } })), /more than one/);
});

test('modpack updates replace managed files while preserving worlds and settings', async t => {
  const root = await temp(t), instance = path.join(root, 'instance'), staging = path.join(root, 'staging');
  await fs.mkdir(path.join(instance, 'mods'), { recursive: true }); await fs.mkdir(path.join(instance, 'saves', 'World'), { recursive: true }); await fs.mkdir(path.join(staging, 'mods'), { recursive: true });
  await fs.writeFile(path.join(instance, 'mods', 'old.jar'), 'old'); await fs.writeFile(path.join(instance, 'options.txt'), 'personal settings'); await fs.writeFile(path.join(instance, 'saves', 'World', 'level.dat'), 'world');
  await fs.writeFile(path.join(staging, 'mods', 'new.jar'), 'new'); await fs.writeFile(path.join(staging, 'options.txt'), 'pack defaults');
  await modpacks.applyStaging(instance, staging, ['mods/old.jar', 'options.txt'], ['mods/new.jar', 'options.txt'], true);
  await assert.rejects(fs.access(path.join(instance, 'mods', 'old.jar')));
  assert.equal(await fs.readFile(path.join(instance, 'mods', 'new.jar'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(instance, 'options.txt'), 'utf8'), 'personal settings');
  assert.equal(await fs.readFile(path.join(instance, 'saves', 'World', 'level.dat'), 'utf8'), 'world');
});

test('client-unsupported pack files are omitted and trusted URLs are required', async () => {
  const value = index(); value.files[0].env.client = 'unsupported'; assert.equal(modpacks.validateIndex(value).files.length, 1);
  assert.equal(modpacks.protectedPath('saves/My World/level.dat'), true); assert.equal(modpacks.protectedPath('mods/example.jar'), false);
});

test('Prism and MultiMC instance ZIPs provide a pinned profile and embedded files', async t => {
  const root = await temp(t), archive = path.join(root, 'Prism.zip'), staging = path.join(root, 'staging');
  await zipFile(archive, {
    'Example/mmc-pack.json': { formatVersion: 1, components: [{ uid: 'net.minecraft', version: '1.21.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.10' }] },
    'Example/.minecraft/mods/example.jar': 'jar', 'Example/.minecraft/config/example.json': '{}'
  });
  const descriptor = await modpacks.inspectZip(archive), result = await modpacks.extractPortableArchive(archive, staging, descriptor);
  assert.equal(descriptor.format, 'prism');
  assert.deepEqual(modpacks.profileSpec(result.index), { name: 'Prism', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10', memory: 4, javaPath: 'auto', javaArgs: [], gameArgs: [] });
  assert.deepEqual(result.managed.sort(), ['config/example.json', 'mods/example.jar']);
  assert.equal(await fs.readFile(path.join(staging, 'mods', 'example.jar'), 'utf8'), 'jar');
});

test('CurseForge manifests import included overrides and reject unresolved project IDs', () => {
  const manifest = { manifestType: 'minecraftModpack', manifestVersion: 1, name: 'Curse Pack', version: '2.0', minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] }, files: [] };
  assert.deepEqual(modpacks.profileSpec(modpacks.curseForgeIndex(manifest)), { name: 'Curse Pack', version: '1.20.1', loader: 'forge', loaderVersion: '47.2.0', memory: 4, javaPath: 'auto', javaArgs: [], gameArgs: [] });
  assert.throws(() => modpacks.curseForgeIndex({ ...manifest, files: [{ projectID: 1, fileID: 2 }] }), /not included/);
});
