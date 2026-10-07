const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { gameEnvironment } = require('./launch-policy');
const run = promisify(execFile);
const TYPES = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'liteloader'];
const QUILT_META = 'https://meta.quiltmc.org/v3/versions/loader';
const LITELOADER_META = 'https://dl.liteloader.com/versions/versions.json';
const LITELOADER_MAVEN = 'https://repo.mumfrey.com/content/repositories/snapshots/';
const MAVEN = {
  forge: 'https://maven.minecraftforge.net/net/minecraftforge/forge/',
  neoforge: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/'
};
function loaderSettings(profile) {
  const loader = profile.loader || 'vanilla', loaderVersion = profile.loaderVersion || '';
  if (!TYPES.includes(loader)) throw new Error('Choose Vanilla, Fabric, Quilt, Forge, NeoForge, or LiteLoader.');
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
  if (loader === 'quilt') {
    const rows = await io.remoteJson(`${QUILT_META}/${encodeURIComponent(minecraft)}`, signal);
    if (!Array.isArray(rows)) throw new Error('Quilt returned an invalid loader catalog.');
    return rows.map(row => ({ version: row.loader.version, stable: !/alpha|beta|rc/i.test(row.loader.version) }));
  }
  if (loader === 'liteloader') {
    const catalog = await io.remoteJson(LITELOADER_META, signal);
    return liteLoaderBuilds(catalog, minecraft).map(build => ({ version: build.version, stable: build.stable }));
  }
  const xml = await io.remoteText(MAVEN[loader] + 'maven-metadata.xml', signal);
  const result = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1])
    .filter(v => loader === 'forge' ? v.startsWith(minecraft + '-') : compatibleNeo(v, minecraft));
  return [...new Set(result)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map(version => ({ version, stable: !/alpha|beta|rc/i.test(version) }));
}
function liteLoaderBuilds(catalog, minecraft) {
  const value = catalog?.versions?.[minecraft], builds = [];
  for (const [sectionName, stable] of [['artefacts', true], ['snapshots', false]]) {
    const section = value?.[sectionName]?.['com.mumfrey:liteloader'];
    if (!section?.latest) continue;
    const entry = section.latest, version = String(entry.build || entry.version || '');
    if (!version || !entry.version || !/^[a-f0-9]{32}$/i.test(entry.md5 || '')) continue;
    builds.push({ version, stable: stable && entry.stream === 'RELEASE', entry, libraries: [...(value[sectionName].libraries || []), ...(entry.libraries || [])] });
  }
  return [...new Map(builds.map(build => [build.version, build])).values()];
}
function liteLoaderMetadata(profile, catalog) {
  const build = liteLoaderBuilds(catalog, profile.version).find(item => item.version === profile.loaderVersion);
  if (!build) throw new Error(`LiteLoader ${profile.loaderVersion} is not available for Minecraft ${profile.version}.`);
  const libraries = [...new Map(build.libraries.map(library => [library.name, { ...library }])).values()];
  const timestamp = Number(build.entry.timestamp), buildNumber = Number(build.entry.lastSuccessfulBuild);
  if (!Number.isInteger(timestamp) || !Number.isInteger(buildNumber) || buildNumber < 1) throw new Error('LiteLoader returned invalid snapshot metadata.');
  const stamp = new Date(timestamp * 1000).toISOString().replace(/[-:]/g, '').replace('T', '.').slice(0, 15);
  const resolvedVersion = build.entry.version.replace(/SNAPSHOT$/, `${stamp}-${buildNumber}`);
  const name = `com.mumfrey:liteloader:${build.entry.version}`;
  libraries.push({ name, downloads: { artifact: { path: mavenPath(name), url: `${LITELOADER_MAVEN}com/mumfrey/liteloader/${build.entry.version}/liteloader-${resolvedVersion}-release.jar`, md5: build.entry.md5.toLowerCase() } } });
  for (const library of libraries) {
    if (library.name === 'org.ow2.asm:asm-all:5.2') library.url = 'https://repo.liteloader.com/';
    if (library.name === 'org.spongepowered:mixin:0.7.4-SNAPSHOT') library.downloads = { artifact: {
      path: mavenPath(library.name),
      url: 'https://repo.spongepowered.org/maven/org/spongepowered/mixin/0.7.4-SNAPSHOT/mixin-0.7.4-20171010.121826-8.jar',
      sha1: 'd22c5b223b3ff950cd165446dbc88afb162a8b6e'
    } };
  }
  return { id: `liteloader-${build.entry.version}`, inheritsFrom: profile.version, type: build.stable ? 'release' : 'snapshot', mainClass: 'net.minecraft.launchwrapper.Launch', arguments: { jvm: [], game: ['--tweakClass', build.entry.tweakClass || 'com.mumfrey.liteloader.launch.LiteLoaderTweaker'] }, libraries };
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
        artifact = { path: relative, url };
        if (/^[a-f0-9]{32}$/i.test(lib.md5 || '')) artifact.md5 = lib.md5.toLowerCase();
        else artifact.sha1 = lib.sha1 || await checksum(url, io, signal);
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
  } else if (loader === 'quilt') {
    child = await io.remoteJson(`${QUILT_META}/${encodeURIComponent(profile.version)}/${encodeURIComponent(loaderVersion)}/profile/json`, signal);
  } else if (loader === 'liteloader') {
    child = liteLoaderMetadata(profile, await io.remoteJson(LITELOADER_META, signal));
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
  await normalizeLibraries(merged, root, io, signal, ['fabric', 'quilt', 'liteloader'].includes(loader));
  signal?.throwIfAborted();
  const dir = path.join(root, 'versions', id);
  await io.atomicJson(path.join(dir, `${id}.json`), merged);
  await io.atomicJson(path.join(dir, 'installed.json'), { id, type: 'modded', baseVersion: profile.version, loader, loaderVersion, javaMajor: merged.javaVersion?.majorVersion || 8, installedAt: new Date().toISOString() });
  await fs.mkdir(path.join(root, 'instances', profile.id, 'mods'), { recursive: true });
  progress(`${loader} ${loaderVersion} is ready`, 1, 1);
}
module.exports = { TYPES, QUILT_META, LITELOADER_META, LITELOADER_MAVEN, loaderSettings, profileVersionId, mavenPath, compatibleNeo, liteLoaderBuilds, liteLoaderMetadata, versions, mergeMetadata, normalizeLibraries, install };
