const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const network = require('./network');
const { ensureRuntime, managedJava } = require('./runtime');
const { DEMO } = require('./auth');
const { pipeline } = require('node:stream/promises');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const yauzl = require('yauzl');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const exec = promisify(execFile);
const platformName = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];
const host = { name: platformName, arch: process.arch === 'x64' ? 'x86_64' : process.arch === 'ia32' ? 'x86' : process.arch, version: os.release() };

function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes(':') || relative.includes('\\')) throw new Error('Invalid file path.');
  const target = path.resolve(root, relative);
  if (target === path.resolve(root) || !target.startsWith(path.resolve(root) + path.sep)) throw new Error('File path escapes the launcher folder.');
  return target;
}

function validId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id)) throw new Error('Invalid version or profile ID.');
  return id;
}

function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

function allowed(rules, features = {}, system = host) {
  if (!rules) return true;
  let result = false;
  for (const rule of rules) {
    const o = rule.os;
    if (o?.name && o.name !== system.name) continue;
    if (o?.arch && o.arch !== system.arch) continue;
    if (o?.version && !new RegExp(o.version).test(system.version)) continue;
    if (o?.versionRange?.min && compareVersions(system.version, o.versionRange.min) < 0) continue;
    if (o?.versionRange?.max && compareVersions(system.version, o.versionRange.max) >= 0) continue;
    if (rule.features && !Object.entries(rule.features).every(([key, value]) => Boolean(features[key]) === value)) continue;
    result = rule.action === 'allow';
  }
  return result;
}

function expandArgs(entries, values, features, system = host) {
  return entries.flatMap(entry => typeof entry === 'string' ? [entry] : allowed(entry.rules, features, system) ? [entry.value].flat() : [])
    .map(arg => arg.replace(/\$\{([^}]+)\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`Unsupported game argument: ${key}`);
      return String(values[key]);
    }));
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com', 'launcher.mojang.com', 'resources.download.minecraft.net', 'libraries.minecraft.net'].includes(url.hostname)) throw new Error('Untrusted download host.');
  return url;
}

async function response(url, signal) {
  trustedUrl(url);
  const result = await network.open(url, signal);
  if (result.statusCode !== 200) {
    const error = network.httpError(result.statusCode, result.headers['retry-after']);
    result.destroy();
    throw error;
  }
  return result;
}

async function remoteJson(url, signal) {
  return network.withRetries(async () => {
    const stream = await response(url, signal);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }, signal);
}

async function hashFile(file) {
  const hash = crypto.createHash('sha1');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}

async function download(item, dest, signal) {
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{40}$/.test(item.sha1 || '')) throw new Error('Download is missing a valid checksum.');
  try {
    const stat = await fs.stat(dest);
    if ((!item.size || stat.size === item.size) && await hashFile(dest) === item.sha1) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  return network.withRetries(async () => {
  const temp = dest + '.' + crypto.randomUUID() + '.part';
  try {
    const res = await response(item.url, signal);
    const hash = crypto.createHash('sha1');
    let bytes = 0;
    const verifier = new Transform({ transform(chunk, encoding, next) { hash.update(chunk); bytes += chunk.length; next(null, chunk); } });
    await pipeline(res, verifier, createWriteStream(temp), { signal });
    if (hash.digest('hex') !== item.sha1 || (item.size != null && bytes !== item.size)) {
      const error = new Error('A download failed its integrity check. Retry to repair it.');
      error.code = 'EINTEGRITY'; throw error;
    }
    await fs.rename(temp, dest);
  } finally { await fs.rm(temp, { force: true }); }
  }, signal);
}

async function pool(items, task, signal, concurrency = 4) {
  let cursor = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const item = items[cursor++];
      try { signal?.throwIfAborted(); await task(item); } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
}

async function extractNatives(archive, destination, exclude, signal) {
  const zip = await yauzl.openPromise(archive, { lazyEntries: true, strictFileNames: true });
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (entry.fileName.endsWith('/') || exclude.some(prefix => entry.fileName.startsWith(prefix))) continue;
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (mode && mode !== 0x8000) throw new Error('Native archive contains a non-regular file.');
      const dest = safePath(destination, entry.fileName);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(dest), { signal });
    }
  } finally { zip.close(); }
}

