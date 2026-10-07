const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const worlds = require('../src/worlds');

async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-worlds-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function world(folder, name, value = 'world') { const target = path.join(folder, name); await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'level.dat'), value); await fs.writeFile(path.join(target, 'region.mca'), value.repeat(20)); return target; }

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

test('world names and ZIP paths reject traversal', () => {
  assert.throws(() => worlds.worldName('../world'), /Invalid/); assert.throws(() => worlds.safeZipPath('../outside/level.dat'), /unsafe/); assert.throws(() => worlds.safeZipPath('C:/outside/level.dat'), /unsafe/);
});
