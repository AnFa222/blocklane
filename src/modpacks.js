const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { pipeline } = require('node:stream/promises');

const API = 'https://api.modrinth.com/v2';
const PROTECTED = ['saves/', 'screenshots/', 'resourcepacks/', 'shaderpacks/', 'options.txt', 'optionsof.txt', 'servers.dat'];
function id(value, label = 'project') { if (typeof value !== 'string' || !/^[A-Za-z0-9]{8}$/.test(value)) throw new Error(`Invalid Modrinth ${label} ID.`); return value; }
function api(route, query = {}) { const url = new URL(API + route); for (const [key, value] of Object.entries(query)) if (value !== '') url.searchParams.set(key, value); return url.href; }
function cleanText(value, length = 200) { return String(value || '').slice(0, length); }
function imageUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com' ? url.href : null; } catch { return null; } }
function safePackPath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw new Error('The modpack contains an unsafe path.');
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../') || normalized !== value || /^[a-zA-Z]:/.test(value)) throw new Error('The modpack contains an unsafe path.');
  return normalized;
}
function protectedPath(value) { const lower = value.toLowerCase(); return PROTECTED.some(item => item.endsWith('/') ? lower.startsWith(item) : lower === item); }

async function search(query, offset, io, signal) {
  if (typeof query !== 'string' || query.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid modpack search.');
  const result = await io.remoteJson(api('/search', { query: query.trim(), facets: JSON.stringify([['project_type:modpack']]), index: 'relevance', offset: String(offset), limit: '20' }), signal);
  if (!Array.isArray(result.hits)) throw new Error('Modrinth returned an invalid modpack search result.');
  return { total: Number(result.total_hits) || 0, offset, hits: result.hits.map(hit => ({ projectId: id(hit.project_id), slug: cleanText(hit.slug, 100), title: cleanText(hit.title, 100), description: cleanText(hit.description, 300), author: cleanText(hit.author, 100), downloads: Number(hit.downloads) || 0, iconUrl: typeof hit.icon_url === 'string' ? hit.icon_url : null, versions: Array.isArray(hit.versions) ? hit.versions.slice(0, 40).map(String) : [] })) };
}
async function project(projectId, io, signal) {
  const value = await io.remoteJson(api(`/project/${id(projectId)}`), signal);
  return { projectId: id(projectId), title: cleanText(value.title || value.slug || projectId, 100), slug: cleanText(value.slug, 100), description: cleanText(value.description, 1000), body: cleanText(value.body, 16000), iconUrl: imageUrl(value.icon_url), downloads: Number(value.downloads) || 0, followers: Number(value.followers) || 0, categories: Array.isArray(value.categories) ? value.categories.slice(0, 30).map(String) : [], gameVersions: Array.isArray(value.game_versions) ? value.game_versions.slice(0, 80).map(String) : [], loaders: Array.isArray(value.loaders) ? value.loaders.slice(0, 20).map(String) : [], gallery: Array.isArray(value.gallery) ? value.gallery.slice(0, 8).map(item => ({ url: imageUrl(item?.url), title: cleanText(item?.title, 100), description: cleanText(item?.description, 200) })).filter(item => item.url) : [], projectUrl: `https://modrinth.com/modpack/${cleanText(value.slug || projectId, 100)}` };
}
async function versions(projectId, io, signal) {
  const rows = await io.remoteJson(api(`/project/${id(projectId)}/version`, { include_changelog: 'false' }), signal);
  if (!Array.isArray(rows)) throw new Error('Modrinth returned an invalid modpack version list.');
  return rows.filter(row => row?.project_id === projectId && row.files?.some(file => file.filename?.toLowerCase().endsWith('.mrpack')));
}
function packFile(version) {
  const files = (version?.files || []).filter(file => file.filename?.toLowerCase().endsWith('.mrpack'));
  const file = files.find(item => item.primary) || files[0];
  if (!file?.url || !/^[a-f0-9]{40}$/i.test(file.hashes?.sha1 || '')) throw new Error('This modpack version has no checksum-verified .mrpack file.');
  return file;
}
function validateIndex(value) {
  if (!value || value.formatVersion !== 1 || value.game !== 'minecraft' || typeof value.name !== 'string' || !Array.isArray(value.files) || typeof value.dependencies !== 'object') throw new Error('This is not a supported Modrinth modpack.');
  const minecraft = value.dependencies.minecraft;
  if (typeof minecraft !== 'string' || !minecraft || minecraft.length > 100) throw new Error('The modpack does not specify a valid Minecraft version.');
  const paths = new Set();
  for (const file of value.files) {
    const relative = safePackPath(file.path); if (paths.has(relative.toLowerCase())) throw new Error('The modpack contains duplicate file paths.'); paths.add(relative.toLowerCase());
    if (!Array.isArray(file.downloads) || !file.downloads.length || !/^[a-f0-9]{40}$/i.test(file.hashes?.sha1 || '') || !Number.isSafeInteger(file.fileSize) || file.fileSize < 0) throw new Error('The modpack contains an invalid download entry.');
  }
  return value;
}
function profileSpec(index) {
  const dependencies = index.dependencies, choices = [['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'], ['forge', 'forge'], ['neoforge', 'neoforge']].filter(([key]) => dependencies[key]);
  if (choices.length > 1) throw new Error('The modpack requests more than one mod loader.');
  const [dependency, loader] = choices[0] || [null, 'vanilla'];
  const loaderVersion = dependency ? String(dependencies[dependency]) : '';
  if (dependency && !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,100}$/.test(loaderVersion)) throw new Error('The modpack specifies an invalid loader version.');
  return { name: cleanText(index.name, 50), version: String(dependencies.minecraft), loader, loaderVersion, memory: 4, javaPath: 'auto', javaArgs: [], gameArgs: [] };
}
async function extractArchive(file, staging, signal) {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true }); let index = null, expanded = 0; const managed = [], names = new Set();
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (entry.fileName.includes('\\') || entry.fileName.startsWith('/') || entry.fileName.includes('\0')) throw new Error('The modpack archive contains an unsafe path.');
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error('The modpack archive contains a link or special file.');
      if (entry.fileName.endsWith('/')) continue;
      expanded += entry.uncompressedSize; if (expanded > 2 * 1024 * 1024 * 1024 || entry.uncompressedSize > 512 * 1024 * 1024) throw new Error('The modpack archive is too large.');
      if (entry.fileName === 'modrinth.index.json') {
        if (index) throw new Error('The modpack contains more than one index.');
        if (entry.uncompressedSize > 8 * 1024 * 1024) throw new Error('The modpack index is too large.');
        const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
        index = validateIndex(JSON.parse(Buffer.concat(chunks).toString('utf8'))); continue;
      }
      const match = /^(?:overrides|client-overrides)\/(.+)$/.exec(entry.fileName); if (!match) continue;
      const relative = safePackPath(match[1]), destination = path.join(staging, ...relative.split('/'));
      if (names.has(relative.toLowerCase())) throw new Error('The modpack archive contains duplicate override paths.'); names.add(relative.toLowerCase());
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(destination), { signal }); managed.push(relative);
    }
  } finally { zip.close(); }
  if (!index) throw new Error('The modpack has no modrinth.index.json file.');
  return { index, managed };
}
async function stagePack(archive, staging, io, signal, progress = () => {}) {
  await fs.rm(staging, { recursive: true, force: true }); await fs.mkdir(staging, { recursive: true });
  const result = await extractArchive(archive, staging, signal), files = result.index.files.filter(file => file.env?.client !== 'unsupported');
  const total = files.reduce((sum, file) => sum + file.fileSize, 0); let completed = 0;
  await io.pool(files, async file => {
    const relative = safePackPath(file.path), destination = path.join(staging, ...relative.split('/')), url = file.downloads.find(value => { try { return io.trustedUrl(value); } catch { return false; } });
    if (!url) throw new Error(`No trusted download is available for ${relative}.`);
    await io.download({ url, sha1: file.hashes.sha1.toLowerCase(), size: file.fileSize }, destination, signal, done => progress(`Downloading ${relative}`, completed + done, total, 'downloading'));
    completed += file.fileSize; result.managed.push(relative); progress(`Downloading modpack files`, completed, total, 'downloading');
  }, signal, 4);
  result.managed = [...new Set(result.managed.map(safePackPath))]; return result;
}
async function applyStaging(instance, staging, oldManaged, newManaged, updating) {
  const backup = staging + '-rollback'; await fs.rm(backup, { recursive: true, force: true }); await fs.mkdir(backup, { recursive: true }); const changed = new Set([...oldManaged, ...newManaged]);
  try {
    for (const relative of changed) {
      if (protectedPath(relative)) continue;
      const destination = path.join(instance, ...safePackPath(relative).split('/'));
      try { const stat = await fs.stat(destination); if (!stat.isFile()) continue; const saved = path.join(backup, ...relative.split('/')); await fs.mkdir(path.dirname(saved), { recursive: true }); await fs.copyFile(destination, saved); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rm(destination, { force: true });
    }
    for (const relative of newManaged) {
      const source = path.join(staging, ...relative.split('/')), destination = path.join(instance, ...relative.split('/'));
      if (updating && protectedPath(relative)) { try { await fs.access(destination); continue; } catch {} }
      await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination);
    }
  } catch (error) {
    for (const relative of changed) if (!protectedPath(relative)) await fs.rm(path.join(instance, ...relative.split('/')), { force: true });
    for (const relative of oldManaged) { const saved = path.join(backup, ...relative.split('/')); try { await fs.access(saved); const destination = path.join(instance, ...relative.split('/')); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(saved, destination); } catch {} }
    throw error;
  } finally { await fs.rm(backup, { recursive: true, force: true }); }
}
async function readManifest(instance, io) { return io.readJson(path.join(instance, '.blocklane', 'modpack.json'), null); }
async function writeManifest(instance, value, io) { await io.atomicJson(path.join(instance, '.blocklane', 'modpack.json'), value); }

module.exports = { API, id, api, safePackPath, protectedPath, search, project, versions, packFile, validateIndex, profileSpec, extractArchive, stagePack, applyStaging, readManifest, writeManifest };