function libraryPlan(meta, root, system = host) {
  const artifacts = [], natives = [];
  for (const lib of meta.libraries) {
    if (!allowed(lib.rules, {}, system)) continue;
    if (lib.downloads?.artifact) artifacts.push({ ...lib.downloads.artifact, dest: safePath(path.join(root, 'libraries'), lib.downloads.artifact.path) });
    const classifier = lib.natives?.[system.name]?.replace('${arch}', system.arch === 'x86' ? '32' : '64');
    if (classifier) {
      const item = lib.downloads?.classifiers?.[classifier];
      if (!item) throw new Error(`Native library unavailable: ${lib.name}`);
      natives.push({ ...item, dest: safePath(path.join(root, 'libraries'), item.path), exclude: lib.extract?.exclude || ['META-INF/'] });
    }
  }
  return { artifacts, natives };
}

function validateProfile(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 50) throw new Error('Use a profile name between 1 and 50 characters.');
  validId(input.version);
  if (!Number.isInteger(input.memory) || input.memory < 1 || input.memory > 32) throw new Error('Memory must be between 1 and 32 GB.');
  if (typeof input.javaPath !== 'string' || input.javaPath.length > 1024 || input.javaPath.includes('\0')) throw new Error('Invalid Java path.');
  return { id: input.id ? validId(input.id) : crypto.randomUUID(), name: input.name.trim(), version: input.version, memory: input.memory, javaPath: input.javaPath.trim() || 'auto' };
}

async function inspectJava(executable = 'java') {
  try {
    const { stdout, stderr } = await exec(executable, ['-XshowSettings:properties', '-version'], { timeout: 15000, windowsHide: true });
    const output = stdout + stderr;
    const match = output.match(/(?:java|openjdk) version "([^\"]+)"/);
    const version = match?.[1] || output.match(/java.version\s*=\s*(\S+)/)?.[1];
    if (!version) throw new Error('Could not determine the Java version.');
    const major = Number(version.startsWith('1.') ? version.split('.')[1] : version.split(/[._+-]/)[0]);
    return { version, major, path: executable, arch: output.match(/os.arch\s*=\s*(\S+)/)?.[1] || 'unknown' };
  } catch { throw new Error('Could not run this Java executable. Use automatic Java or choose a valid 64-bit java.exe in the profile.'); }
}

function launchIdentity(session) {
  if (session.demo) return { ...DEMO };
  if (!/^[a-f0-9]{32}$/i.test(session.uuid) || !session.accessToken || session.accessToken === '0' || !(session.expiresAt > Date.now())) throw new Error('A valid Microsoft Minecraft session is required. Sign in again or choose Demo.');
  return session;
}

function redactStream(secret) {
  const { StringDecoder } = require('node:string_decoder');
  const decoder = new StringDecoder('utf8'); let pending = '';
  return new Transform({
    transform(chunk, encoding, next) {
      pending += decoder.write(chunk);
      if (!secret || secret === '0') { this.push(pending); pending = ''; next(); return; }
      let index;
      while ((index = pending.indexOf(secret)) >= 0) { this.push(pending.slice(0, index) + '[REDACTED]'); pending = pending.slice(index + secret.length); }
      const safe = Math.max(0, pending.length - secret.length + 1);
      this.push(pending.slice(0, safe)); pending = pending.slice(safe); next();
    },
    flush(next) { pending += decoder.end(); this.push(secret && secret !== '0' ? pending.split(secret).join('[REDACTED]') : pending); next(); }
  });
}

