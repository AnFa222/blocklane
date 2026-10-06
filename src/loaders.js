const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { gameEnvironment } = require('./launch-policy');
const run = promisify(execFile);
const TYPES = ['vanilla', 'fabric', 'forge', 'neoforge'];
const MAVEN = {
  forge: 'https://maven.minecraftforge.net/net/minecraftforge/forge/',
  neoforge: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/'
};
function loaderSettings(profile) {
  const loader = profile.loader || 'vanilla', loaderVersion = profile.loaderVersion || '';
  if (!TYPES.includes(loader)) throw new Error('Choose Vanilla, Fabric, Forge, or NeoForge.');
  if (loader !== 'vanilla' && !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,100}$/.test(loaderVersion)) throw new Error('Choose a compatible loader version.');
  return { loader, loaderVersion: loader === 'vanilla' ? '' : loaderVersion };
}
function profileVersionId(profile) {
  const { loader, loaderVersion } = loaderSettings(profile);
  return loader === 'vanilla' ? profile.version : `${profile.version}-${loader}-${crypto.createHash('sha256').update(loaderVersion).digest('hex').slice(0, 12)}`;
}
function mavenPath(name) {
  const [coordinate, extension = 'jar'] = name.split('@');
  const parts = coordinate.split(':');
  if (parts.length < 3 || parts.length > 4 || !parts.every(p => /^[a-zA-Z0-9._+-]+$/.test(p)) || !/^[a-zA-Z0-9]+$/.test(extension)) throw new Error('Invalid loader library coordinate.');
  const [group, artifact, version, classifier] = parts;
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? '-' + classifier : ''}.${extension}`;
}
function compatibleNeo(version, minecraft) {
  // Release numbering: 1.20.2 -> 20.2.x, 1.21 -> 21.0.x, 26.1 -> 26.1.x.
  const old = /^1\.(\d+)(?:\.(\d+))?$/.exec(minecraft);
  const prefix = old ? `${old[1]}.${old[2] || 0}.` : /^\d+\.\d+(?:\.\d+)?$/.test(minecraft) ? `${minecraft}.` : null;
  return Boolean(prefix && version.startsWith(prefix) && !version.includes('+'));
}
async function versions(loader, minecraft, io, signal) {
  if (!TYPES.includes(loader)) throw new Error('Unknown mod loader.');
  if (loader === 'vanilla') return [];
  if (loader === 'fabric') {
    const games = await io.remoteJson('https://meta.fabricmc.net/v2/versions/game', signal);
    if (!games.some(g => g.version === minecraft)) return [];
    const rows = await io.remoteJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraft)}`, signal);
    return rows.map(r => ({ version: r.loader.version, stable: r.loader.stable }));
  }
  const xml = await io.remoteText(MAVEN[loader] + 'maven-metadata.xml', signal);
  const result = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1])
    .filter(v => loader === 'forge' ? v.startsWith(minecraft + '-') : compatibleNeo(v, minecraft));
  return [...new Set(result)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map(version => ({ version, stable: !/alpha|beta|rc/i.test(version) }));
}
function mergeMetadata(base, child, id) {
  if (child.inheritsFrom !== base.id) throw new Error('The loader does not match this Minecraft version.');
  if (!child.mainClass || !child.arguments || !Array.isArray(child.libraries)) throw new Error('Unsupported loader metadata.');
  const key = lib => { const parts = lib.name.split(':'); return [parts[0], parts[1], parts[3] || '', lib.natives ? JSON.stringify(lib.natives) : ''].join(':'); };
  const libs = new Map(base.libraries.map(lib => [key(lib), lib]));
  for (const lib of child.libraries) libs.set(key(lib), lib);
  return { ...base, ...child, id, inheritsFrom: undefined, baseVersion: base.id,
    assetIndex: base.assetIndex, assets: base.assets, downloads: base.downloads,
    javaVersion: child.javaVersion || base.javaVersion, logging: child.logging || base.logging,
    arguments: { jvm: [...base.arguments.jvm, ...(child.arguments.jvm || [])], game: [...base.arguments.game, ...(child.arguments.game || [])] },
    libraries: [...libs.values()] };
}
async function installerMetadata(file) {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== 'version.json') continue;
      if (entry.uncompressedSize > 4 * 1024 * 1024) throw new Error('Loader metadata is too large.');
      const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks));
    }
    throw new Error('This legacy installer format is unsupported. Choose a newer loader build.');
  } finally { zip.close(); }
}
async function checksum(url, io, signal) {
  const value = (await io.remoteText(url + '.sha1', signal)).trim().split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/i.test(value)) throw new Error('The official repository did not supply a valid checksum.');
  return value.toLowerCase();
}
async function normalizeLibraries(meta, root, io, signal, downloadMissing) {
  for (const lib of meta.libraries) {
    if (!io.allowed(lib.rules)) continue;
    if (!lib.downloads?.artifact) {
      const relative = mavenPath(lib.name), dest = io.safePath(path.join(root, 'libraries'), relative);
      let artifact;
      if (downloadMissing) {
        const url = new URL(relative, lib.url || 'https://libraries.minecraft.net/').href;
        io.trustedUrl(url);
        artifact = { path: relative, url, sha1: lib.sha1 || await checksum(url, io, signal) };
        if (lib.size != null) artifact.size = lib.size;
        await io.download(artifact, dest, signal);
      } else {
        await fs.access(dest).catch(() => { throw new Error(`Installer did not create ${lib.name}. Retry installation.`); });
        artifact = { path: relative, sha1: await io.hashFile(dest) };
      }
      lib.downloads = { ...lib.downloads, artifact };
    } else if (downloadMissing) {
      const artifact = lib.downloads.artifact;
      await io.download(artifact, io.safePath(path.join(root, 'libraries'), artifact.path), signal);
    } else {
      const dest = io.safePath(path.join(root, 'libraries'), lib.downloads.artifact.path);
      await fs.access(dest).catch(() => { throw new Error(`Installer did not create ${lib.name}. Retry installation.`); });
    }
  }
}
async function install(profile, root, base, javaPath, io, signal, progress) {
  const { loader, loaderVersion } = loaderSettings(profile), id = profileVersionId(profile);
  const available = await versions(loader, profile.version, io, signal);
  if (!available.some(v => v.version === loaderVersion)) throw new Error(`${loader} ${loaderVersion} is not available for Minecraft ${profile.version}.`);
  let child;
  if (loader === 'fabric') {
    child = await io.remoteJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(profile.version)}/${encodeURIComponent(loaderVersion)}/profile/json`, signal);
  } else {
    const url = `${MAVEN[loader]}${encodeURIComponent(loaderVersion)}/${loader}-${encodeURIComponent(loaderVersion)}-installer.jar`;
    const installer = path.join(root, 'loader-installers', `${loader}-${crypto.createHash('sha256').update(loaderVersion).digest('hex').slice(0, 16)}.jar`);
    progress(`Downloading ${loader} installer`);
    await io.download({ url, sha1: await checksum(url, io, signal) }, installer, signal);
    child = await installerMetadata(installer);
    // Check inheritance BEFORE executing the installer, even for newer naming schemes.
    mergeMetadata(base, child, id);
    const launcherProfiles = path.join(root, 'launcher_profiles.json');
    try { await fs.access(launcherProfiles); } catch { await io.atomicJson(launcherProfiles, { profiles: {}, settings: {} }); }
    progress(`Installing ${loader} — preparing Minecraft libraries`);
    try {
      await run(javaPath, ['-Djava.awt.headless=true', '-jar', installer, '--installClient', root],
        { cwd: root, windowsHide: true, env: gameEnvironment(), signal, timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`${loader} installation failed. Check the installer log in the launcher folder. ${String(error.stderr || error.message).slice(-1200)}`);
    }
    // Official processors may update launch metadata; read their completed output.
    io.validId(child.id);
    child = await io.readJson(path.join(root, 'versions', child.id, `${child.id}.json`));
  }
  const merged = mergeMetadata(base, child, id);
  progress(`Checking ${loader} libraries`);
  await normalizeLibraries(merged, root, io, signal, loader === 'fabric');
  signal?.throwIfAborted();
  const dir = path.join(root, 'versions', id);
  await io.atomicJson(path.join(dir, `${id}.json`), merged);
  await io.atomicJson(path.join(dir, 'installed.json'), { id, type: 'modded', baseVersion: profile.version, loader, loaderVersion, javaMajor: merged.javaVersion?.majorVersion || 8, installedAt: new Date().toISOString() });
  await fs.mkdir(path.join(root, 'instances', profile.id, 'mods'), { recursive: true });
  progress(`${loader} ${loaderVersion} is ready`, 1, 1);
}
module.exports = { TYPES, loaderSettings, profileVersionId, mavenPath, compatibleNeo, versions, mergeMetadata, normalizeLibraries, install };
