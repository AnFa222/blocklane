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
const { gameJavaExecutable, gameEnvironment, jvmMemoryArgs, withoutHeapArgs, liveLogBatch } = require('./launch-policy');
const launcherVersion = require('../package.json').version;
const loaders = require('./loaders');
const mods = require('./mods');
const shaders = require('./shaders');
const resourcepacks = require('./resourcepacks');
const modpacks = require('./modpacks');
const worlds = require('./worlds');
const modpackExport = require('./modpack-export');
const customPacks = require('./custom-packs');
const contentImport = require('./content-import');
const LOCAL_SKIN_MOD = 'idMHQ4n2';
const SETTINGS_DEFAULTS = Object.freeze({
  loggingEnabled: true, launcherDiagnostics: true, autoCheckUpdates: true, launcherVisibility: 'keep', defaultMemory: 4,
  startWithWindows: false, startMinimized: false, minimizeToTray: false, confirmActiveExit: true, rememberPage: true, compactSidebar: false, uiScale: 100, theme: 'dark', reducedMotion: false,
  defaultJava: 'auto', defaultWidth: 1280, defaultHeight: 720, defaultFullscreen: true, defaultJvmArgs: '', defaultGameArgs: '', defaultLoader: 'vanilla', selectLastProfile: true, requireAccountChoice: false,
  downloadConcurrency: 4, downloadLimitMbps: 0, downloadRetries: 3, downloadTimeout: 30, verifyDownloads: true, pauseDownloadsWhilePlaying: false, downloadNotifications: true,
  cacheLimitGb: 10, autoCleanCache: false, removeUnusedLibraries: false, storageWarningGb: 5,
  updateChannel: 'stable', autoDownloadUpdates: false, checkModUpdates: true, checkModpackUpdates: true, checkLoaderUpdates: true, updateNotifyOnly: true,
  maxBackupGb: 20, removeOldBackups: true, backupRetention: 10, backupBeforeLaunch: false, backupBeforeVersionChange: true, backupBeforeContentUpdate: true, backupFrequency: 'manual', backupScreenshots: false, backupConfigs: true, backupContent: true, compressBackups: false, verifyBackups: true,
  autoDependencies: true, askOptionalDependencies: true, allowMissingDependencies: false, releaseChannel: 'stable', autoUpdateMods: false, preserveOldMods: true, detectIncompatibleMods: true, warnDuplicateMods: true, modrinthSort: 'downloads',
  logRetentionDays: 14, redactDiagnostics: true, crashReports: true, networkDiagnostics: false, refreshSessions: true, protectLocalProfiles: true, streamingMode: false, defaultAccount: '',
  limitCpuWhilePlaying: true, pauseCatalogWhilePlaying: true, hardwareAcceleration: true, cacheImages: true, imageCacheMb: 256, reduceMotionWhilePlaying: true,
  notifyLaunchFailure: true, notifyCrash: true, notifyInstall: true, notifyBackup: true, notifyUpdates: true, notifyIncompatibility: true, notificationSound: true, quietWhilePlaying: false
});

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
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com', 'launcher.mojang.com', 'resources.download.minecraft.net', 'libraries.minecraft.net', 'meta.fabricmc.net', 'maven.fabricmc.net', 'meta.quiltmc.org', 'maven.quiltmc.org', 'maven.minecraftforge.net', 'maven.neoforged.net', 'dl.liteloader.com', 'repo.liteloader.com', 'repo.mumfrey.com', 'repo.spongepowered.org', 'api.modrinth.com', 'cdn.modrinth.com'].includes(url.hostname)) throw new Error('Untrusted download host.');
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
  return JSON.parse(await remoteText(url, signal));
}

async function remoteText(url, signal) {
  return network.withRetries(async () => {
    const stream = await response(url, signal);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }, signal);
}

