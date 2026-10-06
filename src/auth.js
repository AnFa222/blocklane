const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const URLS = { device: `${BASE}/devicecode`, token: `${BASE}/token`, xbox: 'https://user.auth.xboxlive.com/user/authenticate', xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize', minecraft: 'https://api.minecraftservices.com/authentication/login_with_xbox', entitlements: 'https://api.minecraftservices.com/entitlements/mcstore', profile: 'https://api.minecraftservices.com/minecraft/profile' };
const SCOPE = 'XboxLive.signin offline_access';
const DEMO = Object.freeze({ id: 'demo', name: 'Player', demo: true, uuid: '00000000000000000000000000000000', accessToken: '0', xuid: '', clientId: '' });
function clientId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.trim())) throw new Error('Enter the public Application (client) ID from your Microsoft app registration. No client secret is needed.');
  return value.trim();
}
function authError(status, data = {}, url) {
  const messages = {
    invalid_client: 'Microsoft rejected the launcher client ID. Check the app registration and enable public client flows.',
    unauthorized_client: 'This Microsoft application is not authorized for this sign-in flow.',
    invalid_scope: 'This application does not have access to the requested Xbox sign-in scope.',
    invalid_grant: 'This saved sign-in has expired or been revoked. Add the Microsoft account again.',
    authorization_declined: 'Microsoft sign-in was declined.', access_denied: 'Microsoft sign-in was declined.',
    expired_token: 'The sign-in code expired. Start Microsoft sign-in again.'
  };
  const xboxErrors = { 2148916233: 'Set up an Xbox profile for this Microsoft account, then try again.', 2148916238: 'This Xbox account needs family or age-related permissions before it can sign in.' };
  const e = new Error(messages[data.error] || xboxErrors[data.XErr] || (status === 403 ? 'The service denied access. The launcher application may need Xbox/Minecraft API approval, or this account may have access restrictions.' : `Microsoft/Xbox/Minecraft sign-in failed (HTTP ${status}). Please try again.`));
  e.code = ['authorization_pending', 'slow_down', 'invalid_grant', 'expired_token', 'access_denied', 'authorization_declined'].includes(data.error) ? data.error : 'AUTH_ERROR';
  const stage = { [URLS.device]: 'Microsoft device code', [URLS.token]: 'Microsoft token', [URLS.xbox]: 'Xbox sign-in', [URLS.xsts]: 'Xbox authorization (XSTS)', [URLS.minecraft]: 'Minecraft sign-in', [URLS.entitlements]: 'Minecraft ownership check', [URLS.profile]: 'Minecraft profile' }[url];
  if (stage) {
    const xerr = Number.isSafeInteger(data.XErr) ? `; Xbox code ${data.XErr}` : '';
    e.message = `${stage} failed (HTTP ${status}${xerr}). ${e.message}`;
    if (status === 403 && url === URLS.minecraft) e.message = 'Minecraft sign-in failed (HTTP 403). Microsoft and Xbox authentication completed, but Minecraft Services denied access. This launcher application may require Minecraft API approval; this response alone does not confirm the cause.';
  }
  return e;
}
// Authentication uses native HTTPS as well, without the failing fetch parser.
function request(url, options = {}) {
  if (!Object.values(URLS).includes(url)) return Promise.reject(new Error('Unsupported authentication endpoint.'));
  const { form, json, token, signal } = options;
  const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : null;
  const headers = { Accept: 'application/json' };
  if (url === URLS.xbox || url === URLS.xsts) headers['x-xbl-contract-version'] = '1';
  if (body) { headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    let timer;
    const req = https.request(url, { method: body ? 'POST' : 'GET', headers, signal, agent: false }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) res.destroy(new Error('Authentication response was too large.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('close', () => clearTimeout(timer));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode < 200 || res.statusCode >= 300) reject(authError(res.statusCode, data, url)); else resolve(data);
        } catch { reject(new Error('The sign-in service returned an invalid response.')); }
      });
    });
    req.on('error', () => { clearTimeout(timer); reject(new Error(signal?.aborted ? 'Sign-in cancelled.' : 'Could not connect to the sign-in service. Check your connection and try again.')); });
    timer = setTimeout(() => req.destroy(new Error('Sign-in request timed out.')), 30000); timer.unref();
    req.end(body);
  });
}

