const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const packs = require('../src/custom-packs');
const { Launcher } = require('../src/core');

async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-packs-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('custom packs persist separately from playable profiles', async t => {
  const root = await temp(t), created = await packs.save(root, { name: 'Builder Pack', versionId: '1.0.0', summary: 'Building tools', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10' });
  assert.match(created.id, /^[0-9a-f-]{36}$/); assert.equal((await packs.list(root))[0].name, 'Builder Pack'); await fs.access(path.join(root, 'custom-packs', created.id, 'instance'));
  await packs.remove(root, created.id); assert.deepEqual(await packs.list(root), []);
});

test('custom pack wizard data rejects unsupported loaders and empty fields', () => {
  assert.throws(() => packs.validate({ name: 'Pack', versionId: '1', summary: 'x', version: '1.21.1', loader: 'liteloader' }), /supported/);
  assert.throws(() => packs.validate({ name: '', versionId: '1', summary: 'x', version: '1.21.1', loader: 'vanilla' }), /Pack name/);
});

test('custom packs create refreshable play profiles without replacing worlds', async t => {
  const root = await temp(t), pack = await packs.save(root, { name: 'Playable Pack', versionId: '1.0.0', summary: 'Play me', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10' });
  const sourceMods = path.join(root, 'custom-packs', pack.id, 'instance', 'mods'); await fs.mkdir(sourceMods, { recursive: true }); await fs.writeFile(path.join(sourceMods, 'first.jar'), 'first');
  const launcher = new Launcher(root); await launcher.init(); const first = await launcher.customPackPrepareProfile(pack.id), profile = launcher.profile(first.profileId), instance = path.join(root, 'instances', profile.id);
  assert.equal(profile.customPackId, pack.id); await fs.access(path.join(instance, 'mods', 'first.jar'));
  await fs.mkdir(path.join(instance, 'saves', 'My World'), { recursive: true }); await fs.writeFile(path.join(instance, 'saves', 'My World', 'level.dat'), 'world');
  await fs.rm(path.join(sourceMods, 'first.jar')); await fs.writeFile(path.join(sourceMods, 'second.jar'), 'second'); const second = await launcher.customPackPrepareProfile(pack.id);
  assert.equal(second.profileId, first.profileId); assert.equal(launcher.state.profiles.length, 1); await assert.rejects(fs.access(path.join(instance, 'mods', 'first.jar')), /ENOENT/); await fs.access(path.join(instance, 'mods', 'second.jar')); await fs.access(path.join(instance, 'saves', 'My World', 'level.dat'));
});
