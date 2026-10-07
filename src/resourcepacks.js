const fs = require('node:fs/promises');
const path = require('node:path');
const mods = require('./mods');

function safeFilename(name) {
  if (typeof name !== 'string' || name.length > 180 || path.basename(name) !== name || !/^[^<>:"/\\|?*\x00-\x1f]+\.zip$/i.test(name)) throw new Error('The resource pack has an unsafe filename.');
  return name;
}
function compatible(version, profile) { return version?.game_versions?.includes(profile.version); }
function mapHit(hit) { return { projectId: mods.modId(hit.project_id, 'project'), slug: String(hit.slug || ''), title: String(hit.title || '').slice(0, 100), description: String(hit.description || '').slice(0, 300), author: String(hit.author || '').slice(0, 100), downloads: Number(hit.downloads) || 0, iconUrl: typeof hit.icon_url === 'string' ? hit.icon_url : null }; }

async function search(profile, query, offset, io, signal) {
  if (typeof query !== 'string' || query.length > 100) throw new Error('Search must be 100 characters or fewer.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid search page.');
  const facets = JSON.stringify([['project_type:resourcepack'], [`versions:${profile.version}`]]);
  const result = await io.remoteJson(mods.apiUrl('/search', { query: query.trim(), facets, index: 'relevance', offset, limit: 20 }), signal);
  if (!Array.isArray(result.hits)) throw new Error('Modrinth returned an invalid resource-pack search result.');
  return { total: Number(result.total_hits) || 0, offset, hits: result.hits.map(mapHit) };
}
async function manifest(dir, io) { const value = await io.readJson(path.join(dir, '.blocklane', 'managed.json'), { schema: 1, packs: [] }); if (value?.schema !== 1 || !Array.isArray(value.packs)) throw new Error('The managed resource-pack list is damaged. Restore or remove resourcepacks/.blocklane/managed.json.'); return value; }
async function saveManifest(dir, value, io) { value.packs.sort((a, b) => a.title.localeCompare(b.title)); await io.atomicJson(path.join(dir, '.blocklane', 'managed.json'), value); }
async function versions(projectId, profile, io, signal) { const value = await io.remoteJson(mods.apiUrl(`/project/${mods.modId(projectId, 'project')}/version`, { game_versions: JSON.stringify([profile.version]), include_changelog: 'false' }), signal); if (!Array.isArray(value)) throw new Error('Modrinth returned an invalid resource-pack version list.'); return value.filter(version => compatible(version, profile)); }
function primaryFile(version) { const files = (version?.files || []).filter(file => file.filename?.toLowerCase().endsWith('.zip')); const file = files.find(file => file.primary) || files[0]; if (!file?.url || !file.hashes?.sha1 || !/^[a-f0-9]{40}$/i.test(file.hashes.sha1)) throw new Error('This resource pack version has no checksum-verified ZIP.'); return file; }
function readableFilename(filename, projectId, occupied = new Set()) {
  const source = safeFilename(filename), extension = path.extname(source), stem = path.basename(source, extension);
  const taken = name => occupied.has(name.toLowerCase()) || occupied.has(`${name}.disabled`.toLowerCase());
  if (!taken(source)) return source;
  const suffix = mods.modId(projectId, 'project').slice(0, 8);
  let candidate = `${stem} (${suffix})${extension}`, number = 2;
  while (taken(candidate)) candidate = `${stem} (${suffix}-${number++})${extension}`;
  return candidate;
}
function titleFilename(title, fallback) {
  const stem = String(title || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 160);
  return stem ? `${stem}.zip` : safeFilename(fallback);
}
function legacyFilename(filename) {
  const match = /^blocklane-[a-zA-Z0-9]{8}-[a-zA-Z0-9]{8}-(.+\.zip)$/i.exec(filename || '');
  return match?.[1] || null;
}
async function normalizeManagedFilenames(dir, value, io) {
  const names = await fs.readdir(dir).catch(() => []), occupied = new Set(names.map(name => name.toLowerCase()));
  const renamed = [];
  for (const pack of value.packs) {
    const clean = legacyFilename(pack.filename);
    if (!clean) continue;
    const disabled = pack.enabled === false ? '.disabled' : '', sourceName = pack.filename + disabled;
    if (!names.includes(sourceName)) continue;
    occupied.delete(sourceName.toLowerCase());
    const target = readableFilename(titleFilename(pack.title, clean), pack.projectId, occupied), targetName = target + disabled;
    await fs.rename(path.join(dir, sourceName), path.join(dir, targetName));
    renamed.push([sourceName, targetName]); pack.filename = target; occupied.add(targetName.toLowerCase());
  }
  if (renamed.length) {
    await saveManifest(dir, value, io);
    const optionsFile = path.join(dir, '..', 'options.txt');
    const options = await fs.readFile(optionsFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (options !== null) {
      const updated = renamed.reduce((text, [before, after]) => text.split(before).join(after), options);
      if (updated !== options) await fs.writeFile(optionsFile, updated);
    }
  }
  return value;
}
async function normalize(dir, io) {
  await fs.mkdir(dir, { recursive: true });
  return normalizeManagedFilenames(dir, await manifest(dir, io), io);
}

async function list(profile, dir, io) {
  await fs.mkdir(dir, { recursive: true }); const value = await normalizeManagedFilenames(dir, await manifest(dir, io), io), names = await fs.readdir(dir).catch(() => []); const managedNames = new Set(value.packs.flatMap(pack => [pack.filename, pack.filename + '.disabled']));
  return { profile: { id: profile.id, name: profile.name, version: profile.version, loader: profile.loader }, installed: value.packs.map(pack => ({ ...pack, missing: !names.includes(pack.filename) && !names.includes(pack.filename + '.disabled') })), local: names.filter(name => /\.zip(?:\.disabled)?$/i.test(name) && !managedNames.has(name)).map(filename => ({ filename, title: filename.replace(/\.disabled$/i, '').replace(/\.zip$/i, ''), enabled: !filename.endsWith('.disabled'), local: true })) };
}
async function install(profile, projectId, dir, io, signal, progress = () => {}) {
  await fs.mkdir(dir, { recursive: true }); const choices = await versions(projectId, profile, io, signal), version = choices.find(value => value.version_type === 'release') || choices[0]; if (!version) throw new Error(`No compatible resource pack version exists for Minecraft ${profile.version}.`);
  const info = await mods.project(projectId, io, signal), file = primaryFile(version), value = await normalizeManagedFilenames(dir, await manifest(dir, io), io), prior = value.packs.find(pack => pack.projectId === projectId), names = await fs.readdir(dir).catch(() => []), occupied = new Set(names.filter(name => name !== prior?.filename && name !== `${prior?.filename}.disabled`).map(name => name.toLowerCase())), filename = readableFilename(titleFilename(info.title, file.filename), projectId, occupied);
  progress(`Installing ${info.title}`); await io.download({ url: file.url, sha1: file.hashes.sha1.toLowerCase(), size: file.size }, path.join(dir, filename), signal);
  value.packs = value.packs.filter(pack => pack.projectId !== projectId); value.packs.push({ projectId, versionId: mods.modId(version.id, 'version'), versionNumber: String(version.version_number || ''), title: info.title, slug: info.slug, iconUrl: info.iconUrl, filename, enabled: prior?.enabled !== false }); await saveManifest(dir, value, io); if (prior?.filename && prior.filename !== filename) await fs.rm(path.join(dir, prior.filename + (prior.enabled === false ? '.disabled' : '')), { force: true }); return list(profile, dir, io);
}
async function setEnabled(profile, dir, projectId, enabled, io) { const value = await normalize(dir, io), pack = value.packs.find(item => item.projectId === mods.modId(projectId, 'project')); if (!pack) throw new Error('Managed resource pack not found.'); if (pack.enabled === Boolean(enabled)) return list(profile, dir, io); await fs.rename(path.join(dir, pack.filename + (pack.enabled === false ? '.disabled' : '')), path.join(dir, pack.filename + (enabled ? '' : '.disabled'))); pack.enabled = Boolean(enabled); await saveManifest(dir, value, io); return list(profile, dir, io); }
async function remove(profile, dir, projectId, io) { const value = await normalize(dir, io), pack = value.packs.find(item => item.projectId === mods.modId(projectId, 'project')); if (!pack) throw new Error('Managed resource pack not found.'); await fs.rm(path.join(dir, pack.filename + (pack.enabled === false ? '.disabled' : '')), { force: true }); value.packs = value.packs.filter(item => item !== pack); await saveManifest(dir, value, io); return list(profile, dir, io); }
module.exports = { search, list, install, setEnabled, remove, normalize, compatible, safeFilename, readableFilename, titleFilename };
