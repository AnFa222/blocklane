const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const worlds = require('../src/worlds');

async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-worlds-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function world(folder, name, value = 'world') { const target = path.join(folder, name); await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'level.dat'), value); await fs.writeFile(path.join(target, 'region.mca'), value.repeat(20)); return target; }
function string(value) { const bytes = Buffer.from(value); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]); }
function named(type, name, payload) { return Buffer.concat([Buffer.from([type]), string(name), payload]); }
function levelDat({ name = 'Test World', version = '1.21.1', dataVersion = 3955, lastPlayed = 1720000000000 } = {}) {
  const number = Buffer.alloc(4); number.writeInt32BE(dataVersion); const played = Buffer.alloc(8); played.writeBigInt64BE(BigInt(lastPlayed));
  const versionTag = named(10, 'Version', Buffer.concat([named(8, 'Name', string(version)), Buffer.from([0])]));
  const data = Buffer.concat([named(8, 'LevelName', string(name)), named(3, 'DataVersion', number), named(4, 'LastPlayed', played), versionTag, Buffer.from([0])]);
  return gzipSync(Buffer.concat([Buffer.from([10]), string(''), named(10, 'Data', data), Buffer.from([0])]));
}

test('world folders import with collision-safe names and list metadata', async t => {
  const root = await temp(t), source = path.join(root, 'source'), destination = path.join(root, 'saves'); await world(source, 'Survival'); await world(destination, 'Survival', 'old');
  assert.deepEqual(await worlds.copyFolders([source], destination), ['Survival (2)']);
  const listed = await worlds.list(destination); assert.deepEqual(listed.map(item => item.name).sort(), ['Survival', 'Survival (2)']); assert.ok(listed.every(item => item.size > 0 && item.modifiedAt));
});

test('worlds copy or move between profiles without overwriting', async t => {
  const root = await temp(t), first = path.join(root, 'one'), second = path.join(root, 'two'); await world(first, 'Creative'); await world(second, 'Creative', 'existing');
  assert.deepEqual(await worlds.transfer(first, second, ['Creative'], false), ['Creative (2)']); assert.equal(await fs.readFile(path.join(first, 'Creative', 'level.dat'), 'utf8'), 'world');
  assert.deepEqual(await worlds.transfer(first, second, ['Creative'], true), ['Creative (3)']); await assert.rejects(fs.access(path.join(first, 'Creative')));
});

test('world deletion accepts only existing valid worlds', async t => {
  const root = await temp(t), saves = path.join(root, 'saves'); await world(saves, 'Delete me'); await fs.mkdir(path.join(saves, 'not-a-world'));
  assert.deepEqual(await worlds.remove(saves, ['Delete me']), ['Delete me']); await assert.rejects(fs.access(path.join(saves, 'Delete me'))); await assert.rejects(worlds.remove(saves, ['not-a-world']), /not found/);
});

test('world names and ZIP paths reject traversal', () => {
  assert.throws(() => worlds.worldName('../world'), /Invalid/); assert.throws(() => worlds.safeZipPath('../outside/level.dat'), /unsafe/); assert.throws(() => worlds.safeZipPath('C:/outside/level.dat'), /unsafe/);
});

test('world list reads Minecraft metadata, icons, and region health', async t => {
  const root = await temp(t), folder = path.join(root, 'saves', 'Folder name'); await fs.mkdir(path.join(folder, 'region'), { recursive: true });
  await fs.writeFile(path.join(folder, 'level.dat'), levelDat()); await fs.writeFile(path.join(folder, 'region', 'r.0.0.mca'), 'region');
  await fs.writeFile(path.join(folder, 'icon.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const [listed] = await worlds.list(path.join(root, 'saves'));
  assert.equal(listed.displayName, 'Test World'); assert.equal(listed.gameVersion, '1.21.1'); assert.equal(listed.dataVersion, 3955); assert.equal(listed.health, 'healthy'); assert.match(listed.iconUrl, /^data:image\/png;base64,/); assert.match(listed.healthMessage, /1 region file/);
});

test('world health reports a readable level.dat_old as recoverable', async t => {
  const root = await temp(t), folder = await world(path.join(root, 'saves'), 'Recoverable', 'broken'); await fs.writeFile(path.join(folder, 'level.dat_old'), levelDat({ name: 'Recovered' }));
  const [listed] = await worlds.list(path.join(root, 'saves')); assert.equal(listed.displayName, 'Recovered'); assert.equal(listed.health, 'recoverable');
});