class Accounts {
  constructor(root, secureStorage, options = {}) {
    this.file = path.join(root, 'accounts.enc'); this.secure = secureStorage;
    this.applicationClientId = options.clientId || '';
    this.request = options.request || request; this.wait = options.wait || sleep; this.now = options.now || Date.now;
    this.data = { clientId: options.clientId || '', selected: 'demo', accounts: [] };
    this.pending = null; this.locked = false; this.issue = null; this.sessions = new Map();
  }
  async init() {
    try {
      const bytes = await fs.readFile(this.file);
      if (!this.secure.isEncryptionAvailable()) throw new Error('Encrypted storage unavailable');
      const saved = JSON.parse(this.secure.decryptString(bytes));
      if (!Array.isArray(saved.accounts)) throw new Error('Invalid account vault');
      this.data = saved;
      if (this.applicationClientId) this.data.clientId = this.applicationClientId;
      if (!saved.accounts.some(a => a.id === saved.selected)) this.data.selected = 'demo';
    } catch (e) { if (e.code !== 'ENOENT') this.issue = 'Saved accounts could not be unlocked on this Windows user. Demo is still available. The existing account file has been preserved.'; }
    return this.list();
  }
  list() {
    return { selected: this.data.selected, configured: Boolean(this.data.clientId), pending: Boolean(this.pending), issue: this.issue,
      accounts: [{ id: 'demo', name: 'Demo player', type: 'demo' }, ...this.data.accounts.map(a => ({ id: a.id, name: a.name, type: a.type === 'local' ? 'local' : 'microsoft' }))] };
  }
  async persist() {
    if (this.issue) throw new Error(this.issue);
    if (!this.secure.isEncryptionAvailable()) throw new Error('Windows encrypted storage is unavailable. Microsoft accounts cannot be saved securely; Demo is still available.');
    const encrypted = this.secure.encryptString(JSON.stringify(this.data));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, encrypted); await fs.rename(temp, this.file); }
    finally { await fs.rm(temp, { force: true }); }
  }
  async change(action) {
    if (this.locked || this.pending) throw new Error('Finish or cancel the current sign-in first.');
    this.locked = true; const previous = structuredClone(this.data);
    try { action(); await this.persist(); return this.list(); }
    catch (error) { this.data = previous; throw error; }
    finally { this.locked = false; }
  }
  configure(id) { return this.change(() => { this.data.clientId = clientId(id); }); }
  async select(id) {
    // Demo remains usable even if a vault cannot be decrypted on this machine.
    if (id === 'demo' && (this.issue || !this.secure.isEncryptionAvailable())) { this.data.selected = id; return this.list(); }
    return this.change(() => { if (id !== 'demo' && !this.data.accounts.some(a => a.id === id)) throw new Error('Account not found.'); this.data.selected = id; });
  }
  async remove(id) {
    if (id === 'demo') throw new Error('Demo is always available.');
    const result = await this.change(() => { this.data.accounts = this.data.accounts.filter(a => a.id !== id); if (this.data.selected === id) this.data.selected = 'demo'; });
    this.sessions.delete(id); return result;
  }
  async createLocal(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(name.trim())) throw new Error('Local names must be 1–16 letters, numbers, or underscores.');
    const account = { id: crypto.randomUUID().replace(/-/g, ''), name: name.trim(), type: 'local' };
    return this.change(() => { this.data.accounts = [...this.data.accounts.filter(a => a.type !== 'local' || a.name !== account.name), account]; this.data.selected = account.id; });
  }
  async begin() {
    if (this.pending || this.locked) throw new Error('A sign-in is already in progress.');
    if (this.issue) throw new Error(this.issue);
    if (!this.secure.isEncryptionAvailable()) throw new Error('Windows encrypted storage is unavailable.');
    if (!this.data.clientId) throw new Error('Microsoft sign-in is not available in this development build. Demo is available.');
    const id = clientId(this.data.clientId);
    const pending = { controller: new AbortController(), clientId: id }; this.pending = pending;
    try {
      const info = await this.request(URLS.device, { form: { client_id: id, scope: SCOPE }, signal: pending.controller.signal });
      const uri = new URL(info.verification_uri);
      if (uri.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(uri.hostname) || !info.device_code || !info.user_code || !(info.expires_in > 0)) throw new Error('Microsoft returned an invalid sign-in code.');
      pending.deviceCode = info.device_code; pending.interval = Math.max(5, Number(info.interval) || 5) * 1000;
      pending.expiresAt = this.now() + Math.min(Number(info.expires_in), 1800) * 1000;
      pending.uri = uri.href;
      return { userCode: info.user_code, verificationUri: uri.href, expiresAt: pending.expiresAt };
    } catch (error) { this.pending = null; throw error; }
  }
  cancel() { this.pending?.controller.abort(); }
  async finish() {
    const p = this.pending;
    if (!p?.deviceCode) throw new Error('Start Microsoft sign-in first.');
    const signal = p.controller.signal;
    try {
      while (this.now() < p.expiresAt) {
        await this.wait(p.interval, undefined, { signal }); signal.throwIfAborted();
        let tokens;
        try { tokens = await this.request(URLS.token, { form: { client_id: p.clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: p.deviceCode }, signal }); }
        catch (error) { if (error.code === 'authorization_pending') continue; if (error.code === 'slow_down') { p.interval += 5000; continue; } throw error; }
        if (!tokens.refresh_token) throw new Error('Microsoft did not provide a renewable sign-in. Please sign in again.');
        const session = await this.exchange(tokens.access_token, p.clientId, signal);
        signal.throwIfAborted();
        const previous = structuredClone(this.data);
        const account = { id: session.uuid, name: session.name, refreshToken: tokens.refresh_token, clientId: p.clientId };
        this.data.accounts = [...this.data.accounts.filter(a => a.id !== account.id), account]; this.data.selected = account.id;
        try { await this.persist(); } catch (error) { this.data = previous; throw error; }
        this.sessions.set(account.id, session); this.pending = null; return this.list();
      }
      throw new Error('The Microsoft sign-in code expired. Please try again.');
    } finally { if (this.pending === p) this.pending = null; }
  }
  async exchange(accessToken, id, signal) {
    if (!accessToken) throw new Error('Microsoft did not return an access token.');
    const xbox = await this.request(URLS.xbox, { json: { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${accessToken}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }, signal });
    if (!xbox.Token) throw new Error('Xbox sign-in did not return a token.');
    const xsts = await this.request(URLS.xsts, { json: { Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }, signal });
    const claim = xsts.DisplayClaims?.xui?.[0];
    if (!xsts.Token || !claim?.uhs) throw new Error('Xbox authorization did not return a valid identity.');
    const mc = await this.request(URLS.minecraft, { json: { identityToken: `XBL3.0 x=${claim.uhs};${xsts.Token}` }, signal });
    if (!mc.access_token || !(mc.expires_in > 0)) throw new Error('Minecraft sign-in did not return a valid session.');
    const owned = await this.request(URLS.entitlements, { token: mc.access_token, signal });
    if (!owned.items?.some(item => ['game_minecraft', 'product_minecraft'].includes(item.name))) throw new Error('This Microsoft account does not currently have Minecraft Java Edition access. Choose Demo, or sign in with an account that owns the game.');
    const profile = await this.request(URLS.profile, { token: mc.access_token, signal });
    if (!/^[a-f0-9]{32}$/i.test(profile.id) || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name)) throw new Error('This account needs a valid Minecraft Java profile. Set it up on Minecraft.net first.');
    return { demo: false, uuid: profile.id, name: profile.name, accessToken: mc.access_token, xuid: claim.xid || xbox.DisplayClaims?.xui?.[0]?.xid || '', clientId: id, expiresAt: this.now() + Number(mc.expires_in) * 1000 };
  }
  async session(id, signal) {
    if (id === 'demo') return { ...DEMO };
    if (this.locked || this.pending) throw new Error('Finish or cancel sign-in before launching.');
    const account = this.data.accounts.find(a => a.id === id);
    if (!account) throw new Error('Select a saved Microsoft account or Demo.');
    if (account.type === 'local') return { local: true, demo: false, uuid: account.id, name: account.name, accessToken: '0', xuid: '', clientId: '', expiresAt: Infinity };
    const cached = this.sessions.get(id);
    if (cached && cached.expiresAt > this.now() + 60000) return cached;
    this.locked = true;
    try {
      const tokens = await this.request(URLS.token, { form: { client_id: account.clientId, grant_type: 'refresh_token', refresh_token: account.refreshToken, scope: SCOPE }, signal });
      if (tokens.refresh_token) { const previous = account.refreshToken; account.refreshToken = tokens.refresh_token; try { await this.persist(); } catch (error) { account.refreshToken = previous; throw error; } }
      const session = await this.exchange(tokens.access_token, account.clientId, signal);
      if (session.uuid !== id) throw new Error('The refreshed account did not match the saved Minecraft profile. Sign in again.');
      account.name = session.name; await this.persist(); this.sessions.set(id, session); return session;
    } finally { this.locked = false; }
  }
}
module.exports = { Accounts, URLS, DEMO, clientId, authError, request };
