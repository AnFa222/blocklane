const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const yauzl = require('yauzl');
const exporter = require('../src/modpack-export');

async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-export-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function entries(file) { const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true }), result = new Map(); try { for await (const entry of zip.eachEntry()) { const chunks = []; if (!entry.fileName.endsWith('/')) for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk); result.set(entry.fileName, Buffer.concat(chunks)); } } finally { zip.close(); } return result; }

test('custom modpack export creates a standard mrpack and excludes personal data', async t => {
  const root = await temp(t), instance = path.join(root, 'instance'), output = path.join(root, 'Pack.mrpack');
  await fs.mkdir(path.join(instance, 'mods'), { recursive: true }); await fs.mkdir(path.join(instance, 'config'), { recursive: true }); await fs.mkdir(path.join(instance, 'saves', 'Secret World'), { recursive: true });
  await fs.writeFile(path.join(instance, 'mods', 'example.jar'), 'jar'); await fs.writeFile(path.join(instance, 'config', 'example.toml'), 'config'); await fs.writeFile(path.join(instance, 'options.txt'), 'personal'); await fs.writeFile(path.join(instance, 'saves', 'Secret World', 'level.dat'), 'world');
  const result = await exporter.exportPack({ version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10' }, instance, output, { name: 'My Pack', versionId: '1.0.0', summary: 'Test pack' }); assert.equal(result.files, 2);
  const zip = await entries(output), index = JSON.parse(zip.get('modrinth.index.json')); assert.deepEqual(index.dependencies, { minecraft: '1.21.1', 'fabric-loader': '0.16.10' }); assert.equal(index.files.length, 0);
  assert.equal(zip.get('overrides/mods/example.jar').toString(), 'jar'); assert.equal(zip.get('overrides/config/example.toml').toString(), 'config'); assert.equal(zip.has('overrides/options.txt'), false); assert.equal([...zip.keys()].some(name => name.includes('saves/')), false);
});

test('export metadata and unsupported loaders are rejected', () => {
  assert.throws(() => exporter.metadata({ name: '', versionId: '1', summary: 'x' }), /Pack name/); assert.throws(() => exporter.dependencies({ version: '1.12.2', loader: 'liteloader', loaderVersion: '1.12.2' }), /LiteLoader/);
});