class Launcher {
  constructor(root, emit = () => {}) { this.root = root; this.emit = emit; this.busy = false; this.child = null; this.manifest = null; }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    this.state = await readJson(path.join(this.root, 'state.json'), { profiles: [], selectedProfile: null });
    return this.snapshot();
  }
  async snapshot() {
    const versions = await fs.readdir(path.join(this.root, 'versions')).catch(() => []);
    const installed = [];
    for (const id of versions) {
      const marker = await readJson(path.join(this.root, 'versions', id, 'installed.json'), null);
      if (marker) installed.push(marker);
    }
    return { ...this.state, installed, root: this.root, busy: this.busy, running: Boolean(this.child) };
  }
  async persist() { await atomicJson(path.join(this.root, 'state.json'), this.state); return this.snapshot(); }
  async catalog(refresh = false) {
    if (this.manifest && !refresh) return { ...this.manifest, cached: Boolean(this.manifestCached) };
    try {
      const m = await remoteJson(MANIFEST);
      if (!Array.isArray(m.versions) || !m.latest?.release) throw new Error('Invalid version catalog.');
      this.manifest = m;
      this.manifestCached = false;
      await atomicJson(path.join(this.root, 'manifest.json'), m);
      return { ...m, cached: false };
    } catch (error) {
      this.manifest = await readJson(path.join(this.root, 'manifest.json'), null);
      this.manifestCached = true;
      if (!this.manifest) throw new Error('Could not load Minecraft versions. Connect to the internet and click Refresh.');
      return { ...this.manifest, cached: true };
    }
  }
  async saveProfile(input) {
    const profile = validateProfile(input);
    const catalog = await this.catalog();
    if (!catalog.versions.some(v => v.id === profile.version)) throw new Error('Choose a version from the official catalog.');
    if (input.id && !this.state.profiles.some(p => p.id === profile.id)) throw new Error('Profile does not exist.');
    const index = this.state.profiles.findIndex(p => p.id === profile.id);
    if (index < 0) this.state.profiles.push(profile); else this.state.profiles[index] = profile;
    this.state.selectedProfile = profile.id;
    return this.persist();
  }
  async selectProfile(id) {
    if (!this.state.profiles.some(p => p.id === id)) throw new Error('Profile does not exist.');
    this.state.selectedProfile = id;
    return this.persist();
  }
  async deleteProfile(id) {
    if (this.child || this.busy) throw new Error('Wait for the current operation to finish.');
    this.state.profiles = this.state.profiles.filter(p => p.id !== id);
    if (this.state.selectedProfile === id) this.state.selectedProfile = this.state.profiles[0]?.id || null;
    return this.persist();
  }
  progress(message, done = 0, total = 1) { this.emit('progress', { message, done, total }); }
  cancel() { this.controller?.abort(new Error('Installation cancelled. Downloaded files are kept for retry.')); }
  async ensureJava(meta, signal) {
    return ensureRuntime(meta, path.join(this.root, 'runtimes'), path.join(__dirname, '..', 'runtimes'),
      { safePath, readJson, hashFile, inspectJava, remoteJson, download, pool, atomicJson }, signal,
      (message, done, total) => this.progress(message, done, total));
  }
  async install(id) {
    validId(id);
    if (this.busy || this.child) throw new Error('Wait for the current operation to finish.');
    this.busy = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const versionDir = path.join(this.root, 'versions', id);
    try {
      this.progress(`Reading ${id} metadata`);
      const catalog = await this.catalog();
      const entry = catalog.versions.find(v => v.id === id);
      if (!entry) throw new Error('Version is not in the official catalog.');
      const metaFile = path.join(versionDir, `${id}.json`);
      await download(entry, metaFile, signal);
      const meta = await readJson(metaFile);
      if (!meta.arguments || !meta.downloads?.client) throw new Error('This first release supports vanilla 1.13+ and modern snapshots. Legacy versions are not supported yet.');
      // An interrupted repair must never leave a completed marker behind.
      await fs.rm(path.join(versionDir, 'installed.json'), { force: true });
      await this.ensureJava(meta, signal);
      const plan = libraryPlan(meta, this.root);
      const indexPath = safePath(path.join(this.root, 'assets', 'indexes'), validId(meta.assetIndex.id) + '.json');
      await download(meta.assetIndex, indexPath, signal);
      const assetIndex = await readJson(indexPath);
      if (assetIndex.virtual || assetIndex.map_to_resources) throw new Error('Legacy asset layouts are not supported in this release.');
      const jobs = [
        { ...meta.downloads.client, dest: path.join(versionDir, `${id}.jar`) },
        ...plan.artifacts, ...plan.natives,
        ...Object.values(assetIndex.objects).map(a => {
          if (!/^[a-f0-9]{40}$/.test(a.hash)) throw new Error('Invalid asset checksum.');
          return { sha1: a.hash, size: a.size, url: `https://resources.download.minecraft.net/${a.hash.slice(0, 2)}/${a.hash}`, dest: path.join(this.root, 'assets', 'objects', a.hash.slice(0, 2), a.hash) };
        })
      ];
      if (meta.logging?.client) jobs.push({ ...meta.logging.client.file, dest: safePath(path.join(this.root, 'assets', 'log_configs'), meta.logging.client.file.id) });
      const unique = [...new Map(jobs.map(j => [j.dest, j])).values()];
      let done = 0;
      this.progress(`Installing ${id}`, done, unique.length);
      await pool(unique, async job => { await download(job, job.dest, signal); this.progress(`Installing ${id}`, ++done, unique.length); }, signal);
      this.progress('Preparing native libraries', 0, 1);
      const nativesDir = path.join(versionDir, 'natives');
      await fs.mkdir(nativesDir, { recursive: true });
      for (const item of plan.natives) {
        signal.throwIfAborted();
        await extractNatives(item.dest, nativesDir, item.exclude, signal);
      }
      signal.throwIfAborted();
      await atomicJson(path.join(versionDir, 'installed.json'), { id, type: meta.type, installedAt: new Date().toISOString(), javaMajor: meta.javaVersion?.majorVersion || 8 });
      this.progress(`${id} is ready`, 1, 1);
    } finally { this.busy = false; this.controller = null; }
    return this.snapshot();
  }
  async removeVersion(id) {
    validId(id);
    if (this.busy || this.child) throw new Error('Wait for the current operation to finish.');
    await fs.rm(safePath(path.join(this.root, 'versions'), id), { recursive: true, force: true });
    return this.snapshot();
  }
  async launch(profileId, accountId = 'demo') {
    if (this.busy || this.child) throw new Error('A game or installation is already running.');
    const p = this.state.profiles.find(p => p.id === profileId);
    if (!p) throw new Error('Create or select a profile first.');
    this.busy = true;
    this.controller = new AbortController();
    try {
      const dir = path.join(this.root, 'versions', p.version);
      const installed = await readJson(path.join(dir, 'installed.json'), null);
      if (!installed) throw new Error('Install this profile’s version first.');
      const meta = await readJson(path.join(dir, `${p.version}.json`));
      this.progress('Preparing account', 0, 1);
      if (!this.authenticate && accountId !== 'demo') throw new Error('Microsoft sign-in is not configured.');
      const identity = launchIdentity(this.authenticate ? await this.authenticate(accountId, this.controller.signal) : DEMO);
      const javaPath = managedJava(p.javaPath) ? await this.ensureJava(meta, this.controller.signal) : p.javaPath;
      this.controller.signal.throwIfAborted();
      const java = await inspectJava(javaPath);
      const required = meta.javaVersion?.majorVersion || 8;
      if (java.major !== required) throw new Error(`${p.version} expects Java ${required}; your profile uses Java ${java.major}. Set the profile’s Java runtime to auto, or select a Java ${required} java.exe.`);
      if (!['amd64', 'x86_64'].includes(java.arch)) throw new Error('This release requires 64-bit x86 Java on Windows.');
      const plan = libraryPlan(meta, this.root);
      const classpath = [...plan.artifacts.map(a => a.dest), path.join(dir, `${p.version}.jar`)];
      for (const file of classpath) await fs.access(file).catch(() => { throw new Error('Game files are missing. Repair the version in the Versions tab.'); });
      const gameDir = path.join(this.root, 'instances', p.id);
      await fs.mkdir(gameDir, { recursive: true });
      const values = {
        natives_directory: path.join(dir, 'natives'), launcher_name: 'Blocklane', launcher_version: '0.2.1',
        classpath: classpath.join(path.delimiter), classpath_separator: path.delimiter, library_directory: path.join(this.root, 'libraries'),
        auth_player_name: identity.name, version_name: p.version, game_directory: gameDir, assets_root: path.join(this.root, 'assets'),
        assets_index_name: meta.assetIndex.id, auth_uuid: identity.uuid, auth_access_token: identity.accessToken,
        clientid: identity.clientId, auth_xuid: identity.xuid, user_type: 'msa', version_type: meta.type, user_properties: '{}',
        resolution_width: '1280', resolution_height: '720'
      };
      const features = { is_demo_user: identity.demo, has_custom_resolution: true };
      const jvm = expandArgs(meta.arguments.jvm, values, features);
      if (meta.logging?.client) jvm.push(meta.logging.client.argument.replace('${path}', safePath(path.join(this.root, 'assets', 'log_configs'), meta.logging.client.file.id)));
      const game = expandArgs(meta.arguments.game, values, features);
      if (identity.demo && !game.includes('--demo')) game.push('--demo');
      const args = ['-Xms512M', `-Xmx${p.memory}G`, ...jvm, meta.mainClass, ...game];
      const logDir = path.join(this.root, 'logs');
      await fs.mkdir(logDir, { recursive: true });
      const log = createWriteStream(path.join(logDir, 'latest-launch.log'));
      log.on('error', () => {});
      const child = spawn(javaPath, args, { cwd: gameDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const stdout = child.stdout.pipe(redactStream(identity.accessToken));
      const stderr = child.stderr.pipe(redactStream(identity.accessToken));
      stdout.pipe(log, { end: false }); stderr.pipe(log, { end: false });
      const line = data => this.emit('log', data.toString().slice(-4000));
      stdout.on('data', line); stderr.on('data', line);
      child.on('close', code => { log.end(); this.child = null; this.emit('game-exit', { code }); });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      this.emit('game-start', { version: p.version });
      return { launched: true };
    } finally { this.busy = false; this.controller = null; }
  }
}

module.exports = { Launcher, allowed, expandArgs, safePath, validId, validateProfile, libraryPlan, inspectJava, download, pool, atomicJson, readJson, trustedUrl, extractNatives, host, hashFile, remoteJson, launchIdentity, redactStream };
