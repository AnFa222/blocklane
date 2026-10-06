const fs = require('node:fs/promises');
const path = require('node:path');

const API = 'https://api.modrinth.com/v2';

function modId(value, label = 'mod') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{8}$/.test(value)) throw new Error(`Invalid ${label} ID.`);
  return value;
}

function profileLoader(profile) {
  const loader = profile?.loader || 'vanilla';
  if (loader === 'vanilla') throw new Error('Choose a Fabric, Forge, or NeoForge profile to manage mods.');
  if (!['fabric', 'forge', 'neoforge'].includes(loader)) throw new Error('This profile uses an unsupported mod loader.');
  return loader;
}

function apiUrl(route, query = {}) {
  const url = new URL(API + route);
  for (const [key, value] of Object.entries(query)) if (value != null && value !== '') url.searchParams.set(key, value);
  return url.href;
}

function safeFilename(name) {
  if (typeof name !== 'string' || name.length > 180 || path.basename(name) !== name || !/^[^<>:"/\\|?*\x00-\x1f]+\.jar$/i.test(name)) throw new Error('The mod has an unsafe filename.');
  return name;
}

function managedFilename(projectId, versionId, original) {
  const clean = safeFilename(original).replace(/[^a-zA-Z0-9._+-]/g, '_');
  return `blocklane-${modId(projectId, 'project')}-${modId(versionId, 'version')}-${clean}`;
}

function primaryFile(version) {
  const files = (version?.files || []).filter(file => file.filename?.toLowerCase().endsWith('.jar'));
  const file = files.find(file => file.primary) || files[0];
  if (!file?.url || !file.hashes?.sha1 || !/^[a-f0-9]{40}$/i.test(file.hashes.sha1)) throw new Error('This mod version has no checksum-verified JAR.');
  return file;
}

function compatible(version, profile) {
  return version?.game_versions?.includes(profile.version) && version?.loaders?.includes(profile.loader);
}

async function manifest(modsDir, io) {
  const value = await io.readJson(path.join(modsDir, '.blocklane', 'managed.json'), { schema: 1, mods: [] });
  if (value?.schema !== 1 || !Array.isArray(value.mods)) throw new Error('The managed mod list is damaged. Restore or remove .blocklane/managed.json.');
  return value;
}

async function saveManifest(modsDir, value, io) {
  value.mods.sort((a, b) => a.title.localeCompare(b.title));
  await io.atomicJson(path.join(modsDir, '.blocklane', 'managed.json'), value);
}

async function search(profile, query, offset, io, signal) {
  const loader = profileLoader(profile);
  if (typeof query !== 'string' || query.length > 100) throw new Error('Search must be 100 characters or fewer.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid search page.');
  const facets = JSON.stringify([[`project_type:mod`], [`categories:${loader}`], [`versions:${profile.version}`]]);
  const result = await io.remoteJson(apiUrl('/search', { query: query.trim(), facets, index: 'relevance', offset, limit: 20 }), signal);
  if (!Array.isArray(result.hits)) throw new Error('Modrinth returned an invalid search result.');
  return { total: Number(result.total_hits) || 0, offset, hits: result.hits.map(hit => ({
    projectId: modId(hit.project_id, 'project'), slug: String(hit.slug || ''), title: String(hit.title || '').slice(0, 100),
    description: String(hit.description || '').slice(0, 300), author: String(hit.author || '').slice(0, 100),
    downloads: Number(hit.downloads) || 0, iconUrl: typeof hit.icon_url === 'string' ? hit.icon_url : null
  })) };
}

async function projectVersions(projectId, profile, io, signal) {
  modId(projectId, 'project'); profileLoader(profile);
  const versions = await io.remoteJson(apiUrl(`/project/${projectId}/version`, {
    loaders: JSON.stringify([profile.loader]), game_versions: JSON.stringify([profile.version]), include_changelog: 'false'
  }), signal);
  if (!Array.isArray(versions)) throw new Error('Modrinth returned an invalid version list.');
  return versions.filter(version => compatible(version, profile));
}

async function project(projectId, io, signal) {
  const value = await io.remoteJson(apiUrl(`/project/${modId(projectId, 'project')}`), signal);
  return { projectId: modId(projectId, 'project'), title: String(value.title || value.slug || projectId).slice(0, 100), slug: String(value.slug || '').slice(0, 100), iconUrl: typeof value.icon_url === 'string' ? value.icon_url : null, description: String(value.description || '').slice(0, 1000), body: String(value.body || '').slice(0, 12000), projectType: String(value.project_type || 'mod'), downloads: Number(value.downloads) || 0, followers: Number(value.followers) || 0, categories: Array.isArray(value.categories) ? value.categories.slice(0, 30).map(String) : [], gameVersions: Array.isArray(value.game_versions) ? value.game_versions.slice(0, 40).map(String) : [], loaders: Array.isArray(value.loaders) ? value.loaders.slice(0, 10).map(String) : [], issuesUrl: typeof value.issues_url === 'string' ? value.issues_url : null, sourceUrl: typeof value.source_url === 'string' ? value.source_url : null, wikiUrl: typeof value.wiki_url === 'string' ? value.wiki_url : null, discordUrl: typeof value.discord_url === 'string' ? value.discord_url : null, license: value.license ? { name: String(value.license.name || value.license.id || '').slice(0, 100), url: typeof value.license.url === 'string' ? value.license.url : null } : null, projectUrl: `https://modrinth.com/${String(value.project_type || 'mod')}/${String(value.slug || projectId)}` };
}

async function exactVersion(versionId, profile, io, signal) {
  const value = await io.remoteJson(apiUrl(`/version/${modId(versionId, 'version')}`), signal);
  if (!compatible(value, profile)) throw new Error('A required dependency has no compatible version for this profile.');
  return value;
}

async function installProject(profile, projectId, modsDir, io, signal, progress = () => {}) {
  await fs.mkdir(modsDir, { recursive: true });
  const before = await manifest(modsDir, io);
  const existing = new Set((await fs.readdir(modsDir).catch(() => [])).filter(name => /^blocklane-.*\.jar(?:\.disabled)?$/i.test(name)));
  const transaction = { deferredDeletes: new Set(), requiredProjects: new Set() };
  try {
    await installProjectInner(profile, projectId, modsDir, io, signal, progress, projectId, new Set(), transaction);
    const current = await manifest(modsDir, io);
    for (const dependency of [...current.mods]) {
      if (!dependency.dependencyOnly || transaction.requiredProjects.has(dependency.projectId)) continue;
      dependency.requiredBy = (dependency.requiredBy || []).filter(id => id !== projectId);
      if (!dependency.requiredBy.length) {
        transaction.deferredDeletes.add(dependency.filename + (dependency.enabled === false ? '.disabled' : ''));
        current.mods = current.mods.filter(mod => mod.projectId !== dependency.projectId);
      }
    }
    await saveManifest(modsDir, current, io);
    for (const filename of transaction.deferredDeletes) await fs.rm(path.join(modsDir, filename), { force: true });
  } catch (error) {
    await saveManifest(modsDir, before, io);
    for (const filename of (await fs.readdir(modsDir).catch(() => []))) if (/^blocklane-.*\.jar(?:\.disabled)?$/i.test(filename) && !existing.has(filename)) await fs.rm(path.join(modsDir, filename), { force: true });
    throw error;
  }
}

async function installProjectInner(profile, projectId, modsDir, io, signal, progress, rootId, seen, transaction) {
  projectId = modId(projectId, 'project'); rootId = modId(rootId, 'project'); profileLoader(profile);
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const versions = await projectVersions(projectId, profile, io, signal);
  const version = versions.find(v => v.version_type === 'release') || versions[0];
  if (!version) throw new Error(`No compatible ${profile.loader} version exists for Minecraft ${profile.version}.`);
  await installVersion(profile, version, modsDir, io, signal, progress, rootId, seen, projectId, transaction);
}

async function installVersion(profile, version, modsDir, io, signal, progress, rootId, seen, expectedProjectId, transaction) {
  const projectId = modId(version.project_id, 'project'), versionId = modId(version.id, 'version');
  if (expectedProjectId && projectId !== expectedProjectId) throw new Error('Modrinth returned a version for the wrong project.');
  if (!compatible(version, profile)) throw new Error('The selected mod version is incompatible with this profile.');
  const info = await project(projectId, io, signal);
  const file = primaryFile(version);
  const filename = managedFilename(projectId, versionId, file.filename);
  await fs.mkdir(modsDir, { recursive: true });
  progress(`Installing ${info.title}`);
  await io.download({ url: file.url, sha1: file.hashes.sha1.toLowerCase(), size: file.size }, path.join(modsDir, filename), signal);

  const list = await manifest(modsDir, io);
  const prior = list.mods.find(mod => mod.projectId === projectId);
  const requiredBy = new Set(prior?.requiredBy || []);
  if (projectId !== rootId) { requiredBy.add(rootId); transaction.requiredProjects.add(projectId); }
  else requiredBy.delete(rootId);
  const next = { projectId, versionId, versionNumber: String(version.version_number || ''), title: info.title, slug: info.slug, iconUrl: info.iconUrl,
    filename, enabled: prior?.enabled !== false, dependencyOnly: projectId !== rootId && (prior?.dependencyOnly !== false), requiredBy: [...requiredBy] };
  list.mods = list.mods.filter(mod => mod.projectId !== projectId);
  list.mods.push(next);
  await saveManifest(modsDir, list, io);
  if (prior?.filename && prior.filename !== filename) transaction.deferredDeletes.add(prior.filename + (prior.enabled === false ? '.disabled' : ''));

  for (const dependency of version.dependencies || []) {
    if (dependency.dependency_type !== 'required') continue;
    if (dependency.version_id) {
      const child = await exactVersion(dependency.version_id, profile, io, signal);
      if (seen.has(child.project_id)) continue;
      seen.add(child.project_id);
      await installVersion(profile, child, modsDir, io, signal, progress, rootId, seen, child.project_id, transaction);
    } else if (dependency.project_id) await installProjectInner(profile, dependency.project_id, modsDir, io, signal, progress, rootId, seen, transaction);
    else throw new Error(`${info.title} has an unresolved required dependency.`);
  }
}

async function list(profile, modsDir, io) {
  profileLoader(profile); await fs.mkdir(modsDir, { recursive: true });
  const value = await manifest(modsDir, io);
  const names = await fs.readdir(modsDir).catch(() => []);
  const managedNames = new Set(value.mods.flatMap(mod => [mod.filename, mod.filename + '.disabled']));
  const installed = value.mods.map(mod => ({ ...mod, missing: !names.includes(mod.filename) && !names.includes(mod.filename + '.disabled') }));
  const local = names.filter(name => /\.jar(?:\.disabled)?$/i.test(name) && !managedNames.has(name)).map(filename => ({ filename, title: filename.replace(/\.disabled$/i, '').replace(/\.jar$/i, ''), enabled: !filename.endsWith('.disabled'), local: true }));
  return { profile: { id: profile.id, name: profile.name, version: profile.version, loader: profile.loader }, installed, local };
}

async function setEnabled(profile, modsDir, projectId, enabled, io) {
  profileLoader(profile); projectId = modId(projectId, 'project');
  const value = await manifest(modsDir, io), mod = value.mods.find(item => item.projectId === projectId);
  if (!mod) throw new Error('Managed mod not found.');
  if (!enabled && mod.dependencyOnly && mod.requiredBy?.length) throw new Error('This required dependency cannot be disabled while another mod uses it.');
  if (mod.enabled === Boolean(enabled)) return list(profile, modsDir, io);
  const source = path.join(modsDir, mod.filename + (mod.enabled === false ? '.disabled' : ''));
  const destination = path.join(modsDir, mod.filename + (enabled ? '' : '.disabled'));
  await fs.rename(source, destination);
  mod.enabled = Boolean(enabled); await saveManifest(modsDir, value, io);
  return list(profile, modsDir, io);
}

async function remove(profile, modsDir, projectId, io) {
  profileLoader(profile); projectId = modId(projectId, 'project');
  const value = await manifest(modsDir, io), target = value.mods.find(mod => mod.projectId === projectId);
  if (!target) throw new Error('Managed mod not found.');
  if (target.dependencyOnly && target.requiredBy?.length) throw new Error('This required dependency cannot be removed while another mod uses it.');
  await fs.rm(path.join(modsDir, target.filename + (target.enabled === false ? '.disabled' : '')), { force: true });
  value.mods = value.mods.filter(mod => mod.projectId !== projectId);
  for (const dependency of [...value.mods]) {
    dependency.requiredBy = (dependency.requiredBy || []).filter(id => id !== projectId);
    if (dependency.dependencyOnly && dependency.requiredBy.length === 0) {
      await fs.rm(path.join(modsDir, dependency.filename + (dependency.enabled === false ? '.disabled' : '')), { force: true });
      value.mods = value.mods.filter(mod => mod.projectId !== dependency.projectId);
    }
  }
  await saveManifest(modsDir, value, io);
  return list(profile, modsDir, io);
}

async function updates(profile, modsDir, io, signal) {
  const value = await list(profile, modsDir, io), result = [];
  for (const mod of value.installed.filter(mod => !mod.dependencyOnly)) {
    const versions = await projectVersions(mod.projectId, profile, io, signal);
    const latest = versions.find(v => v.version_type === 'release') || versions[0];
    if (latest && latest.id !== mod.versionId) result.push({ projectId: mod.projectId, title: mod.title, current: mod.versionNumber, latest: latest.version_number });
  }
  return result;
}

module.exports = { API, modId, profileLoader, apiUrl, safeFilename, managedFilename, primaryFile, compatible, search, project, projectVersions, installProject, list, setEnabled, remove, updates };


