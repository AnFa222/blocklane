const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { gunzipSync } = require('node:zlib');

function worldName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 180 || path.basename(name) !== name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('Invalid world name.');
  return name;
}
async function exists(file) { return fs.access(file).then(() => true).catch(() => false); }
async function uniqueName(saves, requested) {
  const base = worldName(requested); let name = base, number = 2;
  while (await exists(path.join(saves, name))) name = `${base} (${number++})`;
  return name;
}
async function directorySize(folder) {
  let total = 0, seen = 0; const pending = [folder];
  while (pending.length && seen < 20000) {
    const current = pending.pop();
    for (const item of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      if (++seen > 20000) break;
      const file = path.join(current, item.name);
      if (item.isDirectory()) pending.push(file); else if (item.isFile()) total += (await fs.stat(file)).size;
    }
  }
  return total;
}
function parseLevelDat(bytes) {
  const data = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }) : bytes;
  let offset = 0, tags = 0;
  const need = count => { if (count < 0 || offset + count > data.length) throw new Error('Truncated NBT data.'); };
  const byte = () => { need(1); return data.readUInt8(offset++); };
  const short = () => { need(2); const value = data.readUInt16BE(offset); offset += 2; return value; };
  const int = () => { need(4); const value = data.readInt32BE(offset); offset += 4; return value; };
  const long = () => { need(8); const value = Number(data.readBigInt64BE(offset)); offset += 8; return value; };
  const string = () => { const length = short(); need(length); const value = data.toString('utf8', offset, offset + length); offset += length; return value; };
  const payload = (type, depth = 0) => {
    if (++tags > 100000 || depth > 64) throw new Error('NBT data is too complex.');
    if (type === 1) { need(1); return data.readInt8(offset++); }
    if (type === 2) { need(2); const value = data.readInt16BE(offset); offset += 2; return value; }
    if (type === 3) return int();
    if (type === 4) return long();
    if (type === 5) { need(4); const value = data.readFloatBE(offset); offset += 4; return value; }
    if (type === 6) { need(8); const value = data.readDoubleBE(offset); offset += 8; return value; }
    if (type === 7) { const length = int(); need(length); offset += length; return null; }
    if (type === 8) return string();
    if (type === 9) { const child = byte(), length = int(); if (length < 0 || length > 1000000) throw new Error('Invalid NBT list.'); for (let i = 0; i < length; i++) payload(child, depth + 1); return null; }
    if (type === 10) { const result = {}; while (true) { const child = byte(); if (!child) return result; const name = string(); const value = payload(child, depth + 1); if (value !== null && (typeof value !== 'object' || child === 10)) result[name] = value; } }
    if (type === 11) { const length = int(); need(length * 4); offset += length * 4; return null; }
    if (type === 12) { const length = int(); need(length * 8); offset += length * 8; return null; }
    throw new Error('Unsupported NBT tag.');
  };
  if (byte() !== 10) throw new Error('The NBT root is not a compound.'); string(); return payload(10);
}
async function worldDetails(folder, name) {
  const current = path.join(folder, 'level.dat'), previous = path.join(folder, 'level.dat_old'); let root, recovered = false, error;
  try { root = parseLevelDat(await fs.readFile(current)); }
  catch (cause) { error = cause; try { root = parseLevelDat(await fs.readFile(previous)); recovered = true; } catch {} }
  const data = root?.Data || root || {}, version = data.Version || {}, icon = path.join(folder, 'icon.png'); let iconUrl = null;
  try { const bytes = await fs.readFile(icon); if (bytes.length <= 2 * 1024 * 1024 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') iconUrl = `data:image/png;base64,${bytes.toString('base64')}`; } catch {}
  const region = path.join(folder, 'region'); const regions = (await fs.readdir(region, { withFileTypes: true }).catch(() => [])).filter(item => item.isFile() && /^r\.-?\d+\.-?\d+\.mca$/.test(item.name)).length;
  return {
    displayName: typeof data.LevelName === 'string' && data.LevelName.trim() ? data.LevelName.trim().slice(0, 180) : name,
    dataVersion: Number.isInteger(data.DataVersion) ? data.DataVersion : null,
    gameVersion: typeof version.Name === 'string' ? version.Name.slice(0, 80) : null,
    lastPlayed: Number.isFinite(data.LastPlayed) && data.LastPlayed > 0 ? new Date(data.LastPlayed).toISOString() : null,
    iconUrl, health: root ? (recovered ? 'recoverable' : 'healthy') : 'damaged',
    healthMessage: root ? (recovered ? 'level.dat is damaged; level.dat_old is readable.' : regions ? `${regions} region file${regions === 1 ? '' : 's'} detected.` : 'Metadata is readable; no Overworld region files were found.') : `World metadata could not be read${error?.message ? `: ${error.message}` : '.'}`
  };
}
async function list(saves) {
  const entries = await fs.readdir(saves, { withFileTypes: true }).catch(() => []); const result = [];
  for (const item of entries) {
    if (!item.isDirectory() || !(await exists(path.join(saves, item.name, 'level.dat')))) continue;
    const folder = path.join(saves, item.name), stat = await fs.stat(path.join(folder, 'level.dat'));
    result.push({ name: item.name, modifiedAt: stat.mtime.toISOString(), size: await directorySize(folder), ...(await worldDetails(folder, item.name)) });
  }
  return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
async function discoverFolders(selected) {
  const roots = [];
  for (const source of selected) {
    const resolved = path.resolve(source);
    if (await exists(path.join(resolved, 'level.dat'))) roots.push(resolved);
    else for (const world of await list(resolved)) roots.push(path.join(resolved, world.name));
  }
  if (!roots.length) throw new Error('No Minecraft worlds were found. Select a world folder or a folder containing worlds.');
  return roots;
}
async function copyFolders(selected, destination) {
  const roots = await discoverFolders(selected); await fs.mkdir(destination, { recursive: true }); const imported = [];
  for (const source of roots) { const name = await uniqueName(destination, path.basename(source)); await fs.cp(source, path.join(destination, name), { recursive: true, force: false, errorOnExist: true }); imported.push(name); }
  return imported;
}
function safeZipPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw new Error('The world archive contains an unsafe path.');
  const normalized = path.posix.normalize(value); if (normalized === '..' || normalized.startsWith('../') || normalized !== value || /^[a-zA-Z]:/.test(value)) throw new Error('The world archive contains an unsafe path.'); return normalized;
}
async function importZip(archive, destination, staging) {
  await fs.rm(staging, { recursive: true, force: true }); await fs.mkdir(staging, { recursive: true });
  const zip = await yauzl.openPromise(archive, { lazyEntries: true, strictFileNames: true }); let expanded = 0, entries = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      const relative = safeZipPath(entry.fileName); if (++entries > 100000 || (expanded += entry.uncompressedSize) > 8 * 1024 * 1024 * 1024 || entry.uncompressedSize > 2 * 1024 * 1024 * 1024) throw new Error('The world archive is too large.');
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000; if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error('The world archive contains a link or special file.');
      const output = path.join(staging, ...relative.split('/')); if (entry.fileName.endsWith('/')) { await fs.mkdir(output, { recursive: true }); continue; }
      await fs.mkdir(path.dirname(output), { recursive: true }); await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(output));
    }
  } finally { zip.close(); }
  try {
    const roots = []; const pending = [staging];
    while (pending.length) { const current = pending.pop(); if (await exists(path.join(current, 'level.dat'))) { roots.push(current); continue; } for (const item of await fs.readdir(current, { withFileTypes: true })) if (item.isDirectory()) pending.push(path.join(current, item.name)); }
    if (!roots.length) throw new Error('This ZIP does not contain a Minecraft world.'); return await copyFolders(roots, destination);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
async function transfer(sourceSaves, destinationSaves, names, move) {
  if (!Array.isArray(names) || !names.length) throw new Error('Choose at least one world.');
  await fs.mkdir(destinationSaves, { recursive: true }); const result = [];
  for (const value of names) {
    const requested = worldName(value), source = path.join(sourceSaves, requested); if (!(await exists(path.join(source, 'level.dat')))) throw new Error(`World not found: ${requested}`);
    const name = await uniqueName(destinationSaves, requested), destination = path.join(destinationSaves, name);
    await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
    if (move) { try { await fs.rm(source, { recursive: true, force: false }); } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; } }
    result.push(name);
  }
  return result;
}
async function remove(saves, names) {
  if (!Array.isArray(names) || !names.length) throw new Error('Choose at least one world.');
  const available = new Set((await list(saves)).map(world => world.name)); const removed = [];
  for (const value of names) { const name = worldName(value); if (!available.has(name)) throw new Error(`World not found: ${name}`); }
  for (const value of names) { const name = worldName(value); await fs.rm(path.join(saves, name), { recursive: true, force: false }); removed.push(name); }
  return removed;
}

module.exports = { worldName, directorySize, parseLevelDat, worldDetails, list, discoverFolders, copyFolders, safeZipPath, importZip, transfer, remove };
