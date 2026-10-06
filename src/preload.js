const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
contextBridge.exposeInMainWorld('launcher', {
  state: () => invoke('state'), catalog: refresh => invoke('catalog', refresh),
  install: id => invoke('install', id), cancel: () => invoke('cancel'),
  installProfile: id => invoke('profile:install', id), loaderVersions: (loader, version) => invoke('loaders:versions', loader, version),
  openMods: id => invoke('folder:mods', id),
  searchMods: (profileId, query, offset = 0) => invoke('mods:search', profileId, query, offset),
  modDetails: (profileId, projectId) => invoke('mods:details', profileId, projectId), openModrinth: url => invoke('mods:open', url),
  listMods: profileId => invoke('mods:list', profileId), installMod: (profileId, projectId) => invoke('mods:install', profileId, projectId),
  enableMod: (profileId, projectId, enabled) => invoke('mods:enable', profileId, projectId, enabled),
  removeMod: (profileId, projectId) => invoke('mods:remove', profileId, projectId),
  modUpdates: profileId => invoke('mods:updates', profileId), updateAllMods: profileId => invoke('mods:update-all', profileId),
  saveProfile: p => invoke('profile:save', p), selectProfile: id => invoke('profile:select', id), deleteProfile: id => invoke('profile:delete', id),
  removeVersion: id => invoke('version:remove', id), launch: id => invoke('launch', id),
  accounts: () => invoke('accounts:list'),
  selectAccount: id => invoke('accounts:select', id), removeAccount: id => invoke('accounts:remove', id),
  createLocalAccount: name => invoke('accounts:local', name),
  beginLogin: () => invoke('accounts:begin'), cancelLogin: () => invoke('accounts:cancel'), openLogin: () => invoke('accounts:browser'),
  inspectJava: executable => invoke('java:inspect', executable), browseJava: () => invoke('java:browse'), openFolder: () => invoke('folder:open'),
  checkUpdates: () => invoke('updates:check'), openUpdate: url => invoke('updates:open', url),
  on: (event, callback) => {
    if (!['progress', 'log', 'game-start', 'game-exit', 'accounts-changed', 'auth-error'].includes(event)) return;
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on(`launcher:${event}`, handler);
    return () => ipcRenderer.removeListener(`launcher:${event}`, handler);
  }
});

