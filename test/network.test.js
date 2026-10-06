const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const network = require('../src/network');
const { download } = require('../src/core');

test('429 retry honors Retry-After and stops after four attempts', async () => {
  let calls = 0; const delays = [];
  await assert.rejects(network.withRetries(async () => { calls++; throw network.httpError(429, '3'); }, undefined, async ms => delays.push(ms)), /429/);
  assert.equal(calls, 4); assert.deepEqual(delays, [3000, 3000, 4000]);
  assert.ok(network.httpError(503, new Date(Date.now() + 10000).toUTCString()).retryAfterMs > 8000);
});
test('permanent errors do not retry; long server pauses are not shortened', async () => {
  let calls = 0;
  await assert.rejects(network.withRetries(async () => { calls++; throw network.httpError(404); }), /404/);
  assert.equal(calls, 1);
  await assert.rejects(network.withRetries(async () => { throw network.httpError(429, '600'); }), /longer pause/);
});
test('cancellation interrupts retry backoff', async () => {
  const c = new AbortController();
  const task = network.withRetries(async () => { throw network.httpError(429, '60'); }, c.signal);
  setTimeout(() => c.abort(), 20);
  await assert.rejects(task, /abort/i);
});
test('real socket disconnect mid-body retries safely, checks hash, and cleans partial files', async t => {
  let calls = 0;
  const payload = Buffer.alloc(128 * 1024, 'x');
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Length': payload.length });
    if (calls === 1) { res.write(payload.subarray(0, 1024)); setTimeout(() => res.destroy(), 10); }
    else res.end(payload);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const original = network.open;
  t.mock.method(network, 'open', (url, signal) => original(`http://127.0.0.1:${server.address().port}`, signal, http.get));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-network-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await download({ url: 'https://libraries.minecraft.net/test', sha1: crypto.createHash('sha1').update(payload).digest('hex'), size: payload.length }, path.join(root, 'asset'));
  assert.equal(calls, 2); assert.deepEqual(await fs.readFile(path.join(root, 'asset')), payload);
  assert.deepEqual(await fs.readdir(root), ['asset']);
});
