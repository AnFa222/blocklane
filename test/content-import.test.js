const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const os = require('node:os');
const path = require('node:path');
const yazl = require('yazl');
const content = require('../src/content-import');

async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-import-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function archive(file) { const zip = new yazl.ZipFile(); zip.addBuffer(Buffer.from('data'), 'example.txt'); zip.end(); await pipeline(zip.outputStream, createWriteStream(file)); }

test('local content imports valid archives and preserves filename collisions', async t => {
  const root = await temp(t), source = path.join(root, 'Example.jar'), instance = path.join(root, 'instance'); await archive(source);
  assert.deepEqual(await content.importFiles(instance, 'mod', [source]), ['Example.jar']); assert.deepEqual(await content.importFiles(instance, 'mod', [source]), ['Example (2).jar']);
  await fs.access(path.join(instance, 'mods', 'Example.jar')); await fs.access(path.join(instance, 'mods', 'Example (2).jar'));
});

test('local content rejects wrong extensions and malformed archives', async t => {
  const root = await temp(t), text = path.join(root, 'bad.zip'), jar = path.join(root, 'bad.jar'); await fs.writeFile(text, 'not zip'); await fs.writeFile(jar, 'not jar');
  await assert.rejects(content.importFiles(path.join(root, 'instance'), 'mod', [text]), /Only .jar/); await assert.rejects(content.importFiles(path.join(root, 'instance'), 'mod', [jar]), /valid archive/);
});