async function hashFileAs(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
async function hashFile(file) { return hashFileAs(file, 'sha1'); }

function downloadChecksum(item) {
  if (/^[a-f0-9]{40}$/.test(item.sha1 || '')) return { algorithm: 'sha1', value: item.sha1 };
  if (/^[a-f0-9]{32}$/.test(item.md5 || '')) return { algorithm: 'md5', value: item.md5 };
  throw new Error('Download is missing a valid checksum.');
}

async function download(item, dest, signal, onProgress = () => {}) {
  signal?.throwIfAborted();
  const checksum = downloadChecksum(item);
  try {
    const stat = await fs.stat(dest);
    if ((!item.size || stat.size === item.size) && await hashFileAs(dest, checksum.algorithm) === checksum.value) { onProgress(stat.size, item.size || stat.size); return; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  return network.withRetries(async () => {
  const temp = dest + '.' + crypto.randomUUID() + '.part';
  try {
    const res = await response(item.url, signal);
    const hash = crypto.createHash(checksum.algorithm);
    let bytes = 0, lastReport = 0;
    onProgress(0, item.size || 0);
    const verifier = new Transform({ transform(chunk, encoding, next) { hash.update(chunk); bytes += chunk.length; const now = Date.now(); if (now - lastReport >= 80 || (item.size && bytes >= item.size)) { lastReport = now; onProgress(bytes, item.size || 0); } next(null, chunk); } });
    await pipeline(res, verifier, createWriteStream(temp), { signal });
    if (hash.digest('hex') !== checksum.value || (item.size != null && bytes !== item.size)) {
      const error = new Error('A download failed its integrity check. Retry to repair it.');
      error.code = 'EINTEGRITY'; throw error;
    }
    await fs.rename(temp, dest);
    onProgress(bytes, item.size || bytes);
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

async function materializeAssets(index, root, signal) {
  const destinations = [];
  if (index.virtual) destinations.push(path.join(root, 'assets', 'virtual', index.id || 'legacy'));
  if (index.map_to_resources) destinations.push(path.join(root, 'resources'));
  if (!destinations.length) return 'objects';
  const entries = Object.entries(index.objects || {});
  await pool(entries, async ([name, asset]) => {
    signal?.throwIfAborted();
    if (!/^[a-f0-9]{40}$/.test(asset.hash || '')) throw new Error('Invalid legacy asset checksum.');
    const source = safePath(path.join(root, 'assets', 'objects'), `${asset.hash.slice(0, 2)}/${asset.hash}`);
    for (const base of destinations) {
      const destination = safePath(base, name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rm(destination, { force: true });
      try { await fs.link(source, destination); }
      catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        await fs.copyFile(source, destination);
      }
    }
  }, signal, 8);
  return index.map_to_resources ? 'resources' : 'virtual';
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

function legacyArguments(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Legacy Minecraft metadata has no launch arguments.');
  const args = []; value.replace(/"([^"]*)"|'([^']*)'|([^\s]+)/g, (_, double, single, bare) => { args.push(double ?? single ?? bare); return ''; });
  return args;
}

function normalizeVersionMetadata(meta) {
  if (meta?.arguments?.jvm && meta?.arguments?.game) return meta;
  if (!meta?.minecraftArguments || !meta.downloads?.client) throw new Error('This Minecraft version uses unsupported legacy launch metadata.');
  return { ...meta, javaVersion: meta.javaVersion || { component: 'jre-legacy', majorVersion: 8 }, arguments: {
    jvm: ['-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}', '-Dminecraft.launcher.version=${launcher_version}', '-cp', '${classpath}'],
    game: legacyArguments(meta.minecraftArguments)
  } };
}

async function enforceExclusiveFullscreen(gameDir) {
  const file = path.join(gameDir, 'options.txt');
  let text = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const set = (key, value) => {
    const line = `${key}:${value}`;
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  };
  set('exclusiveFullscreen', 'true');
  set('fullscreen', 'true');
  await fs.writeFile(file, text, 'utf8');
}

function validateProfile(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 50) throw new Error('Use a profile name between 1 and 50 characters.');
  validId(input.version);
  if (!Number.isInteger(input.memory) || input.memory < 1 || input.memory > 32) throw new Error('Memory must be between 1 and 32 GB.');
  if (typeof input.javaPath !== 'string' || input.javaPath.length > 1024 || input.javaPath.includes('\0')) throw new Error('Invalid Java path.');
  const javaArgs = Array.isArray(input.javaArgs) ? input.javaArgs : [];
  if (javaArgs.length > 40 || javaArgs.some(arg => typeof arg !== 'string' || !arg || arg.length > 500 || /[\0\r\n]/.test(arg) || !arg.startsWith('-') || /^-Xm[ sx]/i.test(arg))) throw new Error('Invalid Java arguments. Enter one non-memory JVM argument per line.');
  const gameArgs = Array.isArray(input.gameArgs) ? input.gameArgs : [];
  if (gameArgs.length > 11 || gameArgs.some(arg => typeof arg !== 'string' || !arg || arg.length > 255 || /[\0\r\n]/.test(arg))) throw new Error('Invalid Minecraft arguments.');
  const takesValue = new Set(['--quickPlaySingleplayer', '--quickPlayMultiplayer', '--quickPlayRealms', '--server', '--port']);
  for (let index = 0; index < gameArgs.length; index++) {
    const arg = gameArgs[index];
    if (arg === '--fullscreen') continue;
    if (!takesValue.has(arg) || !gameArgs[++index] || gameArgs[index].startsWith('--')) throw new Error('Use only the documented Minecraft argument flags, followed by their value on the next line.');
    if (arg === '--port' && !/^[1-9][0-9]{0,4}$/.test(gameArgs[index])) throw new Error('Minecraft server port must be between 1 and 65535.');
    if (arg === '--port' && Number(gameArgs[index]) > 65535) throw new Error('Minecraft server port must be between 1 and 65535.');
  }
  return { id: input.id ? validId(input.id) : crypto.randomUUID(), name: input.name.trim(), version: input.version, memory: input.memory, javaPath: input.javaPath.trim() || 'auto', javaArgs, gameArgs, ...loaders.loaderSettings(input) };
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
  if (session.local && /^[a-f0-9]{32}$/i.test(session.uuid) && /^[A-Za-z0-9_]{1,16}$/.test(session.name)) return session;
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
  constructor(root, emit = () => {}) { this.root = root; this.emit = emit; this.busy = false; this.child = null; this.manifest = null; this.contentTasks = new Map(); this.contentLocks = new Map(); }
  get contentBusy() { return this.contentTasks.size > 0; }
  get working() { return this.busy || this.contentBusy; }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    this.state = await readJson(path.join(this.root, 'state.json'), { profiles: [], selectedProfile: null });
    this.state.settings = { ...SETTINGS_DEFAULTS, ...(this.state.settings || {}) };
    return this.snapshot();
  }
  async snapshot() {
    const versions = await fs.readdir(path.join(this.root, 'versions')).catch(() => []);
    const installed = [];
    for (const id of versions) {
      const marker = await readJson(path.join(this.root, 'versions', id, 'installed.json'), null);
      if (marker) installed.push(marker);
    }
    return { ...this.state, installed, root: this.root, busy: this.working, downloads: this.contentTasks.size, running: Boolean(this.child) };
  }
  async persist() { await atomicJson(path.join(this.root, 'state.json'), this.state); return this.snapshot(); }
  async saveSettings(input) {
    if (!input || typeof input !== 'object') throw new Error('Invalid launcher settings.');
    const next = { ...this.state.settings };
    for (const [key, fallback] of Object.entries(SETTINGS_DEFAULTS)) {
      if (!(key in input)) continue; const value = input[key];
      if (typeof value !== typeof fallback || (typeof value === 'string' && value.length > 1000) || (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > 100000))) throw new Error('Invalid launcher settings.');
      next[key] = value;
    }
    if (!['keep', 'minimize', 'hide'].includes(next.launcherVisibility) || ![2, 4, 6, 8, 12, 16].includes(next.defaultMemory) || !['dark', 'light', 'system'].includes(next.theme) || !['stable', 'beta', 'development'].includes(next.updateChannel) || !['stable', 'beta', 'alpha'].includes(next.releaseChannel)) throw new Error('Invalid launcher settings.');
    this.state.settings = next;
    return this.persist();
  }
  async storageSummary() {
    const categories = [['versions', 'Game versions'], ['libraries', 'Libraries'], ['assets', 'Assets'], ['instances', 'Profiles and worlds'], ['runtimes', 'Java runtimes'], ['backups', 'Backups'], ['modpack-cache', 'Download cache'], ['logs', 'Logs']];
    const sizeOf = async root => { let bytes = 0, files = 0; const pending = [root]; while (pending.length && files < 500000) { const current = pending.pop(); for (const item of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) { const file = path.join(current, item.name); if (item.isDirectory()) pending.push(file); else if (item.isFile()) { files += 1; bytes += (await fs.stat(file).catch(() => ({ size: 0 }))).size; } } } return { bytes, files }; };
    const rows = await Promise.all(categories.map(async ([id, label]) => ({ id, label, ...(await sizeOf(path.join(this.root, id))) })));
    const usedVersions = new Set(); for (const profile of this.state.profiles) { usedVersions.add(profile.version); usedVersions.add(loaders.profileVersionId(profile)); }
    const installed = await fs.readdir(path.join(this.root, 'versions'), { withFileTypes: true }).catch(() => []); const unusedVersions = installed.filter(item => item.isDirectory() && !usedVersions.has(item.name)).map(item => item.name);
    return { root: this.root, totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), categories: rows, unusedVersions };
  }
  async storageDetails(category) {
    const roots = { versions: 'versions', libraries: 'libraries', assets: 'assets', instances: 'instances', runtimes: 'runtimes', backups: 'backups', 'modpack-cache': 'modpack-cache', logs: 'logs' };
    if (!roots[category]) throw new Error('Unknown storage category.'); const base = path.join(this.root, roots[category]);
    const sizeOf = async root => { let bytes = 0, files = 0; const pending = [root]; while (pending.length && files < 500000) { const current = pending.pop(); for (const item of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) { const file = path.join(current, item.name); if (item.isDirectory()) pending.push(file); else if (item.isFile()) { files += 1; bytes += (await fs.stat(file).catch(() => ({ size: 0 }))).size; } } } return { bytes, files }; };
    let entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []), targets = entries.map(item => ({ key: item.name, name: item.name, file: path.join(base, item.name), directory: item.isDirectory() }));
    if (category === 'backups') { targets = []; for (const profile of entries.filter(item => item.isDirectory())) for (const backup of await fs.readdir(path.join(base, profile.name), { withFileTypes: true }).catch(() => [])) if (backup.isDirectory()) targets.push({ key: `${profile.name}/${backup.name}`, name: backup.name.split('__', 2)[1] || backup.name, file: path.join(base, profile.name, backup.name), directory: true }); }
    const usedVersions = new Set(); for (const profile of this.state.profiles) { usedVersions.add(profile.version); usedVersions.add(loaders.profileVersionId(profile)); }
    const profileNames = new Map(this.state.profiles.map(profile => [profile.id, profile.name]));
    const result = await Promise.all(targets.map(async target => { const stat = await fs.stat(target.file), measured = target.directory ? await sizeOf(target.file) : { bytes: stat.size, files: 1 }, orphan = category === 'instances' && !profileNames.has(target.key); const protectedEntry = (category === 'instances' && !orphan) || (category === 'versions' && usedVersions.has(target.key)); return { key: target.key, name: category === 'instances' ? profileNames.get(target.key) || `${target.name} (orphaned profile data)` : target.name, ...measured, modifiedAt: stat.mtime.toISOString(), protected: protectedEntry, orphan, reason: category === 'instances' ? orphan ? 'This folder is not attached to a profile. Inspect, recover, open, or permanently delete it.' : 'Manage this profile and its worlds from Profiles.' : protectedEntry ? 'This version is used by a profile.' : ['assets', 'libraries', 'runtimes'].includes(category) ? 'Minecraft will download this again when required.' : '' }; }));
    return result.sort((a, b) => b.bytes - a.bytes);
  }
  async deleteStorageItem(category, key) {
    if (this.working || this.child) throw new Error('Close Minecraft and wait for downloads before deleting storage.');
    if (typeof key !== 'string' || !key || key.includes('\\') || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid storage item.');
    const details = await this.storageDetails(category), item = details.find(entry => entry.key === key); if (!item) throw new Error('Storage item was not found.'); if (item.protected) throw new Error(item.reason || 'This item is protected.');
    const roots = { versions: 'versions', libraries: 'libraries', assets: 'assets', instances: 'instances', runtimes: 'runtimes', backups: 'backups', 'modpack-cache': 'modpack-cache', logs: 'logs' }; const root = roots[category]; if (!root) throw new Error('This storage category cannot be deleted here.');
    const target = path.resolve(this.root, root, ...key.split('/')), base = path.resolve(this.root, root); if (!target.startsWith(base + path.sep)) throw new Error('Invalid storage item.'); await fs.rm(target, { recursive: true, force: true }); return this.storageDetails(category);
  }
  async inspectOrphan(id) {
    validId(id); if (this.state.profiles.some(profile => profile.id === id)) throw new Error('This folder belongs to an active profile.'); const root = path.join(this.root, 'instances', id); await fs.access(root).catch(() => { throw new Error('Orphaned profile data was not found.'); });
    const entries = await fs.readdir(root, { withFileTypes: true }), folders = []; for (const item of entries) { const file = path.join(root, item.name); if (item.isDirectory()) folders.push({ name: item.name, size: await worlds.directorySize(file) }); else if (item.isFile()) folders.push({ name: item.name, size: (await fs.stat(file)).size }); }
    const savedWorlds = await worlds.list(path.join(root, 'saves')); return { id, worlds: savedWorlds.map(world => ({ name: world.displayName || world.name, folder: world.name, version: world.gameVersion, size: world.size })), entries: folders.sort((a, b) => b.size - a.size) };
  }
  async recoverOrphan(id, name, version) {
    if (this.working || this.child) throw new Error('Close Minecraft and wait for downloads before recovering a profile.'); validId(id); if (this.state.profiles.some(profile => profile.id === id)) throw new Error('This folder already belongs to a profile.'); await fs.access(path.join(this.root, 'instances', id)).catch(() => { throw new Error('Orphaned profile data was not found.'); });
    const catalog = await this.catalog(); if (!catalog.versions.some(item => item.id === version)) throw new Error('Choose an official Minecraft version.'); const profile = validateProfile({ id, name, version, memory: this.state.settings.defaultMemory, javaPath: this.state.settings.defaultJava, javaArgs: [], gameArgs: [], loader: 'vanilla', loaderVersion: '' });
    this.state.profiles.push(profile); this.state.selectedProfile = id; return this.persist();
  }
  orphanFolder(id) { validId(id); if (this.state.profiles.some(profile => profile.id === id)) throw new Error('This folder belongs to an active profile.'); return path.join(this.root, 'instances', id); }
  async clearStorageCache() {
    if (this.working || this.child) throw new Error('Close Minecraft and wait for downloads before cleaning storage.');
    for (const name of ['modpack-cache', 'world-staging', 'modpack-staging']) await fs.rm(path.join(this.root, name), { recursive: true, force: true });
    return this.storageSummary();
  }
  async removeUnusedVersions() {
    if (this.working || this.child) throw new Error('Close Minecraft and wait for downloads before cleaning storage.');
    const summary = await this.storageSummary(); for (const id of summary.unusedVersions) { try { validId(id); } catch { continue; } await fs.rm(safePath(path.join(this.root, 'versions'), id), { recursive: true, force: true }); }
    return this.storageSummary();
  }
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
    if (this.working || this.child) throw new Error('Wait for the installation or game to finish before editing profiles.');
    const profile = validateProfile(input);
    const catalog = await this.catalog();
    if (!catalog.versions.some(v => v.id === profile.version)) throw new Error('Choose a version from the official catalog.');
    if (profile.loader !== 'vanilla' && !(await this.loaderVersions(profile.loader, profile.version)).some(v => v.version === profile.loaderVersion)) throw new Error('Choose a compatible loader version from the list.');
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
    if (this.child || this.working) throw new Error('Wait for the current operation to finish.');
    this.state.profiles = this.state.profiles.filter(p => p.id !== id);
    if (this.state.selectedProfile === id) this.state.selectedProfile = this.state.profiles[0]?.id || null;
    return this.persist();
  }
  profile(id) { const profile = this.state.profiles.find(item => item.id === id); if (!profile) throw new Error('Profile does not exist.'); return profile; }
  async cloneProfile(id, name) {
    if (this.child || this.working) throw new Error('Wait for the current operation to finish.');
    const source = this.profile(id), copy = { ...source, id: crypto.randomUUID(), name: String(name || `${source.name} copy`).trim(), servers: [...(source.servers || [])] };
    if (!copy.name || copy.name.length > 50) throw new Error('Use a profile name between 1 and 50 characters.');
    const from = path.join(this.root, 'instances', source.id), to = path.join(this.root, 'instances', copy.id);
    await fs.cp(from, to, { recursive: true, force: false, errorOnExist: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
    this.state.profiles.push(copy); this.state.selectedProfile = copy.id; return this.persist();
  }
  async worlds(id) { const profile = this.profile(id); return worlds.list(path.join(this.root, 'instances', profile.id, 'saves')); }
  async importWorldFolders(id, folders) {
    if (this.child || this.working) throw new Error('Close Minecraft before importing worlds.');
    const profile = this.profile(id); if (!Array.isArray(folders) || !folders.length || folders.some(folder => typeof folder !== 'string')) throw new Error('Choose a world folder.');
    return { imported: await worlds.copyFolders(folders, path.join(this.root, 'instances', profile.id, 'saves')) };
  }
  async importWorldZip(id, archive) {
    if (this.child || this.working) throw new Error('Close Minecraft before importing worlds.');
    const profile = this.profile(id); if (typeof archive !== 'string' || path.extname(archive).toLowerCase() !== '.zip') throw new Error('Choose a ZIP archive.');
    const staging = path.join(this.root, 'world-staging', crypto.randomUUID());
    return { imported: await worlds.importZip(archive, path.join(this.root, 'instances', profile.id, 'saves'), staging) };
  }
  async transferWorlds(sourceId, destinationId, names, move = false) {
    if (this.child || this.working) throw new Error('Close Minecraft before transferring worlds.');
    const source = this.profile(sourceId), destination = this.profile(destinationId); if (source.id === destination.id) throw new Error('Choose a different destination profile.');
    const transferred = await worlds.transfer(path.join(this.root, 'instances', source.id, 'saves'), path.join(this.root, 'instances', destination.id, 'saves'), names, Boolean(move));
    return { transferred, moved: Boolean(move), destinationId: destination.id };
  }
  async deleteWorlds(id, names) {
    if (this.child || this.working) throw new Error('Close Minecraft before deleting worlds.');
    const profile = this.profile(id); return { removed: await worlds.remove(path.join(this.root, 'instances', profile.id, 'saves'), names) };
  }
  async backupProfile(id, name = '') {
    if (this.child || this.working) throw new Error('Wait for the current operation to finish.');
    const profile = this.profile(id), source = path.join(this.root, 'instances', profile.id, 'saves');
    const label = String(name || 'World backup').trim(); if (!label || label.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(label)) throw new Error('Backup names must be 1–80 characters and cannot contain Windows file characters.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const folder = `${stamp}__${label.replace(/\s+/g, ' ')}`; const destination = path.join(this.root, 'backups', profile.id, folder, 'saves');
    await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true }).catch(error => { if (error.code === 'ENOENT') throw new Error('This profile has no worlds to back up yet.'); throw error; });
    return { profileId: profile.id, path: destination, createdAt: new Date().toISOString(), name: label };
  }
  async backupWorlds(id, names, name = 'Before upgrade') {
    if (this.child || this.working) throw new Error('Close Minecraft before backing up worlds.');
    const profile = this.profile(id), source = path.join(this.root, 'instances', profile.id, 'saves');
    const label = String(name || 'Before upgrade').trim(); if (!label || label.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(label)) throw new Error('Backup names must be 1–80 characters and cannot contain Windows file characters.');
    if (!Array.isArray(names) || !names.length) throw new Error('Choose at least one world.');
    const available = new Set((await worlds.list(source)).map(world => world.name));
    const selected = names.map(worlds.worldName); if (selected.some(world => !available.has(world))) throw new Error('One or more selected worlds could not be found.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const folder = `${stamp}__${label.replace(/\s+/g, ' ')}`; const destination = path.join(this.root, 'backups', profile.id, folder, 'saves');
    await fs.mkdir(destination, { recursive: true });
    try { for (const world of selected) await fs.cp(path.join(source, world), path.join(destination, world), { recursive: true, force: false, errorOnExist: true }); }
    catch (error) { await fs.rm(path.dirname(destination), { recursive: true, force: true }); throw error; }
    return { profileId: profile.id, path: destination, createdAt: new Date().toISOString(), name: label, worlds: selected };
  }
  async backups(id) { const profile = this.profile(id), root = path.join(this.root, 'backups', profile.id); const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []); return (await Promise.all(entries.filter(item => item.isDirectory()).map(async item => { const [stamp, savedName] = item.name.split('__', 2), stat = await fs.stat(path.join(root, item.name)); return { id: item.name, name: savedName || 'World backup', createdAt: stat.birthtime.toISOString(), worlds: (await fs.readdir(path.join(root, item.name, 'saves'), { withFileTypes: true }).catch(() => [])).filter(world => world.isDirectory()).map(world => world.name) }; }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async restoreBackup(id, backupId, worlds = null) {
    if (this.child || this.working) throw new Error('Close Minecraft before restoring a backup.');
    const profile = this.profile(id); if (typeof backupId !== 'string' || !/^[^\\/:*?"<>|]+$/.test(backupId)) throw new Error('Invalid backup.');
    const source = path.join(this.root, 'backups', profile.id, backupId, 'saves'); await fs.access(source).catch(() => { throw new Error('Backup worlds could not be found.'); });
    const available = (await fs.readdir(source, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name);
    const selected = worlds == null ? available : worlds; if (!Array.isArray(selected) || !selected.length || selected.some(world => typeof world !== 'string' || !available.includes(world))) throw new Error('Choose at least one world from this backup.');
    const current = path.join(this.root, 'instances', profile.id, 'saves'); if (await fs.access(current).then(() => true).catch(() => false)) await this.backupProfile(id, 'Pre-restore backup');
    await fs.mkdir(current, { recursive: true }); for (const world of selected) { await fs.rm(path.join(current, world), { recursive: true, force: true }); await fs.cp(path.join(source, world), path.join(current, world), { recursive: true }); } return { restored: true, worlds: selected };
  }
  async deleteBackup(id, backupId) { const profile = this.profile(id); if (typeof backupId !== 'string' || !/^[^\\/:*?"<>|]+$/.test(backupId)) throw new Error('Invalid backup.'); const target = path.join(this.root, 'backups', profile.id, backupId); await fs.rm(target, { recursive: true, force: true }); return this.backups(id); }
  async screenshots(id) { const profile = this.profile(id), root = path.join(this.root, 'instances', profile.id, 'screenshots'); const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []); const images = entries.filter(item => item.isFile() && /\.(png|jpe?g)$/i.test(item.name)).slice(-40).reverse(); return Promise.all(images.map(async item => { const file = path.join(root, item.name), stat = await fs.stat(file); if (stat.size > 15 * 1024 * 1024) return { name: item.name, size: stat.size, skipped: true }; const ext = path.extname(item.name).toLowerCase() === '.png' ? 'png' : 'jpeg'; return { name: item.name, size: stat.size, dataUrl: `data:image/${ext};base64,${(await fs.readFile(file)).toString('base64')}` }; })); }
  async servers(id, next) {
    const profile = this.profile(id); if (next === undefined) return profile.servers || [];
    if (!Array.isArray(next) || next.length > 50 || next.some(server => !server || typeof server.name !== 'string' || typeof server.address !== 'string' || server.name.length > 50 || server.address.length > 255)) throw new Error('Invalid saved servers.');
    profile.servers = next.map(server => ({ name: server.name.trim(), address: server.address.trim() })).filter(server => server.name && server.address); await this.persist(); return profile.servers;
  }
  async launchServer(profileId, accountId, address) {
    const value = String(address || '').trim(); if (!value || value.length > 255 || /\s/.test(value)) throw new Error('Enter a valid server address.');
    let host = value, port = null; const match = value.match(/^(.+):(\d{1,5})$/); if (match) { host = match[1]; port = Number(match[2]); if (port < 1 || port > 65535) throw new Error('Server port must be between 1 and 65535.'); }
    return this.launch(profileId, accountId, ['--server', host, ...(port ? ['--port', String(port)] : [])]);
  }
  progress(message, done = 0, total = 1) { this.emit('progress', { message, done, total }); }
  cancel() { this.controller?.abort(new Error('Installation cancelled. Downloaded files are kept for retry.')); for (const controller of this.contentTasks.values()) controller.abort(new Error('Download cancelled.')); }
  loaderIO() { return { allowed, trustedUrl, validId, safePath, readJson, atomicJson, hashFile, download, remoteJson, remoteText, pool, withLock: (key, task) => this.withContentLock(key, task) }; }
  async withContentLock(key, task) {
    const previous = this.contentLocks.get(key) || Promise.resolve(); let release;
    const gate = new Promise(resolve => { release = resolve; }), tail = previous.then(() => gate);
    this.contentLocks.set(key, tail); await previous;
    try { return await task(); }
    finally { release(); if (this.contentLocks.get(key) === tail) this.contentLocks.delete(key); }
  }
  async runContentTask(kind, profileId, projectId, task) {
    if (this.busy || this.child) throw new Error('Wait for the current operation or game to finish.');
    const key = `${kind}:${profileId}:${projectId}`;
    if (this.contentTasks.has(key)) throw new Error('This item is already downloading.');
    const controller = new AbortController(); this.contentTasks.set(key, controller);
    const report = (message, doneBytes = 0, totalBytes = 0, status = 'downloading') => this.emit('content-progress', { key, kind, profileId, projectId, message, doneBytes, totalBytes, status });
    report('Finding a compatible file…', 0, 0, 'resolving');
    try {
      const result = await task(controller.signal, report);
      report('Installed', 1, 1, 'complete'); return result;
    } catch (error) { report(error.message, 0, 0, 'failed'); throw error; }
    finally { this.contentTasks.delete(key); }
  }
  async loaderVersions(loader, version) {
    validId(version);
    return loaders.versions(loader, version, this.loaderIO());
  }
  async installProfile(profileId) {
    if (this.working || this.child) throw new Error('Wait for the current operation to finish.');
    const profile = this.state.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Choose a profile first.');
    await this.install(profile.version);
    if ((profile.loader || 'vanilla') === 'vanilla') return this.snapshot();
    this.busy = true; this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const id = loaders.profileVersionId(profile); validId(id);
      await fs.rm(path.join(this.root, 'versions', id, 'installed.json'), { force: true });
      const base = await readJson(path.join(this.root, 'versions', profile.version, `${profile.version}.json`));
      const javaPath = await this.ensureJava(base, signal);
      await loaders.install(profile, this.root, base, javaPath, this.loaderIO(), signal, (message, done, total) => this.progress(message, done, total));
    } finally { this.busy = false; this.controller = null; }
    return this.snapshot();
  }
  modProfile(profileId) {
    const profile = this.state.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Profile does not exist.');
    mods.profileLoader(profile);
    return profile;
  }
  modsDir(profile) { return path.join(this.root, 'instances', profile.id, 'mods'); }
  shaderpacksDir(profile) { return path.join(this.root, 'instances', profile.id, 'shaderpacks'); }
  resourcepacksDir(profile) { return path.join(this.root, 'instances', profile.id, 'resourcepacks'); }
  async modSearch(profileId, query = '', offset = 0) { const p = this.modProfile(profileId); return mods.search(p, query, offset, this.loaderIO()); }
  async modDetails(profileId, projectId) { const p = this.modProfile(profileId); return mods.project(projectId, this.loaderIO()); }
  async modList(profileId) { const p = this.modProfile(profileId); return mods.list(p, this.modsDir(p), this.loaderIO()); }
  async modInstall(profileId, projectId, allowMissingDependencies = false) {
    const p = this.modProfile(profileId), dir = this.modsDir(p);
    return this.runContentTask('mod', profileId, projectId, async (signal, report) => this.withContentLock(`mods:${dir}`, async () => {
      report('Preparing mod and dependencies…', 0, 0, 'resolving');
      const installed = await mods.installProject(p, projectId, dir, this.loaderIO(), signal, report, { allowMissingDependencies: Boolean(allowMissingDependencies) });
      return { ...await this.modList(profileId), warnings: installed.missingDependencies };
    }));
  }
  async modEnable(profileId, projectId, enabled) {
    if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.');
    const p = this.modProfile(profileId); return mods.setEnabled(p, this.modsDir(p), projectId, Boolean(enabled), this.loaderIO());
  }
  async modRemove(profileId, projectId) {
    if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.');
    const p = this.modProfile(profileId); return mods.remove(p, this.modsDir(p), projectId, this.loaderIO());
  }
  async modUpdates(profileId) { const p = this.modProfile(profileId); return mods.updates(p, this.modsDir(p), this.loaderIO()); }
  async modUpdateAll(profileId) {
    if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.');
    const p = this.modProfile(profileId), available = await mods.updates(p, this.modsDir(p), this.loaderIO());
    this.busy = true; this.controller = new AbortController();
    try { for (const update of available) await mods.installProject(p, update.projectId, this.modsDir(p), this.loaderIO(), this.controller.signal, message => this.progress(message)); }
    finally { this.busy = false; this.controller = null; }
    return this.modList(profileId);
  }
  async importContent(profileId, kind, files) { if (this.child || this.working) throw new Error('Wait for the current operation or game to finish.'); const profile = this.profile(profileId); return { imported: await contentImport.importFiles(path.join(this.root, 'instances', profile.id), kind, files) }; }
  async shaderStatus(profileId) { const p = this.modProfile(profileId); return shaders.adapter(p, await this.modList(profileId)); }
  async shaderSearch(profileId, query = '', offset = 0) { const p = this.modProfile(profileId), selected = await this.shaderStatus(profileId); return shaders.search(p, selected, query, offset, this.loaderIO()); }
  async shaderList(profileId) { const p = this.modProfile(profileId); return shaders.list(p, this.shaderpacksDir(p), this.loaderIO()); }
  async shaderInstall(profileId, projectId) {
    const p = this.modProfile(profileId), selected = await this.shaderStatus(profileId);
    return this.runContentTask('shader', profileId, projectId, (signal, report) => shaders.install(p, selected, projectId, this.shaderpacksDir(p), this.loaderIO(), signal, report));
  }
  async shaderEnable(profileId, projectId, enabled) { if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.'); const p = this.modProfile(profileId); return shaders.setEnabled(p, this.shaderpacksDir(p), projectId, Boolean(enabled), this.loaderIO()); }
  async shaderRemove(profileId, projectId) { if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.'); const p = this.modProfile(profileId); return shaders.remove(p, this.shaderpacksDir(p), projectId, this.loaderIO()); }
  async resourcepackSearch(profileId, query = '', offset = 0) { const p = this.modProfile(profileId); return resourcepacks.search(p, query, offset, this.loaderIO()); }
  async resourcepackList(profileId) { const p = this.modProfile(profileId); return resourcepacks.list(p, this.resourcepacksDir(p), this.loaderIO()); }
  async resourcepackInstall(profileId, projectId) { const p = this.modProfile(profileId); return this.runContentTask('resourcepack', profileId, projectId, (signal, report) => resourcepacks.install(p, projectId, this.resourcepacksDir(p), this.loaderIO(), signal, report)); }
  async resourcepackEnable(profileId, projectId, enabled) { if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.'); const p = this.modProfile(profileId); return resourcepacks.setEnabled(p, this.resourcepacksDir(p), projectId, Boolean(enabled), this.loaderIO()); }
  async resourcepackRemove(profileId, projectId) { if (this.working || this.child) throw new Error('Wait for the current operation or game to finish.'); const p = this.modProfile(profileId); return resourcepacks.remove(p, this.resourcepacksDir(p), projectId, this.loaderIO()); }
  async modpackSearch(query = '', offset = 0) { return modpacks.search(query, offset, this.loaderIO()); }
  async modpackDetails(projectId) { return modpacks.project(projectId, this.loaderIO()); }
  async modpackList() { return this.state.profiles.filter(profile => profile.modpack).map(profile => ({ profileId: profile.id, profileName: profile.name, version: profile.version, loader: profile.loader, ...profile.modpack })); }
  async modpackInstall(projectId, profileId = null) {
    projectId = modpacks.id(projectId); if (profileId) validId(profileId);
    return this.runContentTask('modpack', profileId || 'new', projectId, (signal, report) => this.withContentLock('modpacks', async () => {
      const info = await modpacks.project(projectId, this.loaderIO(), signal), versions = await modpacks.versions(projectId, this.loaderIO(), signal);
      const version = versions.find(item => item.version_type === 'release') || versions[0]; if (!version) throw new Error('This Modrinth project has no installable modpack version.');
      const file = modpacks.packFile(version), archive = path.join(this.root, 'modpack-cache', `${version.id}.mrpack`);
      report(`Downloading ${info.title}`, 0, file.size || 0, 'downloading');
      await download({ url: file.url, sha1: file.hashes.sha1.toLowerCase(), size: file.size }, archive, signal, (done, total) => report(`Downloading ${info.title}`, done, total, 'downloading'));
      return this.installModpackArchive(archive, { source: 'modrinth', projectId, versionId: version.id, versionNumber: String(version.version_number || ''), title: info.title, slug: info.slug, iconUrl: info.iconUrl }, profileId, signal, report);
    }));
  }
  async modpackImport(file) {
    if (typeof file !== 'string' || !['.mrpack', '.zip'].includes(path.extname(file).toLowerCase())) throw new Error('Choose a Modrinth .mrpack or supported modpack ZIP file.');
    const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 2 * 1024 * 1024 * 1024) throw new Error('The modpack file is too large.');
    const taskId = crypto.createHash('sha256').update(file).digest('hex').slice(0, 12);
    return this.runContentTask('modpack', 'new', taskId, (signal, report) => this.withContentLock('modpacks', () => this.installModpackArchive(file, { source: 'local' }, null, signal, report)));
  }
  async installModpackArchive(archive, metadata, profileId, signal, report) {
    const io = this.loaderIO(), staging = path.join(this.root, 'modpack-staging', crypto.randomUUID());
    try {
      const staged = await modpacks.stagePack(archive, staging, io, signal, report), spec = modpacks.profileSpec(staged.index), catalog = await this.catalog();
      if (!catalog.versions.some(item => item.id === spec.version)) throw new Error(`Minecraft ${spec.version} is not in Mojang's official catalog.`);
      if (spec.loader !== 'vanilla') {
        const available = await this.loaderVersions(spec.loader, spec.version), match = available.find(item => item.version === spec.loaderVersion) || available.find(item => item.version.endsWith(`-${spec.loaderVersion}`));
        if (!match) throw new Error(`${spec.loader} ${spec.loaderVersion} is unavailable for Minecraft ${spec.version}.`); spec.loaderVersion = match.version;
      }
      const existing = profileId ? this.profile(profileId) : null;
      if (existing && (!existing.modpack || metadata.projectId !== existing.modpack.projectId)) throw new Error('This profile belongs to a different modpack.');
      const profile = validateProfile({ ...spec, id: existing?.id }); profile.id ||= crypto.randomUUID();
      const instance = path.join(this.root, 'instances', profile.id), prior = await modpacks.readManifest(instance, io), oldManaged = prior?.managedFiles || [];
      await fs.mkdir(instance, { recursive: true }); await modpacks.applyStaging(instance, staging, oldManaged, staged.managed, Boolean(existing));
      const pack = { ...metadata, format: staged.format || 'modrinth', title: metadata.title || staged.index.name, versionName: staged.index.versionId || metadata.versionNumber || '', installedAt: new Date().toISOString() };
      await modpacks.writeManifest(instance, { schema: 1, pack, managedFiles: staged.managed }, io);
      profile.modpack = pack;
      if (existing) this.state.profiles[this.state.profiles.findIndex(item => item.id === existing.id)] = { ...existing, ...profile }; else this.state.profiles.push(profile);
      this.state.selectedProfile = profile.id; await this.persist(); report(`${pack.title} is ready`, 1, 1, 'complete'); return { state: await this.snapshot(), profileId: profile.id, pack };
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async modpackUpdate(profileId) { const profile = this.profile(profileId); if (!profile.modpack?.projectId) throw new Error('Local modpacks cannot be updated from Modrinth.'); return this.modpackInstall(profile.modpack.projectId, profileId); }
  async modpackRemove(profileId) {
    if (this.working || this.child) throw new Error('Wait for the current operation to finish.'); const profile = this.profile(profileId); if (!profile.modpack) throw new Error('This profile is not a managed modpack.');
    const instance = path.join(this.root, 'instances', profile.id), manifest = await modpacks.readManifest(instance, this.loaderIO());
    for (const relative of manifest?.managedFiles || []) if (!modpacks.protectedPath(relative)) await fs.rm(path.join(instance, ...modpacks.safePackPath(relative).split('/')), { force: true });
    await fs.rm(path.join(instance, '.blocklane', 'modpack.json'), { force: true }); this.state.profiles = this.state.profiles.filter(item => item.id !== profileId); if (this.state.selectedProfile === profileId) this.state.selectedProfile = this.state.profiles[0]?.id || null; return this.persist();
  }
  async customPackList() { return customPacks.list(this.root); }
  async customPackCreate(input) {
    if (this.child || this.working) throw new Error('Wait for the current operation to finish.');
    const pack = customPacks.validate(input), catalog = await this.catalog(); if (!catalog.versions.some(item => item.id === pack.version)) throw new Error('Choose a version from the official catalog.');
    if (pack.loader !== 'vanilla' && !(await this.loaderVersions(pack.loader, pack.version)).some(item => item.version === pack.loaderVersion)) throw new Error('Choose a compatible loader version.');
    return customPacks.save(this.root, pack);
  }
  async customPackDelete(id) { if (this.child || this.working) throw new Error('Wait for the current operation to finish.'); await customPacks.remove(this.root, validId(id)); return this.customPackList(); }
  async customPackExport(id, destination) {
    if (this.child || this.working) throw new Error('Wait for the current operation to finish.'); const pack = await customPacks.get(this.root, validId(id));
    return modpackExport.exportPack(pack, path.join(customPacks.root(this.root, pack.id), 'instance'), destination, pack);
  }
  async customPackModSearch(id, query = '', offset = 0) { const pack = await customPacks.get(this.root, validId(id)); return mods.search(pack, query, offset, this.loaderIO()); }
  async customPackModList(id) { const pack = await customPacks.get(this.root, validId(id)); return mods.list(pack, path.join(customPacks.root(this.root, pack.id), 'instance', 'mods'), this.loaderIO()); }
  async customPackModInstall(id, projectId) {
    const pack = await customPacks.get(this.root, validId(id)), dir = path.join(customPacks.root(this.root, pack.id), 'instance', 'mods');
    return this.runContentTask('custom-mod', pack.id, projectId, async (signal, report) => this.withContentLock(`mods:${dir}`, async () => { await mods.installProject(pack, projectId, dir, this.loaderIO(), signal, report); return this.customPackModList(pack.id); }));
  }
  async customPackModRemove(id, projectId) { if (this.working || this.child) throw new Error('Wait for the current operation to finish.'); const pack = await customPacks.get(this.root, validId(id)), dir = path.join(customPacks.root(this.root, pack.id), 'instance', 'mods'); return mods.remove(pack, dir, projectId, this.loaderIO()); }
  async prepareLocalSkin(profile, identity, gameDir, signal) {
    if (!identity.local) return { active: false, supported: true };
    const source = path.join(this.root, 'skins', `${identity.uuid}.png`);
    const bytes = await fs.readFile(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!bytes) return { active: false, supported: true };
    if (bytes.length > 1024 * 1024 || bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== 64 || ![32, 64].includes(bytes.readUInt32BE(20))) throw new Error('The active local skin is damaged. Apply it again from the Skins tab.');
    const destination = path.join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', `${identity.name}.png`);
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes);
    if ((profile.loader || 'vanilla') === 'vanilla') return { active: true, supported: false };
    const current = await mods.list(profile, this.modsDir(profile), this.loaderIO());
    const managed = current.installed.find(mod => mod.projectId === LOCAL_SKIN_MOD);
    const manual = current.local.some(mod => mod.enabled && /custom.?skin.?loader/i.test(mod.filename));
    if (managed?.enabled === false && !managed.missing) await mods.setEnabled(profile, this.modsDir(profile), LOCAL_SKIN_MOD, true, this.loaderIO());
    else if (!manual && (!managed || managed.missing)) {
      this.progress('Installing local skin support', 0, 1);
      try { await mods.installProject(profile, LOCAL_SKIN_MOD, this.modsDir(profile), this.loaderIO(), signal, message => this.progress(message)); }
      catch (error) { this.emit('log', `Local skin support is unavailable for ${profile.loader} ${profile.version}: ${error.message}`); return { active: true, supported: false }; }
      this.progress('Local skin support is ready', 1, 1);
    }
    return { active: true, supported: true };
  }
  async ensureJava(meta, signal) {
    return ensureRuntime(meta, path.join(this.root, 'runtimes'), path.join(__dirname, '..', 'runtimes'),
      { safePath, readJson, hashFile, inspectJava, remoteJson, download, pool, atomicJson }, signal,
      (message, done, total) => this.progress(message, done, total));
  }
  async install(id) {
    validId(id);
    if (this.working || this.child) throw new Error('Wait for the current operation to finish.');
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
      const meta = normalizeVersionMetadata(await readJson(metaFile));
      await atomicJson(metaFile, meta);
      // An interrupted repair must never leave a completed marker behind.
      await fs.rm(path.join(versionDir, 'installed.json'), { force: true });
      await this.ensureJava(meta, signal);
      const plan = libraryPlan(meta, this.root);
      const indexPath = safePath(path.join(this.root, 'assets', 'indexes'), validId(meta.assetIndex.id) + '.json');
      await download(meta.assetIndex, indexPath, signal);
      const assetIndex = await readJson(indexPath);
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
      await pool(unique, async job => { await download(job, job.dest, signal); this.progress(`Installing ${id}`, ++done, unique.length); }, signal, this.state.settings.downloadConcurrency || 4);
      if (assetIndex.virtual || assetIndex.map_to_resources) {
        this.progress('Preparing legacy assets', 0, 1);
        meta.assetLayout = await materializeAssets({ ...assetIndex, id: meta.assetIndex.id }, this.root, signal);
        await atomicJson(metaFile, meta);
      }
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
    if (this.working || this.child) throw new Error('Wait for the current operation to finish.');
    await fs.rm(safePath(path.join(this.root, 'versions'), id), { recursive: true, force: true });
    return this.snapshot();
  }
  async launch(profileId, accountId = 'demo', launchGameArgs = null) {
    if (this.working || this.child) throw new Error('A game or installation is already running.');
    const p = this.state.profiles.find(p => p.id === profileId);
    if (!p) throw new Error('Create or select a profile first.');
    if (this.state.settings.backupBeforeLaunch) {
      const saves = path.join(this.root, 'instances', p.id, 'saves');
      if ((await fs.readdir(saves, { withFileTypes: true }).catch(() => [])).some(item => item.isDirectory())) await this.backupProfile(p.id, 'Automatic pre-launch backup');
    }
    this.busy = true;
    this.controller = new AbortController();
    try {
      const launchId = loaders.profileVersionId(p);
      const dir = path.join(this.root, 'versions', launchId);
      const installed = await readJson(path.join(dir, 'installed.json'), null);
      if (!installed) throw new Error('Install this profile’s version first.');
      const meta = await readJson(path.join(dir, `${launchId}.json`));
      const baseVersion = meta.baseVersion || p.version;
      const baseDir = path.join(this.root, 'versions', baseVersion);
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
      const classpath = [...new Set([...plan.artifacts.map(a => a.dest), path.join(baseDir, `${baseVersion}.jar`)])];
      for (const file of classpath) await fs.access(file).catch(() => { throw new Error('Game files are missing. Repair the version in the Versions tab.'); });
      const gameDir = path.join(this.root, 'instances', p.id);
      await fs.mkdir(gameDir, { recursive: true });
      await enforceExclusiveFullscreen(gameDir);
      await resourcepacks.normalize(this.resourcepacksDir(p), this.loaderIO());
      const localSkin = await this.prepareLocalSkin(p, identity, gameDir, this.controller.signal);
      if (localSkin.active && !localSkin.supported) this.emit('log', 'Local skin support is unavailable for this profile. Minecraft will use its default offline skin.');
      const values = {
        natives_directory: path.join(baseDir, 'natives'), launcher_name: 'Blocklane', launcher_version: launcherVersion,
        classpath: classpath.join(path.delimiter), classpath_separator: path.delimiter, library_directory: path.join(this.root, 'libraries'),
        auth_player_name: identity.name, version_name: launchId, game_directory: gameDir, assets_root: path.join(this.root, 'assets'),
        assets_index_name: meta.assetIndex.id, game_assets: meta.assetLayout === 'resources' ? path.join(this.root, 'resources') : path.join(this.root, 'assets', 'virtual', meta.assetIndex.id),
        auth_uuid: identity.uuid, auth_access_token: identity.accessToken, auth_session: `token:${identity.accessToken}:${identity.uuid}`,
        clientid: identity.clientId, auth_xuid: identity.xuid, user_type: 'msa', version_type: meta.type, user_properties: '{}',
        resolution_width: String(this.state.settings.defaultWidth || 1280), resolution_height: String(this.state.settings.defaultHeight || 720)
      };
      const features = { is_demo_user: identity.demo, has_custom_resolution: true };
      const jvm = withoutHeapArgs(expandArgs(meta.arguments.jvm, values, features));
      const loggingEnabled = this.state.settings?.loggingEnabled !== false;
      if (meta.logging?.client) jvm.push(meta.logging.client.argument.replace('${path}', safePath(path.join(this.root, 'assets', 'log_configs'), meta.logging.client.file.id)));
      const game = expandArgs(meta.arguments.game, values, features);
      if (identity.demo && !game.includes('--demo')) game.push('--demo');
      const args = [...jvmMemoryArgs(p.memory, java.major), ...(p.javaArgs || []), ...jvm, meta.mainClass, ...game, ...(launchGameArgs || p.gameArgs || [])];
      let log = null;
      if (loggingEnabled) {
        const logDir = path.join(this.root, 'logs'); await fs.mkdir(logDir, { recursive: true });
        log = createWriteStream(path.join(logDir, 'latest-launch.log')); log.on('error', () => {});
      }
      const gameJava = await gameJavaExecutable(javaPath);
      const child = spawn(gameJava, args, { cwd: gameDir, windowsHide: true, env: gameEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let liveLog = null;
      if (loggingEnabled) {
        const stdout = child.stdout.pipe(redactStream(identity.accessToken));
        const stderr = child.stderr.pipe(redactStream(identity.accessToken));
        stdout.pipe(log, { end: false }); stderr.pipe(log, { end: false });
        liveLog = liveLogBatch(text => this.emit('log', text), 1000, 4096);
        stdout.on('data', liveLog.push); stderr.on('data', liveLog.push);
      } else {
        // Preserve the 0.4.20 child stream setup, discarding output when logging is off.
        child.stdout.resume(); child.stderr.resume();
      }
      child.on('close', code => { liveLog?.flush(); log?.end(); this.child = null; this.emit('game-exit', { code }); });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      this.emit('game-start', { version: p.version });
      return { launched: true };
    } finally { this.busy = false; this.controller = null; }
  }
}

module.exports = { Launcher, allowed, expandArgs, safePath, validId, validateProfile, libraryPlan, legacyArguments, normalizeVersionMetadata, enforceExclusiveFullscreen, materializeAssets, inspectJava, download, pool, atomicJson, readJson, trustedUrl, extractNatives, host, hashFile, remoteJson, launchIdentity, redactStream };

