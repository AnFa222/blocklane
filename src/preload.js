const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) { const error = new Error(result.error); if (result.code) error.code = result.code; throw error; }
  return result.data;
};
contextBridge.exposeInMainWorld('launcher', {
  state: () => invoke('state'), catalog: refresh => invoke('catalog', refresh),
  install: id => invoke('install', id), cancel: () => invoke('cancel'),
  installProfile: id => invoke('profile:install', id), loaderVersions: (loader, version) => invoke('loaders:versions', loader, version),
  openMods: id => invoke('folder:mods', id), openShaders: id => invoke('folder:shaderpacks', id), openResourcepacks: id => invoke('folder:resourcepacks', id),
  searchMods: (profileId, query, offset = 0) => invoke('mods:search', profileId, query, offset),
  modDetails: (profileId, projectId) => invoke('mods:details', profileId, projectId), openModrinth: url => invoke('mods:open', url),
  listMods: profileId => invoke('mods:list', profileId), installMod: (profileId, projectId, allowMissingDependencies = false) => invoke('mods:install', profileId, projectId, allowMissingDependencies),
  enableMod: (profileId, projectId, enabled) => invoke('mods:enable', profileId, projectId, enabled),
  removeMod: (profileId, projectId) => invoke('mods:remove', profileId, projectId),
  modUpdates: profileId => invoke('mods:updates', profileId), updateAllMods: profileId => invoke('mods:update-all', profileId),
  searchModpacks: (query, offset = 0) => invoke('modpacks:search', query, offset), modpackDetails: projectId => invoke('modpacks:details', projectId),
  listModpacks: () => invoke('modpacks:list'), installModpack: projectId => invoke('modpacks:install', projectId), importModpack: () => invoke('modpacks:import'), updateModpack: profileId => invoke('modpacks:update', profileId), removeModpack: profileId => invoke('modpacks:remove', profileId),
  shaderStatus: profileId => invoke('shaders:status', profileId), searchShaders: (profileId, query, offset = 0) => invoke('shaders:search', profileId, query, offset),
  listShaders: profileId => invoke('shaders:list', profileId), installShader: (profileId, projectId) => invoke('shaders:install', profileId, projectId),
  enableShader: (profileId, projectId, enabled) => invoke('shaders:enable', profileId, projectId, enabled), removeShader: (profileId, projectId) => invoke('shaders:remove', profileId, projectId),
  searchResourcepacks: (profileId, query, offset = 0) => invoke('resourcepacks:search', profileId, query, offset), listResourcepacks: profileId => invoke('resourcepacks:list', profileId), installResourcepack: (profileId, projectId) => invoke('resourcepacks:install', profileId, projectId), enableResourcepack: (profileId, projectId, enabled) => invoke('resourcepacks:enable', profileId, projectId, enabled), removeResourcepack: (profileId, projectId) => invoke('resourcepacks:remove', profileId, projectId),
  saveProfile: p => invoke('profile:save', p), selectProfile: id => invoke('profile:select', id), deleteProfile: id => invoke('profile:delete', id),
  cloneProfile: (id, name) => invoke('profile:clone', id, name), backupProfile: (id, name) => invoke('profile:backup', id, name), listBackups: id => invoke('profile:backups', id), restoreBackup: (id, backupId, worlds) => invoke('profile:restore-backup', id, backupId, worlds), deleteBackup: (id, backupId) => invoke('profile:delete-backup', id, backupId), listScreenshots: id => invoke('profile:screenshots', id), exportScreenshot: (id, filename) => invoke('screenshots:export', id, filename), profileServers: (id, servers) => invoke('profile:servers', id, servers), openBackups: id => invoke('folder:backups', id), openScreenshots: id => invoke('folder:screenshots', id), openCrashes: id => invoke('folder:crashes', id),
  removeVersion: id => invoke('version:remove', id), launch: id => invoke('launch', id), launchServer: (id, address) => invoke('server:launch', id, address),
  accounts: () => invoke('accounts:list'),
  selectAccount: id => invoke('accounts:select', id), removeAccount: id => invoke('accounts:remove', id),
  createLocalAccount: name => invoke('accounts:local', name),
  accountSkin: id => invoke('accounts:skin', id), listSkins: () => invoke('skins:list'), importSkin: (name, variant) => invoke('skins:import', name, variant),
  renameSkin: (id, name) => invoke('skins:rename', id, name), deleteSkin: id => invoke('skins:delete', id), applySkin: (accountId, skinId) => invoke('skins:apply', accountId, skinId),
  beginLogin: () => invoke('accounts:begin'), cancelLogin: () => invoke('accounts:cancel'), openLogin: () => invoke('accounts:browser'),
  inspectJava: executable => invoke('java:inspect', executable), browseJava: () => invoke('java:browse'), openFolder: () => invoke('folder:open'),
  checkUpdates: () => invoke('updates:check'), openUpdate: url => invoke('updates:open', url),
  on: (event, callback) => {
    if (!['progress', 'content-progress', 'log', 'game-start', 'game-exit', 'accounts-changed', 'auth-error'].includes(event)) return;
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on(`launcher:${event}`, handler);
    return () => ipcRenderer.removeListener(`launcher:${event}`, handler);
  }
});

