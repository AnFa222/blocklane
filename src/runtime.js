const fs = require('node:fs/promises');
const path = require('node:path');
const CATALOG = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const components = { 8: 'jre-legacy', 16: 'java-runtime-alpha', 17: 'java-runtime-gamma', 21: 'java-runtime-delta', 25: 'java-runtime-epsilon' };

function runtimeSpec(meta) {
  const major = meta.javaVersion?.majorVersion || 8;
  const component = meta.javaVersion?.component || components[major];
  if (!Number.isInteger(major) || !component || !/^[a-z0-9-]+$/.test(component)) throw new Error('This version does not specify a supported Java runtime.');
  return { major, component };
}
function managedJava(value) { return !value || ['auto', 'java', 'java.exe'].includes(value.trim().toLowerCase()); }

async function ensureRuntime(meta, root, bundledRoot, io, signal, progress = () => {}) {
  const { major, component } = runtimeSpec(meta);
  signal?.throwIfAborted();
  progress(`Checking Java ${major}`, 0, 1);
  // A complete, verified runtime works offline; partial or corrupt runtimes
  // are repaired in writable launcher data, never in the installed app.
  for (const base of [bundledRoot, root].filter(Boolean)) {
    const dir = io.safePath(base, component);
    try {
      const marker = await io.readJson(path.join(dir, 'installed.json'), null);
      if (!marker || marker.major !== major || marker.component !== component) continue;
      const manifestPath = path.join(dir, 'runtime-manifest.json');
      if (await io.hashFile(manifestPath) !== marker.manifestSha1) continue;
      const manifest = await io.readJson(manifestPath);
      let valid = true;
      for (const [name, item] of Object.entries(manifest.files)) {
        signal?.throwIfAborted();
        const dest = io.safePath(dir, name);
        if (item.type === 'directory') continue;
        if (item.type !== 'file' || !item.downloads?.raw || await io.hashFile(dest) !== item.downloads.raw.sha1) { valid = false; break; }
      }
      if (!valid) continue;
      const executable = path.join(dir, 'bin', 'java.exe');
      const java = await io.inspectJava(executable);
      if (java.major === major && ['amd64', 'x86_64'].includes(java.arch)) return executable;
    } catch { signal?.throwIfAborted(); }
  }
  const dir = io.safePath(root, component);
  progress(`Preparing Java ${major}`, 0, 1);
  const catalog = await io.remoteJson(CATALOG, signal);
  const target = catalog['windows-x64']?.[component]?.find(t => t.availability?.progress === 100);
  if (!target?.manifest) throw new Error(`Mojang does not currently provide ${component} for Windows x64.`);
  await fs.mkdir(dir, { recursive: true });
  await fs.rm(path.join(dir, 'installed.json'), { force: true });
  const manifestPath = path.join(dir, 'runtime-manifest.json');
  await io.download(target.manifest, manifestPath, signal);
  const manifest = await io.readJson(manifestPath);
  if (!manifest.files || !manifest.files['bin/java.exe']) throw new Error('The Java runtime manifest is incomplete.');
  const jobs = [];
  for (const [name, item] of Object.entries(manifest.files)) {
    const dest = io.safePath(dir, name);
    if (item.type === 'directory') await fs.mkdir(dest, { recursive: true });
    else if (item.type === 'file' && item.downloads?.raw) jobs.push({ ...item.downloads.raw, dest });
    else throw new Error(`Unsupported Windows Java runtime entry: ${name}`);
  }
  let done = 0;
  await io.pool(jobs, async item => {
    await io.download(item, item.dest, signal);
    progress(`Installing Java ${major}`, ++done, jobs.length);
  }, signal);
  signal?.throwIfAborted();
  const executable = path.join(dir, 'bin', 'java.exe');
  const java = await io.inspectJava(executable);
  if (java.major !== major || !['amd64', 'x86_64'].includes(java.arch)) throw new Error(`The downloaded runtime did not report 64-bit Java ${major}. Retry installation.`);
  signal?.throwIfAborted();
  await io.atomicJson(path.join(dir, 'installed.json'), { component, major, version: target.version.name, manifestSha1: target.manifest.sha1 });
  return executable;
}
module.exports = { ensureRuntime, runtimeSpec, managedJava, CATALOG };
