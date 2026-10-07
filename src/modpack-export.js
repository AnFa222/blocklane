const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');

const INCLUDED = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'kubejs', 'scripts'];
function text(value, label, max) { const result = String(value || '').trim(); if (!result || result.length > max) throw new Error(`${label} must be 1–${max} characters.`); return result; }
function metadata(value) { return { name: text(value?.name, 'Pack name', 100), versionId: text(value?.versionId, 'Pack version', 50), summary: text(value?.summary, 'Summary', 250) }; }
function dependencies(profile) {
  const result = { minecraft: profile.version }, keys = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }, key = keys[profile.loader || 'vanilla'];
  if ((profile.loader || 'vanilla') === 'liteloader') throw new Error('LiteLoader profiles cannot be exported as a standard Modrinth pack.');
  if (key) result[key] = profile.loaderVersion; return result;
}
async function collect(instance) {
  const files = [], seen = new Set(); let size = 0;
  for (const root of INCLUDED) {
    const start = path.join(instance, root), pending = [[start, root]];
    while (pending.length) {
      const [folder, relativeFolder] = pending.pop();
      for (const item of await fs.readdir(folder, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
        if (item.name === '.blocklane') continue;
        const relative = path.posix.join(relativeFolder, item.name), source = path.join(folder, item.name);
        if (item.isSymbolicLink()) throw new Error(`Cannot export linked file: ${relative}`);
        if (item.isDirectory()) pending.push([source, relative]);
        else if (item.isFile()) { const stat = await fs.stat(source); size += stat.size; if (size > 8 * 1024 * 1024 * 1024) throw new Error('This modpack is larger than 8 GB.'); const key = relative.toLowerCase(); if (seen.has(key)) throw new Error(`Duplicate pack path: ${relative}`); seen.add(key); files.push({ source, relative, size: stat.size }); }
      }
    }
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}
async function exportPack(profile, instance, destination, input) {
  const details = metadata(input), files = await collect(instance); if (!files.length) throw new Error('This profile has no mods, configuration, resource packs, shaders, or scripts to export.');
  const index = { formatVersion: 1, game: 'minecraft', versionId: details.versionId, name: details.name, summary: details.summary, files: [], dependencies: dependencies(profile) };
  await fs.mkdir(path.dirname(destination), { recursive: true }); const temp = `${destination}.${process.pid}.tmp`; await fs.rm(temp, { force: true });
  const zip = new yazl.ZipFile(); zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2)), 'modrinth.index.json');
  for (const file of files) zip.addFile(file.source, `overrides/${file.relative.replace(/\\/g, '/')}`);
  zip.end();
  try { await pipeline(zip.outputStream, createWriteStream(temp, { flags: 'wx' })); await fs.rename(temp, destination); }
  catch (error) { await fs.rm(temp, { force: true }); throw error; }
  return { path: destination, name: details.name, files: files.length, size: (await fs.stat(destination)).size };
}

module.exports = { INCLUDED, metadata, dependencies, collect, exportPack };
