const fs = require('node:fs/promises');
const path = require('node:path');
const mods = require('./mods');

// Iris shader packs also work through Oculus.  Modrinth classifies these packs
// with the Iris compatibility tag, rather than the Minecraft mod-loader tag.
function adapter(profile, modList) {
  if (!['fabric', 'forge', 'neoforge'].includes(profile?.loader)) return null;
  const names = [...(modList?.installed || []), ...(modList?.local || [])]
    .map(item => `${item.slug || ''} ${item.title || ''} ${item.filename || ''}`.toLowerCase());
  const has = name => names.some(value => new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(value));
  if (profile.loader === 'fabric' && has('iris')) return { id: 'iris', label: 'Iris' };
  if ((profile.loader === 'forge' || profile.loader === 'neoforge') && has('oculus')) return { id: 'oculus', label: 'Oculus' };
  return null;
}

function safeFilename(name) {
  if (typeof name !== 'string' || name.length > 180 || path.basename(name) !== name || !/^[^<>:"/\\|?*\x00-\x1f]+\.zip$/i.test(name)) throw new Error('The shader pack has an unsafe filename.');
  return name;
}

function compatible(version, profile) {
  // Oculus intentionally consumes the Iris shader-pack format.
  return version?.game_versions?.includes(profile.version) && version?.loaders?.includes('iris');
}

function mapHit(hit) {
  return { projectId: mods.modId(hit.project_id, 'project'), slug: String(hit.slug || ''), title: String(hit.title || '').slice(0, 100), description: String(hit.description || '').slice(0, 300), author: String(hit.author || '').slice(0, 100), downloads: Number(hit.downloads) || 0, iconUrl: typeof hit.icon_url === 'string' ? hit.icon_url : null };
}

async function search(profile, selectedAdapter, query, offset, io, signal) {
  if (!selectedAdapter) throw new Error('Install Iris or Oculus in this profile before browsing shader packs.');
  if (typeof query !== 'string' || query.length > 100) throw new Error('Search must be 100 characters or fewer.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid search page.');
  const facets = JSON.stringify([['project_type:shader'], ['categories:iris'], [`versions:${profile.version}`]]);
  const result = await io.remoteJson(mods.apiUrl('/search', { query: query.trim(), facets, index: 'relevance', offset, limit: 20 }), signal);
  if (!Array.isArray(result.hits)) throw new Error('Modrinth returned an invalid shader search result.');
  return { total: Number(result.total_hits) || 0, offset, hits: result.hits.map(mapHit), adapter: selectedAdapter };
}

async function manifest(dir, io) {
  const value = await io.readJson(path.join(dir, '.blocklane', 'managed.json'), { schema: 1, packs: [] });
  if (value?.schema !== 1 || !Array.isArray(value.packs)) throw new Error('The managed shader list is damaged. Restore or remove shaderpacks/.blocklane/managed.json.');
  return value;
}
async function saveManifest(dir, value, io) { value.packs.sort((a, b) => a.title.localeCompare(b.title)); await io.atomicJson(path.join(dir, '.blocklane', 'managed.json'), value); }

async function versions(projectId, profile, io, signal) {
  const value = await io.remoteJson(mods.apiUrl(`/project/${mods.modId(projectId, 'project')}/version`, { loaders: JSON.stringify(['iris']), game_versions: JSON.stringify([profile.version]), include_changelog: 'false' }), signal);
  if (!Array.isArray(value)) throw new Error('Modrinth returned an invalid shader version list.');
  return value.filter(version => compatible(version, profile));
}

function primaryFile(version) {
  const files = (version?.files || []).filter(file => file.filename?.toLowerCase().endsWith('.zip'));
  const file = files.find(file => file.primary) || files[0];
  if (!file?.url || !file.hashes?.sha1 || !/^[a-f0-9]{40}$/i.test(file.hashes.sha1)) throw new Error('This shader version has no checksum-verified ZIP.');
  return file;
}

async function list(profile, dir, io) {
  await fs.mkdir(dir, { recursive: true });
  const value = await manifest(dir, io), names = await fs.readdir(dir).catch(() => []);
  const managedNames = new Set(value.packs.flatMap(pack => [pack.filename, pack.filename + '.disabled']));
  const installed = value.packs.map(pack => ({ ...pack, missing: !names.includes(pack.filename) && !names.includes(pack.filename + '.disabled') }));
  const local = names.filter(name => /\.zip(?:\.disabled)?$/i.test(name) && !managedNames.has(name)).map(filename => ({ filename, title: filename.replace(/\.disabled$/i, '').replace(/\.zip$/i, ''), enabled: !filename.endsWith('.disabled'), local: true }));
  return { profile: { id: profile.id, name: profile.name, version: profile.version, loader: profile.loader }, installed, local };
}

async function install(profile, selectedAdapter, projectId, dir, io, signal, progress = () => {}) {
  if (!selectedAdapter) throw new Error('Install Iris or Oculus in this profile before adding a shader pack.');
  await fs.mkdir(dir, { recursive: true });
  const choices = await versions(projectId, profile, io, signal);
  const version = choices.find(value => value.version_type === 'release') || choices[0];
  if (!version) throw new Error(`No Iris-compatible shader pack version exists for Minecraft ${profile.version}.`);
  const info = await mods.project(projectId, io, signal), file = primaryFile(version);
  const filename = `blocklane-${mods.modId(projectId, 'project')}-${mods.modId(version.id, 'version')}-${safeFilename(file.filename).replace(/[^a-zA-Z0-9._+-]/g, '_')}`;
  progress(`Installing ${info.title}`);
  await io.download({ url: file.url, sha1: file.hashes.sha1.toLowerCase(), size: file.size }, path.join(dir, filename), signal);
  const value = await manifest(dir, io), prior = value.packs.find(pack => pack.projectId === projectId);
  value.packs = value.packs.filter(pack => pack.projectId !== projectId);
  value.packs.push({ projectId, versionId: mods.modId(version.id, 'version'), versionNumber: String(version.version_number || ''), title: info.title, slug: info.slug, iconUrl: info.iconUrl, filename, enabled: prior?.enabled !== false });
  await saveManifest(dir, value, io);
  if (prior?.filename && prior.filename !== filename) await fs.rm(path.join(dir, prior.filename + (prior.enabled === false ? '.disabled' : '')), { force: true });
  return list(profile, dir, io);
}

async function setEnabled(profile, dir, projectId, enabled, io) {
  const value = await manifest(dir, io), pack = value.packs.find(item => item.projectId === mods.modId(projectId, 'project'));
  if (!pack) throw new Error('Managed shader pack not found.');
  if (pack.enabled === Boolean(enabled)) return list(profile, dir, io);
  await fs.rename(path.join(dir, pack.filename + (pack.enabled === false ? '.disabled' : '')), path.join(dir, pack.filename + (enabled ? '' : '.disabled')));
  pack.enabled = Boolean(enabled); await saveManifest(dir, value, io); return list(profile, dir, io);
}
async function remove(profile, dir, projectId, io) {
  const value = await manifest(dir, io), pack = value.packs.find(item => item.projectId === mods.modId(projectId, 'project'));
  if (!pack) throw new Error('Managed shader pack not found.');
  await fs.rm(path.join(dir, pack.filename + (pack.enabled === false ? '.disabled' : '')), { force: true }); value.packs = value.packs.filter(item => item !== pack); await saveManifest(dir, value, io); return list(profile, dir, io);
}

module.exports = { adapter, search, list, install, setEnabled, remove, compatible, safeFilename };
