const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, clipboard, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Launcher, inspectJava, validId } = require('./core');
const { Accounts } = require('./auth');
const appConfig = require('./app-config.json');
const updater = require('./updater');

if (process.platform === 'win32') app.setAppUserModelId('com.blocklane.launcher');
const smoke = process.argv.includes('--smoke-test');
const dataOverride = process.env.BLOCKLANE_DATA_DIR;
const quickPlayArgument = args => {
  const index = args.indexOf('--quick-play');
  const id = index >= 0 ? args[index + 1] : null;
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id) ? id : null;
};
let runQuickPlay = null;
let pendingQuickPlay = quickPlayArgument(process.argv);
if (dataOverride) app.setPath('userData', path.resolve(dataOverride));
else if (smoke) app.setPath('userData', path.resolve(__dirname, '..', '.test-data'));
try { if (JSON.parse(fsSync.readFileSync(path.join(app.getPath('userData'), 'minecraft', 'state.json'), 'utf8')).settings?.hardwareAcceleration === false) app.disableHardwareAcceleration(); } catch {}
let window, launcher, accounts;
const page = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    const profileId = quickPlayArgument(commandLine);
    if (profileId && runQuickPlay) runQuickPlay(profileId);
    else if (profileId) pendingQuickPlay = profileId;
  });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}

