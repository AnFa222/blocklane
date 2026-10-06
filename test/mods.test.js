const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../src/core');
const mods = require('../src/mods');

const profile = { id: 'profile-one', name: 'Fabric world', version: '1.21.1', loader: 'fabric' };
const ids = { root: 'ABCDEFGH', dependency: 'DEPND123', rootVersion: 'VERROOT1', dependencyVersion: 'VERDEP01' };
const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');
function version(projectId, id, number, dependencies = []) {
  const bytes = `jar-${id}`;
  return { project_id: projectId, id, version_number: number, version_type: 'release', loaders: ['fabric'], game_versions: ['1.21.1'], dependencies,
    files: [{ primary: true, filename: `${projectId}-${number}.jar`, size: bytes.length, hashes: { sha1: sha1(bytes) }, url: `https://cdn.modrinth.com/data/${projectId}/versions/${id}/file.jar` }] };
}
function fakeIo(root, options = {}) {
  const versions = {
    [ids.root]: version(ids.root, ids.rootVersion, '1.0.0', [{ dependency_type: 'required', project_id: ids.dependency }]),
    [ids.dependency]: version(ids.dependency, ids.dependencyVersion, '2.0.0')
  };
  return { ...core,
    remoteJson: async url => {
      const parsed = new URL(url);
      if (parsed.pathname === '/v2/search') return { total_hits: 1, hits: [{ project_id: ids.root, slug: 'root', title: 'Root Mod', description: 'Works here', author: 'Author', downloads: 1234 }] };
      const matchVersions = parsed.pathname.match(/^\/v2\/project\/([A-Za-z0-9]{8})\/version$/);
      if (matchVersions) return [versions[matchVersions[1]]].filter(Boolean);
      const matchProject = parsed.pathname.match(/^\/v2\/project\/([A-Za-z0-9]{8})$/);
      if (matchProject) return { title: matchProject[1] === ids.root ? 'Root Mod' : 'Required Library', slug: matchProject[1].toLowerCase() };
      const matchVersion = parsed.pathname.match(/^\/v2\/version\/([A-Za-z0-9]{8})$/);
      if (matchVersion) return Object.values(versions).find(item => item.id === matchVersion[1]);
      throw new Error('Unexpected API request: ' + url);
    },
    download: async (item, dest) => { if (options.failProject && dest.includes(options.failProject)) throw new Error('download failed'); await fs.mkdir(path.dirname(dest), { recursive: true }); const match = dest.match(/-(VER[A-Z0-9]+)-/); await fs.writeFile(dest, `jar-${match[1]}`); assert.equal(await core.hashFile(dest), item.sha1); }
  };
}
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-mods-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('search is constrained to mod type, profile loader and Minecraft version', async () => {
  let request;
  const io = { remoteJson: async url => { request = new URL(url); return { total_hits: 0, hits: [] }; } };
  await mods.search(profile, 'sodium', 0, io);
  const facets = JSON.parse(request.searchParams.get('facets'));
  assert.deepEqual(facets, [['project_type:mod'], ['categories:fabric'], ['versions:1.21.1']]);
  assert.equal(request.hostname, 'api.modrinth.com');
  await assert.rejects(mods.search({ ...profile, loader: 'vanilla' }, '', 0, io), /Fabric, Forge, or NeoForge/);
});

test('install verifies files, adds required dependencies, toggles, and removes orphan dependencies', async t => {
  const root = await temp(t), io = fakeIo(root);
  await mods.installProject(profile, ids.root, root, io);
  let value = await mods.list(profile, root, io);
  assert.equal(value.installed.length, 2);
  const dependency = value.installed.find(item => item.projectId === ids.dependency);
  assert.equal(dependency.dependencyOnly, true); assert.deepEqual(dependency.requiredBy, [ids.root]);
  await assert.rejects(mods.setEnabled(profile, root, ids.dependency, false, io), /required dependency/);
  await assert.rejects(mods.remove(profile, root, ids.dependency, io), /required dependency/);
  value = await mods.setEnabled(profile, root, ids.root, false, io);
  assert.equal(value.installed.find(item => item.projectId === ids.root).enabled, false);
  assert.ok((await fs.readdir(root)).some(name => name.endsWith('.jar.disabled')));
  value = await mods.remove(profile, root, ids.root, io);
  assert.equal(value.installed.length, 0);
  assert.equal((await fs.readdir(root)).filter(name => name.startsWith('blocklane-')).length, 0);
});

test('failed dependency installation rolls back the managed list and downloaded files', async t => {
  const root = await temp(t), io = fakeIo(root, { failProject: ids.dependency });
  await assert.rejects(mods.installProject(profile, ids.root, root, io), /download failed/);
  assert.deepEqual((await mods.list(profile, root, io)).installed, []);
  assert.equal((await fs.readdir(root)).filter(name => name.startsWith('blocklane-')).length, 0);
});

test('manual jars are listed separately and never claimed as managed', async t => {
  const root = await temp(t), io = fakeIo(root); await fs.writeFile(path.join(root, 'my-own-mod.jar'), 'mine');
  const value = await mods.list(profile, root, io);
  assert.equal(value.local[0].filename, 'my-own-mod.jar'); assert.equal(value.local[0].local, true);
});

test('filenames and IDs reject path traversal', () => {
  assert.throws(() => mods.safeFilename('../evil.jar'));
  assert.throws(() => mods.safeFilename('evil.exe'));
  assert.throws(() => mods.modId('../../bad'));
  assert.match(mods.managedFilename(ids.root, ids.rootVersion, 'A nice mod.jar'), /^blocklane-ABCDEFGH-VERROOT1-/);
});
