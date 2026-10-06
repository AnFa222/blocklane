const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const shaders = require('../src/shaders');

const profile = { id: 'fabric121', name: 'Fabric', version: '1.21.1', loader: 'fabric' };
const iris = { installed: [{ slug: 'iris', title: 'Iris Shaders', filename: 'iris.jar' }], local: [] };

test('shader packs require an installed compatible renderer', () => {
  assert.deepEqual(shaders.adapter(profile, iris), { id: 'iris', label: 'Iris', category: 'iris' });
  assert.deepEqual(shaders.adapter({ ...profile, loader: 'forge' }, { installed: [{ slug: 'oculus', title: 'Oculus', filename: 'oculus.jar' }], local: [] }), { id: 'oculus', label: 'Oculus' });
  assert.equal(shaders.adapter(profile, { installed: [], local: [] }), null);
  assert.deepEqual(shaders.adapter({ ...profile, loader: 'forge' }, { installed: [{ slug: 'optifine', title: 'OptiFine', filename: 'OptiFine.jar' }], local: [] }), { id: 'optifine', label: 'OptiFine', category: 'optifine' });
});

test('shader discovery is restricted to Iris packs and the selected Minecraft version', async () => {
  let request;
  const result = await shaders.search(profile, { id: 'iris', label: 'Iris' }, '', 0, { remoteJson: async url => { request = new URL(url); return { total_hits: 1, hits: [{ project_id: 'abcdefgh', slug: 'complementary', title: 'Complementary', description: '', author: 'artist', downloads: 1 }] }; } });
  assert.equal(result.hits[0].slug, 'complementary');
  const facets = request.searchParams.get('facets');
  assert.match(facets, /project_type:shader/); assert.match(facets, /categories:iris/); assert.match(facets, /versions:1\.21\.1/);
});

test('shader installation accepts only checksum-verified Iris ZIP files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-shader-'));
  const io = { readJson: async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }, atomicJson: async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)); }, remoteJson: async url => url.includes('/version') ? [{ id: '12345678', project_id: 'abcdefgh', version_number: '1', version_type: 'release', game_versions: ['1.21.1'], loaders: ['iris'], files: [{ filename: 'pack.zip', primary: true, url: 'https://cdn.modrinth.com/pack.zip', size: 1, hashes: { sha1: 'a'.repeat(40) } }] }] : { title: 'Pack', slug: 'pack', project_type: 'shader' }, download: async (_, destination) => { await fs.writeFile(destination, 'x'); } };
  const result = await shaders.install(profile, { id: 'iris', label: 'Iris' }, 'abcdefgh', dir, io);
  assert.equal(result.installed[0].title, 'Pack');
  assert.match(result.installed[0].filename, /\.zip$/);
  await fs.rm(dir, { recursive: true, force: true });
});