async function start() {
  launcher = new Launcher(path.join(app.getPath('userData'), 'minecraft'), (event, data) => {
    if (window && !window.isDestroyed()) window.webContents.send(`launcher:${event}`, data);
    if (window && !window.isDestroyed() && event === 'game-start') {
      if (launcher.state.settings.launcherVisibility === 'minimize') window.minimize();
      if (launcher.state.settings.launcherVisibility === 'hide') window.hide();
    }
    if (window && !window.isDestroyed() && event === 'game-exit' && launcher.state.settings.launcherVisibility === 'hide') { window.show(); window.focus(); }
    if (event === 'game-exit' && data?.code !== 0 && launcher.state.settings.notifyCrash && Notification.isSupported()) new Notification({ title: 'Minecraft closed unexpectedly', body: 'Open Blocklane Activity to inspect the game log.', silent: !launcher.state.settings.notificationSound }).show();
  });
  await launcher.init();
  accounts = new Accounts(app.getPath('userData'), safeStorage, { clientId: app.isPackaged ? appConfig.microsoftClientId : process.env.BLOCKLANE_MICROSOFT_CLIENT_ID || appConfig.microsoftClientId });
  await accounts.init();
  launcher.authenticate = (id, signal) => accounts.session(id, signal);
  runQuickPlay = async profileId => {
    try {
      validId(profileId);
      const profile = launcher.state.profiles.find(item => item.id === profileId);
      if (!profile) throw new Error('This profile no longer exists.');
      await launcher.selectProfile(profile.id);
      await launcher.launch(profile.id, launcher.state.settings.defaultAccount || accounts.list().selected);
    } catch (error) {
      if (window && !window.isDestroyed()) window.webContents.send('launcher:quick-play-error', { profile: launcher.state.profiles.find(item => item.id === profileId)?.name || 'profile', message: error.message });
    }
  };
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Untrusted caller.');
    try { return { ok: true, data: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message, code: typeof error.code === 'string' ? error.code : null }; }
  });
  handle('state', () => launcher.snapshot());
  handle('settings:save', async settings => {
    const state = await launcher.saveSettings(settings);
    if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: state.settings.startWithWindows, args: state.settings.startMinimized ? ['--minimized'] : [] });
    window.webContents.setZoomFactor(state.settings.uiScale / 100);
    return state;
  });
  handle('storage:summary', () => launcher.storageSummary());
  handle('storage:details', category => launcher.storageDetails(category));
  handle('storage:delete-item', (category, key) => launcher.deleteStorageItem(category, key));
  handle('storage:inspect-orphan', id => launcher.inspectOrphan(id));
  handle('storage:recover-orphan', (id, name, version) => launcher.recoverOrphan(id, name, version));
  handle('storage:open-orphan', async id => { const folder = launcher.orphanFolder(id); await fs.access(folder).catch(() => { throw new Error('Orphaned profile data was not found.'); }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('storage:clear-cache', () => launcher.clearStorageCache());
  handle('storage:remove-unused', () => launcher.removeUnusedVersions());
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
  handle('content:import', async (profileId, kind) => { const settings = { mod: { title: 'Import mods', name: 'Java mod', extensions: ['jar'] }, shader: { title: 'Import shader packs', name: 'Shader pack', extensions: ['zip'] }, resourcepack: { title: 'Import resource packs', name: 'Resource pack', extensions: ['zip'] } }[kind]; if (!settings) throw new Error('Unsupported import type.'); const result = await dialog.showOpenDialog(window, { title: settings.title, properties: ['openFile', 'multiSelections'], filters: [{ name: settings.name, extensions: settings.extensions }] }); return result.canceled ? null : launcher.importContent(profileId, kind, result.filePaths); });
  handle('modpacks:search', (query, offset) => launcher.modpackSearch(query, offset));
  handle('modpacks:details', projectId => launcher.modpackDetails(projectId));
  handle('modpacks:list', () => launcher.modpackList());
  handle('modpacks:install', projectId => launcher.modpackInstall(projectId));
  handle('modpacks:import', async () => { const result = await dialog.showOpenDialog(window, { title: 'Import modpack', properties: ['openFile'], filters: [{ name: 'Supported modpacks', extensions: ['mrpack', 'zip'] }, { name: 'Modrinth modpack', extensions: ['mrpack'] }, { name: 'Prism, MultiMC, or CurseForge', extensions: ['zip'] }] }); return result.canceled ? null : launcher.modpackImport(result.filePaths[0]); });
  handle('modpacks:update', profileId => launcher.modpackUpdate(profileId));
  handle('modpacks:remove', profileId => launcher.modpackRemove(profileId));
  handle('custom-packs:list', () => launcher.customPackList());
  handle('custom-packs:create', input => launcher.customPackCreate(input));
  handle('custom-packs:prepare-profile', id => launcher.customPackPrepareProfile(id));
  handle('custom-packs:delete', id => launcher.customPackDelete(id));
  handle('custom-packs:export', async id => { const pack = (await launcher.customPackList()).find(item => item.id === id); if (!pack) throw new Error('Custom pack does not exist.'); const safeName = pack.name.replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 80) || 'custom-modpack'; const result = await dialog.showSaveDialog(window, { title: 'Export custom modpack', defaultPath: `${safeName}-${pack.versionId}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] }); return result.canceled || !result.filePath ? null : launcher.customPackExport(id, result.filePath); });
  handle('custom-packs:folder', async id => { const pack = (await launcher.customPackList()).find(item => item.id === id); if (!pack) throw new Error('Custom pack does not exist.'); const folder = path.join(launcher.root, 'custom-packs', pack.id, 'instance'); await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('custom-packs:mods-search', (id, query, offset) => launcher.customPackModSearch(id, query, offset));
  handle('custom-packs:mods-list', id => launcher.customPackModList(id));
  handle('custom-packs:mods-install', (id, projectId) => launcher.customPackModInstall(id, projectId));
  handle('custom-packs:mods-import', async id => { const result = await dialog.showOpenDialog(window, { title: 'Import mods into custom pack', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft mod', extensions: ['jar'] }] }); return result.canceled ? null : launcher.customPackModImport(id, result.filePaths); });
  handle('custom-packs:mods-remove', (id, projectId) => launcher.customPackModRemove(id, projectId));
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
  handle('profile:quick-play-shortcut', async id => {
    if (process.platform !== 'win32') throw new Error('Quick-play shortcuts are currently available on Windows.');
    validId(id);
    const profile = launcher.profile(id);
    const baseName = (profile.name || 'Minecraft profile').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim().slice(0, 80) || 'Minecraft profile';
    const desktop = app.getPath('desktop');
    let shortcut = path.join(desktop, `Blocklane — ${baseName}.lnk`), suffix = 2;
    while (await fs.access(shortcut).then(() => true).catch(() => false)) shortcut = path.join(desktop, `Blocklane — ${baseName} (${suffix++}).lnk`);
    const quote = value => `"${String(value).replace(/"/g, '\\"')}"`;
    const args = [...(process.defaultApp ? [path.resolve(__dirname, '..')] : []), '--quick-play', profile.id].map(quote).join(' ');
    if (!shell.writeShortcutLink(shortcut, 'create', { target: process.execPath, args, cwd: path.dirname(process.execPath), icon: process.execPath, iconIndex: 0, description: `Quick-play ${profile.name}` })) throw new Error('Windows could not create the shortcut.');
    return { path: shortcut, name: profile.name };
  });
  handle('profile:delete', id => launcher.deleteProfile(id));
  handle('profile:clone', (id, name) => launcher.cloneProfile(id, name));
  handle('profile:worlds', id => launcher.worlds(id));
  handle('profile:world-transfer', (sourceId, destinationId, names, move) => launcher.transferWorlds(sourceId, destinationId, names, move));
  handle('profile:world-delete', (id, names) => launcher.deleteWorlds(id, names));
  handle('profile:world-import-default', id => launcher.importWorldFolders(id, [path.join(app.getPath('appData'), '.minecraft', 'saves')]));
  handle('profile:world-import-folder', async id => { const result = await dialog.showOpenDialog(window, { title: 'Import Minecraft world folder', properties: ['openDirectory', 'multiSelections'] }); return result.canceled ? null : launcher.importWorldFolders(id, result.filePaths); });
  handle('profile:world-import-zip', async id => { const result = await dialog.showOpenDialog(window, { title: 'Import Minecraft world ZIP', properties: ['openFile', 'multiSelections'], filters: [{ name: 'ZIP archives', extensions: ['zip'] }] }); if (result.canceled) return null; const imported = []; for (const file of result.filePaths) imported.push(...(await launcher.importWorldZip(id, file)).imported); return { imported }; });
  handle('profile:backup', (id, name) => launcher.backupProfile(id, name));
  handle('profile:world-backup', (id, names, name) => launcher.backupWorlds(id, names, name));
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
  handle('launch', id => launcher.launch(id, launcher.state.settings.defaultAccount || accounts.list().selected));
  handle('server:launch', (id, address) => launcher.launchServer(id, launcher.state.settings.defaultAccount || accounts.list().selected, address));
  const idle = () => { if (launcher.working || launcher.child) throw new Error('Wait for the installation or game to finish before changing accounts.'); };
  const notifyAccounts = () => { if (window && !window.isDestroyed()) window.webContents.send('launcher:accounts-changed', accounts.list()); };
  handle('accounts:list', () => accounts.list());
  handle('clipboard:device-code', code => { if (typeof code !== 'string' || !/^[A-Z0-9-]{4,32}$/.test(code)) throw new Error('No valid Microsoft sign-in code is ready to copy.'); clipboard.writeText(code); return true; });
  handle('clipboard:text', text => { if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('This text cannot be copied.'); clipboard.writeText(text); return true; });
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
  handle('java:manager', async () => {
    const root = path.join(launcher.root, 'runtimes');
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const runtimes = [];
    for (const entry of entries.filter(item => item.isDirectory())) {
      const folder = path.join(root, entry.name), marker = await fs.readFile(path.join(folder, 'installed.json'), 'utf8').then(JSON.parse).catch(() => null), executable = path.join(folder, 'bin', 'java.exe');
      if (!marker || !fsSync.existsSync(executable)) continue;
      const java = await inspectJava(executable).catch(() => null);
      runtimes.push({ id: entry.name, executable, managed: true, major: marker.major, version: java?.version || marker.version || 'Unavailable', arch: java?.arch || 'Unknown', healthy: Boolean(java) });
    }
    const custom = [...new Set([...launcher.state.profiles.map(profile => profile.javaPath), launcher.state.settings.defaultJava].filter(value => value && !['auto', 'java', 'java.exe'].includes(value.trim().toLowerCase()) && !runtimes.some(runtime => runtime.executable === value)))];
    return { automatic: 'Blocklane automatically selects the Java version Minecraft requires and downloads a verified Mojang runtime when it is missing.', defaultJava: launcher.state.settings.defaultJava || 'auto', runtimes, custom: custom.map(executable => ({ executable, profiles: launcher.state.profiles.filter(profile => profile.javaPath === executable).map(profile => profile.name) })) };
  });
  handle('java:install', async major => {
    if (![8, 16, 17, 21, 25].includes(major)) throw new Error('Choose a supported Java version.');
    if (launcher.working || launcher.child) throw new Error('Wait for the current installation or game to finish.');
    launcher.busy = true; launcher.controller = new AbortController();
    try { const executable = await launcher.ensureJava({ javaVersion: { majorVersion: major } }, launcher.controller.signal); return { executable, java: await inspectJava(executable) }; }
    finally { launcher.busy = false; launcher.controller = null; }
  });
  handle('java:browse', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose Java executable', properties: ['openFile'], filters: [{ name: 'Java executable', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('version:remove', async id => {
    const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Keep version', 'Remove version'], defaultId: 0, cancelId: 0, title: 'Remove version', message: `Remove Minecraft ${String(id).slice(0, 100)}?`, detail: 'Your profiles, worlds, and shared assets will be kept. You can reinstall this version later.' });
    return result.response === 1 ? launcher.removeVersion(id) : launcher.snapshot();
  });
  handle('folder:open', async () => { const error = await shell.openPath(launcher.root); if (error) throw new Error(error); });
  handle('folder:runtimes', async () => { const folder = path.join(launcher.root, 'runtimes'); await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('logs:list', async () => {
    const folder = path.join(launcher.root, 'logs'), files = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    const result = await Promise.all(files.filter(item => item.isFile() && /\.log$/i.test(item.name)).map(async item => { const stat = await fs.stat(path.join(folder, item.name)); return { name: item.name, size: stat.size, modifiedAt: stat.mtime.toISOString() }; }));
    return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  });
  handle('logs:read', async name => { if (typeof name !== 'string' || path.basename(name) !== name || !/\.log$/i.test(name)) throw new Error('Invalid log file.'); const file = path.join(launcher.root, 'logs', name), stat = await fs.stat(file); const start = Math.max(0, stat.size - 1024 * 1024); const fileHandle = await fs.open(file, 'r'); try { const buffer = Buffer.alloc(stat.size - start); await fileHandle.read(buffer, 0, buffer.length, start); return { name, truncated: start > 0, text: buffer.toString('utf8') }; } finally { await fileHandle.close(); } });
  handle('logs:export', async name => { if (typeof name !== 'string' || path.basename(name) !== name || !/\.log$/i.test(name)) throw new Error('Invalid log file.'); const source = path.join(launcher.root, 'logs', name); await fs.access(source); const result = await dialog.showSaveDialog(window, { title: 'Export game log', defaultPath: name, filters: [{ name: 'Log file', extensions: ['log'] }] }); if (result.canceled || !result.filePath) return null; await fs.copyFile(source, result.filePath); return { path: result.filePath }; });
  handle('folder:logs', async () => { const folder = path.join(launcher.root, 'logs'); await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
  handle('updates:check', () => updater.check(launcher.state.settings.updateChannel));
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
  window = new BrowserWindow({ width: 1240, height: 850, minWidth: 1000, minHeight: 700, show: !smoke, title: 'Blocklane', icon: path.join(__dirname, '..', 'assets', 'icon.png'), backgroundColor: '#101412', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (!smoke) window.once('ready-to-show', () => {
    if (process.argv.includes('--minimized') || launcher.state.settings.startMinimized) window.minimize();
    else if (launcher.state.settings.startMaximized) window.maximize();
  });
  window.on('close', event => {
    if (!launcher.state.settings.confirmActiveExit || (!launcher.working && !launcher.child)) return;
    event.preventDefault();
    dialog.showMessageBoxSync(window, { type: 'info', title: 'Operation in progress', message: launcher.child ? 'Close Minecraft before closing the launcher.' : 'Cancel the installation or wait for it to finish before closing the launcher.' });
  });
  await window.loadURL(page);
  window.webContents.setZoomFactor(launcher.state.settings.uiScale / 100);
  if (!smoke && pendingQuickPlay) {
    const profileId = pendingQuickPlay;
    pendingQuickPlay = null;
    setTimeout(() => runQuickPlay(profileId), 150);
  }
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

