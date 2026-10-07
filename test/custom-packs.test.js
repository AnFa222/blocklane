const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const packs = require('../src/custom-packs');

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
