const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Launcher, inspectJava, validId } = require('./core');
const { Accounts } = require('./auth');
const appConfig = require('./app-config.json');
const updater = require('./updater');

const smoke = process.argv.includes('--smoke-test');
const dataOverride = process.env.BLOCKLANE_DATA_DIR;
if (dataOverride) app.setPath('userData', path.resolve(dataOverride));
else if (smoke) app.setPath('userData', path.resolve(__dirname, '..', '.test-data'));
let window, launcher, accounts;
const page = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}

async function start() {
  launcher = new Launcher(path.join(app.getPath('userData'), 'minecraft'), (event, data) => {
    if (window && !window.isDestroyed()) window.webContents.send(`launcher:${event}`, data);
  });
  await launcher.init();
  accounts = new Accounts(app.getPath('userData'), safeStorage, { clientId: app.isPackaged ? appConfig.microsoftClientId : process.env.BLOCKLANE_MICROSOFT_CLIENT_ID || appConfig.microsoftClientId });
  await accounts.init();
  launcher.authenticate = (id, signal) => accounts.session(id, signal);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Untrusted caller.');
    try { return { ok: true, data: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message, code: typeof error.code === 'string' ? error.code : null }; }
  });
  handle('state', () => launcher.snapshot());
  handle('catalog', refresh => launcher.catalog(Boolean(refresh)));
  handle('install', id => launcher.install(id));
  handle('profile:install', id => launcher.installProfile(id));
  handle('loaders:versions', (loader, version) => launcher.loaderVersions(loader, version));
  handle('mods:search', (profileId, query, offset) => launcher.modSearch(profileId, query, offset));
  handle('mods:details', (profileId, projectId) => launcher.modDetails(profileId, projectId));
  handle('mods:open', async url => { const parsed = new URL(String(url)); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Only secure HTTPS links can be opened.'); return shell.openExternal(parsed.href); });
  handle('mods:list', profileId => launcher.modList(profileId));
  handle('mods:install', (profileId, projectId, allowMissingDependencies) => launcher.modInstall(profileId, projectId, Boolean(allowMissingDependencies)));
  handle('mods:enable', (profileId, projectId, enabled) => launcher.modEnable(profileId, projectId, enabled));
  handle('mods:remove', (profileId, projectId) => launcher.modRemove(profileId, projectId));
  handle('mods:updates', profileId => launcher.modUpdates(profileId));
  handle('mods:update-all', profileId => launcher.modUpdateAll(profileId));
  handle('modpacks:search', (query, offset) => launcher.modpackSearch(query, offset));
  handle('modpacks:details', projectId => launcher.modpackDetails(projectId));
  handle('modpacks:list', () => launcher.modpackList());
  handle('modpacks:install', projectId => launcher.modpackInstall(projectId));
  handle('modpacks:import', async () => { const result = await dialog.showOpenDialog(window, { title: 'Import Modrinth modpack', properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] }); return result.canceled ? null : launcher.modpackImport(result.filePaths[0]); });
  handle('modpacks:update', profileId => launcher.modpackUpdate(profileId));
  handle('modpacks:remove', profileId => launcher.modpackRemove(profileId));
  handle('shaders:status', profileId => launcher.shaderStatus(profileId));
  handle('shaders:search', (profileId, query, offset) => launcher.shaderSearch(profileId, query, offset));
  handle('shaders:list', profileId => launcher.shaderList(profileId));
  handle('shaders:install', (profileId, projectId) => launcher.shaderInstall(profileId, projectId));
  handle('shaders:enable', (profileId, projectId, enabled) => launcher.shaderEnable(profileId, projectId, enabled));
  handle('shaders:remove', (profileId, projectId) => launcher.shaderRemove(profileId, projectId));
  handle('resourcepacks:search', (profileId, query, offset) => launcher.resourcepackSearch(profileId, query, offset));
  handle('resourcepacks:list', profileId => launcher.resourcepackList(profileId));
  handle('resourcepacks:install', (profileId, projectId) => launcher.resourcepackInstall(profileId, projectId));
  handle('resourcepacks:enable', (profileId, projectId, enabled) => launcher.resourcepackEnable(profileId, projectId, enabled));
  handle('resourcepacks:remove', (profileId, projectId) => launcher.resourcepackRemove(profileId, projectId));
  handle('cancel', () => launcher.cancel());
  handle('profile:save', p => launcher.saveProfile(p));
  handle('profile:select', id => launcher.selectProfile(id));
  handle('profile:delete', id => launcher.deleteProfile(id));
  handle('profile:clone', (id, name) => launcher.cloneProfile(id, name));
  handle('profile:worlds', id => launcher.worlds(id));
  handle('profile:world-transfer', (sourceId, destinationId, names, move) => launcher.transferWorlds(sourceId, destinationId, names, move));
  handle('profile:world-import-default', id => launcher.importWorldFolders(id, [path.join(app.getPath('appData'), '.minecraft', 'saves')]));
  handle('profile:world-import-folder', async id => { const result = await dialog.showOpenDialog(window, { title: 'Import Minecraft world folder', properties: ['openDirectory', 'multiSelections'] }); return result.canceled ? null : launcher.importWorldFolders(id, result.filePaths); });
  handle('profile:world-import-zip', async id => { const result = await dialog.showOpenDialog(window, { title: 'Import Minecraft world ZIP', properties: ['openFile', 'multiSelections'], filters: [{ name: 'ZIP archives', extensions: ['zip'] }] }); if (result.canceled) return null; const imported = []; for (const file of result.filePaths) imported.push(...(await launcher.importWorldZip(id, file)).imported); return { imported }; });
  handle('profile:backup', (id, name) => launcher.backupProfile(id, name));
  handle('profile:backups', id => launcher.backups(id));
  handle('profile:restore-backup', (id, backupId, worlds) => launcher.restoreBackup(id, backupId, worlds));
  handle('profile:delete-backup', (id, backupId) => launcher.deleteBackup(id, backupId));
  handle('profile:screenshots', id => launcher.screenshots(id));
  handle('screenshots:export', async (id, filename) => {
    validId(id); if (typeof filename !== 'string' || path.basename(filename) !== filename || !/\.(png|jpe?g)$/i.test(filename)) throw new Error('Invalid screenshot file.');
    const profile = launcher.profile(id), source = path.join(launcher.root, 'instances', profile.id, 'screenshots', filename); await fs.access(source);
    const target = await dialog.showSaveDialog(window, { title: 'Export screenshot', defaultPath: filename, filters: [{ name: 'Image', extensions: [path.extname(filename).slice(1)] }] });
    if (target.canceled || !target.filePath) return { cancelled: true }; await fs.copyFile(source, target.filePath); return { exported: true };
  });
  handle('profile:servers', (id, servers) => launcher.servers(id, servers));
  handle('launch', id => launcher.launch(id, accounts.list().selected));
  handle('server:launch', (id, address) => launcher.launchServer(id, accounts.list().selected, address));
  const idle = () => { if (launcher.working || launcher.child) throw new Error('Wait for the installation or game to finish before changing accounts.'); };
  const notifyAccounts = () => { if (window && !window.isDestroyed()) window.webContents.send('launcher:accounts-changed', accounts.list()); };
  handle('accounts:list', () => accounts.list());
  handle('accounts:select', id => { idle(); return accounts.select(id); });
  handle('accounts:local', name => { idle(); return accounts.createLocal(name); });
  handle('accounts:remove', id => { idle(); return accounts.remove(id); });
  handle('accounts:skin', id => accounts.skin(id));
  handle('skins:list', () => accounts.skins());
  handle('skins:import', async (name, variant) => {
    idle(); const result = await dialog.showOpenDialog(window, { title: 'Import Minecraft skin', properties: ['openFile'], filters: [{ name: 'Minecraft skin PNG', extensions: ['png'] }] });
    return result.canceled ? null : accounts.importSkin(result.filePaths[0], name, variant);
  });
  handle('skins:rename', (id, name) => accounts.renameSkin(id, name));
  handle('skins:delete', id => accounts.deleteSkin(id));
  handle('skins:apply', (accountId, skinId) => { idle(); return accounts.applySkin(accountId, skinId); });
  handle('accounts:begin', async () => {
    idle();
    const info = await accounts.begin();
    accounts.finish().then(notifyAccounts).catch(error => {
      if (window && !window.isDestroyed()) { window.webContents.send('launcher:auth-error', error.name === 'AbortError' ? 'Sign-in cancelled.' : error.message); notifyAccounts(); }
    });
    return info;
  });
  handle('accounts:cancel', () => accounts.cancel());
  handle('accounts:browser', () => {
    if (!accounts.pending?.uri) throw new Error('Start sign-in first.');
    return shell.openExternal(accounts.pending.uri);
  });
  handle('java:inspect', executable => inspectJava(executable || 'java'));
  handle('java:browse', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose Java executable', properties: ['openFile'], filters: [{ name: 'Java executable', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('version:remove', async id => {
    const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Keep version', 'Remove version'], defaultId: 0, cancelId: 0, title: 'Remove version', message: `Remove Minecraft ${String(id).slice(0, 100)}?`, detail: 'Your profiles, worlds, and shared assets will be kept. You can reinstall this version later.' });
    return result.response === 1 ? launcher.removeVersion(id) : launcher.snapshot();
  });
  handle('folder:open', async () => { const error = await shell.openPath(launcher.root); if (error) throw new Error(error); });
  handle('updates:check', () => updater.check());
  handle('updates:open', async url => { const parsed = new URL(String(url)); if (parsed.protocol !== 'https:' || !['github.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) throw new Error('Only GitHub update links can be opened.'); return shell.openExternal(parsed.href); });
  handle('folder:mods', async id => {
    validId(id);
    if (!launcher.state.profiles.some(p => p.id === id)) throw new Error('Profile does not exist.');
    const folder = path.join(launcher.root, 'instances', id, 'mods');
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw new Error(error);
  });
  handle('folder:screenshots', async id => { validId(id); const profile = launcher.profile(id); const folder = path.join(launcher.root, 'instances', profile.id, 'screenshots'); await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('folder:crashes', async id => { validId(id); const profile = launcher.profile(id); const folder = path.join(launcher.root, 'instances', profile.id, 'crash-reports'); await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('folder:backups', async id => { validId(id); const profile = launcher.profile(id); const folder = path.join(launcher.root, 'backups', profile.id); await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('folder:shaderpacks', async id => {
    validId(id);
    if (!launcher.state.profiles.some(p => p.id === id)) throw new Error('Profile does not exist.');
    const folder = path.join(launcher.root, 'instances', id, 'shaderpacks');
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw new Error(error);
  });
  handle('folder:resourcepacks', async id => {
    validId(id); if (!launcher.state.profiles.some(p => p.id === id)) throw new Error('Profile does not exist.');
    const folder = path.join(launcher.root, 'instances', id, 'resourcepacks'); await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw new Error(error);
  });
  window = new BrowserWindow({ width: 1240, height: 850, minWidth: 1000, minHeight: 700, show: !smoke, title: 'Blocklane', backgroundColor: '#101412', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (!launcher.working && !launcher.child) return;
    event.preventDefault();
    dialog.showMessageBoxSync(window, { type: 'info', title: 'Operation in progress', message: launcher.child ? 'Close Minecraft before closing the launcher.' : 'Cancel the installation or wait for it to finish before closing the launcher.' });
  });
  await window.loadURL(page);
  if (smoke) {
    // Exercise the actual sandboxed renderer and IPC, then save a UI capture.
    const result = await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async (fn) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('UI wait timed out'); };
      await waitFor(() => document.querySelector('#latest-version').textContent !== '—');
      const originalRunModTask = window.runModTask;
      window.runModTask = async () => { throw new Error('Required dependency 8BmcQJ2H has no compatible fabric file for Minecraft 26.3.'); };
      await window.installLibraryItem({ kind: 'mod', profileId: 'smoke', projectId: 'abcdefgh' }, () => {}, () => {});
      if (!document.querySelector('#missing-dependency-dialog').open || !document.querySelector('#install-anyway')) throw new Error('Missing-dependency override dialog did not open');
      document.querySelector('#cancel-missing-dependency').click(); window.runModTask = originalRunModTask;
      const state = await window.launcher.state();
      document.querySelector('[data-view="versions"]').click();
      if (!document.querySelector('#view-versions').classList.contains('active')) throw new Error('Navigation failed');
      if (!document.querySelector('.version-row')) throw new Error('Live catalog did not render');
      document.querySelector('[data-filter="snapshot"]').click();
      document.querySelector('[data-view="profiles"]').click();
      document.querySelector('#new-profile').click();
      document.querySelector('#profile-name').value = 'My survival world';
      document.querySelector('#profile-form').requestSubmit();
      await waitFor(() => !document.querySelector('#profile-dialog').open);
      const saved = await window.launcher.state();
      if (saved.profiles.length !== state.profiles.length + 1) throw new Error('Profile persistence failed');
      document.querySelector('[data-view="play"]').click();
      if (!document.querySelector('#play-button').textContent.includes('Install')) throw new Error('Install action missing');
      document.querySelector('#edit-active').click();
      document.querySelector('#profile-version').value = '1.21.1';
      for (const loader of ['fabric', 'forge', 'neoforge']) {
        document.querySelector('#profile-loader').value = loader;
        document.querySelector('#profile-loader').dispatchEvent(new Event('change'));
        await waitFor(() => !document.querySelector('#save-profile').disabled);
        if (!document.querySelector('#profile-loader-version').value) throw new Error('Loader catalog missing: ' + loader);
      }
      document.querySelector('#profile-form').requestSubmit();
      await waitFor(() => !document.querySelector('#profile-dialog').open);
      const modded = (await window.launcher.state()).profiles.find(p => p.id === saved.selectedProfile);
      if (modded.loader !== 'neoforge' || !modded.loaderVersion) throw new Error('Modded profile persistence failed');
      return { title: document.title, bridge: Boolean(window.launcher), nodeDisabled: typeof require === 'undefined', catalogRendered: true, dependencyDialog: true, profileSaved: true, loaderCatalogs: true, moddedProfileSaved: true };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const screenshot = await window.webContents.capturePage();
    await fs.writeFile(path.join(app.getPath('userData'), 'smoke.png'), screenshot.toPNG());
    console.log('SMOKE_OK ' + JSON.stringify(result));
    app.exit(0);
  }
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => accounts?.cancel());

