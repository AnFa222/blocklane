const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { Accounts, URLS, DEMO, clientId, authError } = require('../src/auth');
const { launchIdentity, expandArgs, redactStream } = require('../src/core');
const CLIENT = '11111111-2222-3333-4444-555555555555';
test('authentication errors identify the denied service without exposing response secrets', () => {
  const secret = 'private-token-do-not-display';
  for (const url of Object.values(URLS)) {
    const error = authError(403, { error_description: secret, access_token: secret }, url);
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes(secret));
  }
  assert.match(authError(403, {}, URLS.minecraft).message, /Microsoft and Xbox authentication completed/);
  assert.match(authError(401, { XErr: 2148916238 }, URLS.xsts).message, /2148916238.*family/);
  assert.equal(authError(400, { error: 'authorization_pending' }, URLS.token).code, 'authorization_pending');
});
const FIRST = 'a'.repeat(32), SECOND = 'b'.repeat(32);
// Test-only cipher. Production injects Electron safeStorage/Windows DPAPI.
function secure() {
  const key = crypto.randomBytes(32);
  return { isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), bytes]); },
    decryptString: bytes => { const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString('utf8'); }
  };
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-auth-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cipher = secure(); let identity = FIRST, owned = true, profileCalls = 0, profileSkins = [];
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options }); options.signal?.throwIfAborted();
    if (url === URLS.device) return { device_code: 'private-device-code', user_code: 'TEST-CODE', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900 };
    if (url === URLS.token) return { access_token: 'ms-access-secret', refresh_token: 'ms-refresh-secret-rotated' };
    if (url === URLS.xbox) return { Token: 'xbox-secret' };
    if (url === URLS.xsts) return { Token: 'xsts-secret', DisplayClaims: { xui: [{ uhs: 'hash', xid: '123' }] } };
    if (url === URLS.minecraft) return { access_token: 'minecraft-access-secret', expires_in: 3600 };
    if (url === URLS.entitlements) return { items: owned ? [{ name: 'game_minecraft' }] : [] };
    if (url === URLS.profile) { profileCalls++; return { id: identity, name: identity === FIRST ? 'PlayerOne' : 'PlayerTwo', skins: profileSkins }; }
    if (url === URLS.skins) return {};
    throw new Error('Unexpected endpoint');
  };
  const a = new Accounts(root, cipher, { request, wait: async () => {}, clientId: CLIENT }); await a.init();
  return { a, root, cipher, request, calls, identity: id => identity = id, ownership: value => owned = value, skins: value => profileSkins = value, profileCalls: () => profileCalls };
}

