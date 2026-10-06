const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Launcher, inspectJava } = require('./core');
const { Accounts } = require('./auth');
const appConfig = require('./app-config.json');

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
    catch (error) { return { ok: false, error: error.message }; }
  });
  handle('state', () => launcher.snapshot());
  handle('catalog', refresh => launcher.catalog(Boolean(refresh)));
  handle('install', id => launcher.install(id));
  handle('cancel', () => launcher.cancel());
  handle('profile:save', p => launcher.saveProfile(p));
  handle('profile:select', id => launcher.selectProfile(id));
  handle('profile:delete', id => launcher.deleteProfile(id));
  handle('launch', id => launcher.launch(id, accounts.list().selected));
  const idle = () => { if (launcher.busy || launcher.child) throw new Error('Wait for the installation or game to finish before changing accounts.'); };
  const notifyAccounts = () => { if (window && !window.isDestroyed()) window.webContents.send('launcher:accounts-changed', accounts.list()); };
  handle('accounts:list', () => accounts.list());
  handle('accounts:select', id => { idle(); return accounts.select(id); });
  handle('accounts:remove', id => { idle(); return accounts.remove(id); });
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
  window = new BrowserWindow({ width: 1240, height: 850, minWidth: 1000, minHeight: 700, show: !smoke, title: 'Blocklane', backgroundColor: '#101412', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (!launcher.busy && !launcher.child) return;
    event.preventDefault();
    dialog.showMessageBoxSync(window, { type: 'info', title: 'Operation in progress', message: launcher.child ? 'Close Minecraft before closing the launcher.' : 'Cancel the installation or wait for it to finish before closing the launcher.' });
  });
  await window.loadURL(page);
  if (smoke) {
    // Exercise the actual sandboxed renderer and IPC, then save a UI capture.
    const result = await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async (fn) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('UI wait timed out'); };
      await waitFor(() => document.querySelector('#latest-version').textContent !== '—');
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
      return { title: document.title, bridge: Boolean(window.launcher), nodeDisabled: typeof require === 'undefined', catalogRendered: true, profileSaved: true };
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
