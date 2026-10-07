const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const resourcepacks = require('../src/resourcepacks');

const profile = { id: 'fabric121', name: 'Fabric', version: '1.21.1', loader: 'fabric' };
function io() {
  return {
    readJson: async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } },
    atomicJson: async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)); }
  };
}

test('resource pack filenames stay readable and disambiguate collisions', () => {
  assert.equal(resourcepacks.titleFilename('Default HD: 128x', 'download.zip'), 'Default HD- 128x.zip');
  assert.equal(resourcepacks.readableFilename('Default HD 128x.zip', 'abcdefgh'), 'Default HD 128x.zip');
  assert.equal(resourcepacks.readableFilename('Default HD 128x.zip', 'abcdefgh', new Set(['default hd 128x.zip'])), 'Default HD 128x (abcdefgh).zip');
});

test('legacy managed resource packs are renamed before listing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-resourcepacks-')), dir = path.join(root, 'resourcepacks');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldName = 'blocklane-abcdefgh-12345678-Default_HD_128x.zip';
  await fs.mkdir(path.join(dir, '.blocklane'), { recursive: true });
  await fs.writeFile(path.join(dir, oldName), 'pack');
  await fs.writeFile(path.join(dir, '..', 'options.txt'), `resourcePacks:["vanilla","file/${oldName}"]\n`);
  await fs.writeFile(path.join(dir, '.blocklane', 'managed.json'), JSON.stringify({ schema: 1, packs: [{ projectId: 'abcdefgh', versionId: '12345678', title: 'Default HD', filename: oldName, enabled: true }] }));
  const result = await resourcepacks.list(profile, dir, io());
  assert.equal(result.installed[0].filename, 'Default HD.zip');
  assert.equal(await fs.readFile(path.join(dir, 'Default HD.zip'), 'utf8'), 'pack');
  assert.match(await fs.readFile(path.join(dir, '..', 'options.txt'), 'utf8'), /file\/Default HD\.zip/);
});
