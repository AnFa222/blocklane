const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const core = require('../src/core');
const network = require('../src/network');
const { ensureRuntime, runtimeSpec, managedJava, CATALOG } = require('../src/runtime');
const meta = { javaVersion: { majorVersion: 21, component: 'java-runtime-delta' } };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-java-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = new Map(); let calls = 0;
  const asset = (url, value) => { const b = Buffer.from(typeof value === 'object' ? JSON.stringify(value) : value); data.set(url, b); return { url, size: b.length, sha1: crypto.createHash('sha1').update(b).digest('hex') }; };
  const manifest = { files: { bin: { type: 'directory' }, 'bin/java.exe': { type: 'file', downloads: { raw: asset('https://piston-data.mojang.com/java', 'java executable') } }, 'legal/LICENSE': { type: 'file', downloads: { raw: asset('https://piston-data.mojang.com/license', 'license text') } } } };
  const descriptor = asset('https://piston-meta.mojang.com/runtime', manifest);
  asset(CATALOG, { 'windows-x64': { 'java-runtime-delta': [{ availability: { progress: 100 }, manifest: descriptor, version: { name: '21.0.7' } }] } });
  t.mock.method(network, 'open', async url => { calls++; assert.ok(data.has(url)); const r = Readable.from([data.get(url)]); r.statusCode = 200; r.headers = {}; return r; });
  const io = { ...core, inspectJava: async exe => { await fs.access(exe); return { major: 21, arch: 'amd64' }; } };
  return { root, io, calls: () => calls };
}
test('runtime selection follows metadata and migrates default Java profiles', () => {
  assert.deepEqual(runtimeSpec({}), { major: 8, component: 'jre-legacy' });
  assert.equal(runtimeSpec(meta).component, 'java-runtime-delta');
  assert.throws(() => runtimeSpec({ javaVersion: { majorVersion: 25, component: '../bad' } }));
  assert.equal(managedJava('java'), true); assert.equal(managedJava('auto'), true);
  assert.equal(managedJava('C:\\Java\\bin\\java.exe'), false);
});
test('Java installs with license files, reuses an offline bundle, and repairs corruption', async t => {
  const f = await fixture(t); const bundle = path.join(f.root, 'bundle'), managed = path.join(f.root, 'managed');
  const exe = await ensureRuntime(meta, bundle, null, f.io);
  assert.match(exe, /java.exe$/);
  assert.equal(await fs.readFile(path.join(bundle, 'java-runtime-delta/legal/LICENSE'), 'utf8'), 'license text');
  const count = f.calls();
  assert.equal(await ensureRuntime(meta, managed, bundle, f.io), exe);
  assert.equal(f.calls(), count);
  await fs.writeFile(exe, 'broken');
  const repaired = await ensureRuntime(meta, managed, bundle, f.io);
  assert.ok(repaired.startsWith(managed));
  assert.equal(await fs.readFile(repaired, 'utf8'), 'java executable');
  assert.equal(await fs.readFile(exe, 'utf8'), 'broken'); // installed bundle is never modified
});
test('wrong Java version is not marked complete', async t => {
  const f = await fixture(t); f.io.inspectJava = async () => ({ major: 26, arch: 'amd64' });
  await assert.rejects(ensureRuntime(meta, f.root, null, f.io), /did not report/);
  await assert.rejects(fs.access(path.join(f.root, 'java-runtime-delta/installed.json')));
});
test('cancelled runtime installation does not start downloads', async t => {
  const f = await fixture(t); const c = new AbortController(); c.abort();
  await assert.rejects(ensureRuntime(meta, f.root, null, f.io, c.signal));
  assert.equal(f.calls(), 0);
});