function skinPng(width = 64, height = 64) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(13, 8); Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
test('client ID validation and explicit demo/full-session separation', () => {
  assert.equal(clientId(CLIENT), CLIENT); assert.throws(() => clientId('password'));
  assert.equal(launchIdentity(DEMO).demo, true);
  assert.throws(() => launchIdentity({ demo: false, uuid: FIRST, accessToken: '0', expiresAt: Date.now() + 10000 }));
  const args = [{ rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' }];
  assert.deepEqual(expandArgs(args, {}, { is_demo_user: true }), ['--demo']);
  assert.deepEqual(expandArgs(args, {}, { is_demo_user: false }), []);
});
test('sign-in adds two distinct accounts, re-login deduplicates, selected account persists encrypted', async t => {
  const f = await fixture(t);
  const info = await f.a.begin(); assert.equal(info.userCode, 'TEST-CODE'); assert.equal(info.device_code, undefined);
  await f.a.finish(); f.identity(SECOND); await f.a.begin(); await f.a.finish();
  await f.a.begin(); await f.a.finish(); assert.equal(f.a.list().accounts.length, 3);
  await f.a.select(FIRST);
  const bytes = await fs.readFile(path.join(f.root, 'accounts.enc'));
  for (const value of ['ms-refresh-secret', 'minecraft-access-secret', 'PlayerOne']) assert.equal(bytes.includes(Buffer.from(value)), false);
  const listed = JSON.stringify(f.a.list()); assert.equal(/secret|refreshToken|accessToken/.test(listed), false);
  const restored = new Accounts(f.root, f.cipher, { request: f.request }); await restored.init();
  assert.equal(restored.list().selected, FIRST); assert.equal(restored.list().accounts.length, 3);
  await restored.remove(FIRST); assert.equal(restored.list().selected, 'demo'); assert.equal(restored.list().accounts.length, 2);
});
test('account without Java entitlement cannot create a full-game session', async t => {
  const f = await fixture(t); f.ownership(false);
  await f.a.begin(); await assert.rejects(f.a.finish(), /does not currently have/);
  assert.equal(f.a.list().accounts.length, 1); assert.equal(f.profileCalls(), 0);
  assert.equal((await f.a.session('demo')).demo, true);
});
test('device polling handles pending, slow_down, and cancellation', async t => {
  const f = await fixture(t), delays = []; let count = 0;
  f.a.wait = async delay => delays.push(delay);
  f.a.request = async (url, opts) => {
    if (url === URLS.token && count++ < 2) throw authError(400, { error: count === 1 ? 'authorization_pending' : 'slow_down' });
    return f.request(url, opts);
  };
  await f.a.begin(); await f.a.finish(); assert.deepEqual(delays, [5000, 5000, 10000]);
  await f.a.begin(); f.a.cancel(); await assert.rejects(f.a.finish(), /abort/i); assert.equal(f.a.list().pending, false);
});
test('refresh after restart rotates encrypted token and rejects changed account identity', async t => {
  const f = await fixture(t); await f.a.begin(); await f.a.finish();
  const restored = new Accounts(f.root, f.cipher, { request: f.request }); await restored.init();
  const session = await restored.session(FIRST); assert.equal(session.uuid, FIRST); assert.equal(session.demo, false);
  assert.ok(f.calls.some(c => c.options.form?.grant_type === 'refresh_token'));
  const calls = f.calls.length; await restored.session(FIRST); assert.equal(f.calls.length, calls);
  restored.sessions.clear(); f.identity(SECOND);
  await assert.rejects(restored.session(FIRST), /did not match/);
});
test('invalid refresh token fails closed without switching to demo', async t => {
  const f = await fixture(t); await f.a.begin(); await f.a.finish(); f.a.sessions.clear();
  f.a.request = async () => { throw authError(400, { error: 'invalid_grant' }); };
  await assert.rejects(f.a.session(FIRST), /revoked/); assert.equal(f.a.list().selected, FIRST);
});
test('unreadable vault is preserved and demo remains usable', async t => {
  const f = await fixture(t); await f.a.begin(); await f.a.finish();
  const before = await fs.readFile(path.join(f.root, 'accounts.enc'));
  const otherUser = new Accounts(f.root, secure()); await otherUser.init();
  assert.ok(otherUser.list().issue); assert.equal((await otherUser.session('demo')).demo, true);
  await assert.rejects(otherUser.configure(CLIENT));
  assert.deepEqual(await fs.readFile(path.join(f.root, 'accounts.enc')), before);
});
test('missing secure storage never writes plaintext credentials', async t => {
  const f = await fixture(t); f.a.secure.isEncryptionAvailable = () => false;
  await assert.rejects(f.a.begin(), /encrypted storage/);
  assert.equal((await f.a.session('demo')).demo, true);
  await assert.rejects(fs.access(path.join(f.root, 'accounts.enc')));
});
test('game log redaction handles tokens split across stream chunks', async () => {
  const filter = redactStream('secret-access-token');
  Readable.from(['hello secr', 'et-access-', 'token world\n']).pipe(filter);
  let output = ''; for await (const chunk of filter) output += chunk;
  assert.equal(output, 'hello [REDACTED] world\n');
});

test('build-time client ID overrides legacy setup and is never returned to the UI', async t => {
  const f = await fixture(t); await f.a.begin(); await f.a.finish();
  const next = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const packaged = new Accounts(f.root, f.cipher, { request: f.request, clientId: next });
  await packaged.init();
  assert.equal(packaged.list().clientId, undefined);
  assert.equal(packaged.list().configured, true);
  await packaged.begin();
  assert.equal(f.calls.at(-1).options.form.client_id, next);
  assert.equal(packaged.data.accounts[0].clientId, CLIENT);
  packaged.cancel();
});

test('unconfigured builds do not send sign-in requests or ask players for an ID', async t => {
  const f = await fixture(t);
  const a = new Accounts(f.root, f.cipher, { request: async () => { throw new Error('Must not contact Microsoft'); } });
  await a.init();
  assert.equal(a.list().configured, false);
  await assert.rejects(a.begin(), /not available in this development build/);
  assert.equal((await a.session('demo')).demo, true);
});

test('local account skins validate and persist per account without network access', async t => {
  const f = await fixture(t); const local = await f.a.createLocal('OfflinePlayer');
  const file = path.join(f.root, 'alex.png'); await fs.writeFile(file, skinPng());
  const saved = await f.a.setSkin(local.selected, file, 'slim');
  assert.equal(saved.type, 'local'); assert.equal(saved.variant, 'slim'); assert.match(saved.url, /^data:image\/png;base64,/);
  assert.equal(f.calls.length, 0);
  const restored = new Accounts(f.root, f.cipher, { request: async () => { throw new Error('Local skin must not use the network.'); } }); await restored.init();
  assert.equal((await restored.skin(local.selected)).variant, 'slim');
  const invalid = path.join(f.root, 'invalid.png'); await fs.writeFile(invalid, skinPng(128, 128));
  await assert.rejects(restored.setSkin(local.selected, invalid, 'classic'), /64×64 or legacy 64×32/);
});

test('Microsoft account skin uses the official profile and multipart skin endpoints', async t => {
  const f = await fixture(t); await f.a.begin(); await f.a.finish();
  f.skins([{ state: 'ACTIVE', variant: 'CLASSIC', url: 'https://textures.minecraft.net/texture/example' }]);
  const file = path.join(f.root, 'steve.png'); await fs.writeFile(file, skinPng(64, 32));
  const saved = await f.a.setSkin(FIRST, file, 'classic');
  assert.equal(saved.type, 'microsoft'); assert.equal(saved.variant, 'classic'); assert.equal(saved.url, 'https://textures.minecraft.net/texture/example');
  const upload = f.calls.find(call => call.url === URLS.skins);
  assert.ok(upload); assert.equal(upload.options.token, 'minecraft-access-secret'); assert.match(upload.options.contentType, /^multipart\/form-data; boundary=/);
  assert.ok(Buffer.isBuffer(upload.options.raw));
  const body = upload.options.raw.toString('latin1'); assert.match(body, /name="variant"\r\n\r\nclassic/); assert.match(body, /name="file"; filename="skin\.png"/);
});
