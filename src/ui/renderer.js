const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const api = window.launcher;
let state = { profiles: [], installed: [], selectedProfile: null };
let catalog = { versions: [], latest: {} };
let filter = 'release', limit = 40, busy = false, running = false, javaInstalling = false, toastTimer;
let latestLauncherUpdate = null, launcherUpdateCheckPending = false;
let accountState = { selected: 'demo', configured: false, accounts: [{ id: 'demo', name: 'Demo player', type: 'demo' }] };
let skinLibrary = [], skinAccountId = null, skinLoadRequest = 0;
let loginStarting = false;
let loaderRequest = 0, loaderLoading = false;
let modState = null, modSearchState = { query: '', offset: 0, total: 0, hits: [] }, modUpdates = [], modRequest = 0;
let shaderState = null, shaderSearchState = { query: '', offset: 0, total: 0, hits: [] }, shaderAdapter = null, libraryTab = 'mods';
let resourcepackState = null, resourcepackSearchState = { query: '', offset: 0, total: 0, hits: [] };
let installedModpacks = [], customPacks = [], modpackSearchState = { query: '', offset: 0, total: 0, hits: [] }, modpackRequest = 0;
let customPackEditor = null, customPackMods = null, customPackModHits = [];
const contentDownloads = new Map();
let pendingDependencyInstall = null;
const dependencyInstallQueue = [];
const loaderNames = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', liteloader: 'LiteLoader' };
let settingsTab = 'launcher';
let logFiles = [], activeLog = null, activeLogText = '';
const settingSections = {
  launcher: { label: 'Launcher', fields: [
    ['startWithWindows', 'Start with Windows', 'Open Blocklane when you sign in.', 'toggle'], ['startMinimized', 'Start minimized', 'Open in the background at Windows sign-in. This takes priority over maximize.', 'toggle'], ['startMaximized', 'Start maximized', 'Open Blocklane at full window size on startup.', 'toggle'], ['minimizeToTray', 'Minimize to tray', 'Keep Blocklane available from the notification area.', 'toggle'], ['launcherVisibility', 'While Minecraft runs', 'Keep Blocklane open, minimize it, or hide it until the game closes.', 'select', [['keep','Keep open'],['minimize','Minimize'],['hide','Hide until exit']]], ['confirmActiveExit', 'Confirm active exit', 'Prevent accidental closing during a game or download.', 'toggle'], ['rememberPage', 'Remember last page', 'Return to the section you last used.', 'toggle'], ['compactSidebar', 'Compact sidebar', 'Use a narrower navigation layout.', 'toggle'], ['uiScale', 'Interface scale', 'Scale the launcher interface.', 'select', [[80,'80%'],[90,'90%'],[100,'100%'],[110,'110%'],[125,'125%']]], ['theme', 'Theme', 'Choose dark, light, or follow Windows.', 'select', [['dark','Dark'],['light','Light'],['system','System']]], ['reducedMotion', 'Reduced motion', 'Disable nonessential interface animation.', 'toggle'] ] },
  minecraft: { label: 'Minecraft', fields: [
    ['defaultMemory','Default memory','Memory selected for new profiles.','select',[[2,'2 GB'],[4,'4 GB'],[6,'6 GB'],[8,'8 GB'],[12,'12 GB'],[16,'16 GB']]], ['defaultJava','Default Java runtime','Use managed Java or a custom executable for new profiles.','text'], ['defaultWidth','Default width','Default game window width for new profiles.','number'], ['defaultHeight','Default height','Default game window height for new profiles.','number'], ['defaultFullscreen','Exclusive fullscreen','Enable fullscreen for new profiles.','toggle'], ['defaultJvmArgs','Default JVM arguments','Extra JVM arguments for new profiles, separated by spaces.','text'], ['defaultGameArgs','Default game arguments','Extra Minecraft arguments for new profiles, separated by spaces.','text'], ['defaultLoader','Default mod loader','Loader selected when creating a profile.','select',[['vanilla','Vanilla'],['fabric','Fabric'],['quilt','Quilt'],['forge','Forge'],['neoforge','NeoForge'],['liteloader','LiteLoader']]], ['selectLastProfile','Select last profile','Keep the most recently played profile selected.','toggle'], ['requireAccountChoice','Require account selection','Ask for an account before every launch.','toggle'] ] },
  downloads: { label: 'Downloads', fields: [
    ['downloadConcurrency','Simultaneous downloads','Maximum files downloaded at once.','select',[[1,'1'],[2,'2'],[4,'4'],[6,'6'],[8,'8']]], ['downloadLimitMbps','Speed limit','Maximum download speed in Mbps; zero is unlimited.','number'], ['downloadRetries','Retry count','Attempts after a failed download.','select',[[0,'None'],[1,'1'],[2,'2'],[3,'3'],[5,'5']]], ['downloadTimeout','Timeout','Seconds before an inactive download fails.','number'], ['verifyDownloads','Verify checksums','Validate downloaded files whenever a checksum is available.','toggle'], ['pauseDownloadsWhilePlaying','Pause while playing','Avoid background downloads while Minecraft runs.','toggle'], ['downloadNotifications','Completion notifications','Notify when a long download finishes.','toggle'] ] },
  updates: { label: 'Updates', fields: [
    ['autoCheckUpdates','Launcher update checks','Check GitHub when Blocklane starts.','toggle'], ['updateChannel','Update channel','Choose stable, beta, or development builds.','select',[['stable','Stable'],['beta','Beta'],['development','Development']]], ['autoDownloadUpdates','Download launcher updates','Download updates automatically when available.','toggle'], ['checkModUpdates','Check mod updates','Check managed mods for newer compatible releases.','toggle'], ['checkModpackUpdates','Check modpack updates','Check installed managed packs.','toggle'], ['checkLoaderUpdates','Check loader updates','Check Fabric, Quilt, Forge, NeoForge, and LiteLoader.','toggle'], ['updateNotifyOnly','Notify before installing','Require an explicit install action for updates.','toggle'] ] },
  storage: { label: 'Storage', fields: [
    ['cacheLimitGb','Download cache limit','Maximum cached download data in GB.','number'], ['autoCleanCache','Clean cache automatically','Remove old cached downloads when the limit is reached.','toggle'], ['removeUnusedLibraries','Remove unused libraries','Delete shared libraries that no installed version requires.','toggle'], ['storageWarningGb','Free-space warning','Warn when the drive has fewer than this many GB available.','number'] ] },
  backups: { label: 'Backups', fields: [
    ['backupBeforeLaunch','Before every launch','Create a world backup before starting Minecraft.','toggle'], ['backupBeforeVersionChange','Before version changes','Protect worlds before opening them with another Minecraft version.','toggle'], ['backupBeforeContentUpdate','Before content updates','Back up before mod or modpack changes.','toggle'], ['backupFrequency','Scheduled backups','Choose an automatic backup interval.','select',[['manual','Manual only'],['daily','Daily'],['weekly','Weekly']]], ['backupRetention','Backups to retain','Maximum automatic backups per profile.','number'], ['maxBackupGb','Storage limit','Maximum backup storage in GB.','number'], ['removeOldBackups','Remove oldest automatically','Prune old backups when limits are reached.','toggle'], ['backupScreenshots','Include screenshots','Store screenshots in full-profile backups.','toggle'], ['backupConfigs','Include configuration','Include configuration files.','toggle'], ['backupContent','Include packs and mods','Include mods, shaders, and resource packs.','toggle'], ['compressBackups','Compress backups','Use ZIP archives to reduce disk usage.','toggle'], ['verifyBackups','Verify after creation','Check that a backup can be read after it is written.','toggle'] ] },
  content: { label: 'Content', fields: [
    ['autoDependencies','Install required dependencies','Automatically install compatible required dependencies.','toggle'], ['askOptionalDependencies','Ask about optional dependencies','Offer compatible optional dependencies during installation.','toggle'], ['allowMissingDependencies','Allow missing dependencies','Show an Install anyway option when required files are unavailable.','toggle'], ['releaseChannel','Preferred releases','Select stable, beta, or alpha mod versions.','select',[['stable','Stable only'],['beta','Stable + beta'],['alpha','All releases']]], ['autoUpdateMods','Automatic mod updates','Update managed mods when compatible versions exist.','toggle'], ['preserveOldMods','Preserve replaced mods','Keep disabled copies when updating.','toggle'], ['detectIncompatibleMods','Compatibility check','Check installed mods before launch.','toggle'], ['warnDuplicateMods','Duplicate warnings','Warn when multiple files provide the same mod.','toggle'], ['modrinthSort','Modrinth sorting','Default order for discovery results.','select',[['downloads','Downloads'],['relevance','Relevance'],['updated','Recently updated'],['newest','Newest']]] ] },
  privacy: { label: 'Privacy & logs', fields: [
    ['loggingEnabled','Game logging','Capture Minecraft output and write latest-launch.log.','toggle'], ['launcherDiagnostics','Launcher diagnostics','Record launcher errors and operations.','toggle'], ['logRetentionDays','Delete logs after','Days to keep diagnostic logs; zero keeps them indefinitely.','number'], ['redactDiagnostics','Redact exported diagnostics','Hide usernames, UUIDs, paths, and account identifiers.','toggle'], ['crashReports','Crash helper','Analyze Minecraft crash reports after unexpected exits.','toggle'], ['networkDiagnostics','Network diagnostics','Record download timing and HTTP status information.','toggle'], ['streamingMode','Streaming mode','Hide account names in the interface.','toggle'] ] },
  accounts: { label: 'Accounts', fields: [
    ['defaultAccount','Default account','Account selected for launches unless profile selection is required.','select',[]], ['refreshSessions','Refresh Microsoft sessions','Refresh expiring authentication automatically.','toggle'], ['protectLocalProfiles','Protect local profiles','Require confirmation before deleting local accounts.','toggle'], ['requireAccountChoice','Choose account each launch','Do not silently use the selected account.','toggle'], ['streamingMode','Hide account names','Mask account names while streaming.','toggle'] ] },
  performance: { label: 'Performance', fields: [
    ['limitCpuWhilePlaying','Limit launcher CPU','Reduce launcher background work while Minecraft runs.','toggle'], ['pauseCatalogWhilePlaying','Pause catalog requests','Stop background discovery requests while playing.','toggle'], ['hardwareAcceleration','Hardware acceleration','Use GPU acceleration for the launcher interface after restart.','toggle'], ['cacheImages','Cache project images','Keep Modrinth thumbnails for faster browsing.','toggle'], ['imageCacheMb','Image cache size','Maximum thumbnail cache size in MB.','number'], ['reduceMotionWhilePlaying','Reduce motion while playing','Suspend interface animations while Minecraft runs.','toggle'] ] },
  notifications: { label: 'Notifications', fields: [
    ['notifyLaunchFailure','Launch failures','Notify when Minecraft cannot start.','toggle'], ['notifyCrash','Minecraft crashes','Notify after an unexpected exit.','toggle'], ['notifyInstall','Completed installs','Notify when game or content installation finishes.','toggle'], ['notifyBackup','Completed backups','Notify when a backup finishes.','toggle'], ['notifyUpdates','Available updates','Notify when launcher or content updates exist.','toggle'], ['notifyIncompatibility','Compatibility warnings','Notify about incompatible content.','toggle'], ['notificationSound','Notification sound','Allow Windows notification sounds.','toggle'], ['quietWhilePlaying','Quiet while playing','Suppress noncritical notifications during Minecraft.','toggle'] ] }
};

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function button(text, className, action) { const node = el('button', className, text); node.addEventListener('click', () => guard(action)); return node; }
function closeCustomSelects(except = null) { $$('.select-shell.open').forEach(shell => { if (shell !== except) { shell.classList.remove('open'); shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false'); } }); }
function syncCustomSelect(select) {
  const shell = select.closest('.select-shell'); if (!shell) return;
  const trigger = shell.querySelector('.select-trigger'), options = shell.querySelector('.select-options'), selected = select.selectedOptions[0];
  trigger.querySelector('.select-trigger-label').textContent = selected?.textContent?.trim() || 'Choose an option';
  trigger.disabled = select.disabled; trigger.setAttribute('aria-disabled', String(select.disabled));
  options.replaceChildren();
  for (const option of select.options) {
    const item = el('button', `select-option${option.selected ? ' selected' : ''}`, option.textContent.trim());
    item.type = 'button'; item.disabled = option.disabled; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
    item.addEventListener('click', () => { if (option.disabled) return; select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); syncCustomSelect(select); closeCustomSelects(); });
    options.append(item);
  }
}
function enhanceCustomSelect(select) {
  if (select.dataset.customSelect === 'true') return syncCustomSelect(select);
  select.dataset.customSelect = 'true'; select.classList.add('native-select'); select.tabIndex = -1;
  const shell = el('div', 'select-shell'), trigger = el('button', 'select-trigger'), label = el('span', 'select-trigger-label'), chevron = el('span', 'select-chevron', '⌄'), options = el('div', 'select-options');
  trigger.type = 'button'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.getAttribute('aria-label') || document.querySelector(`label[for="${select.id}"]`)?.textContent?.trim() || 'Choose an option');
  options.setAttribute('role', 'listbox'); trigger.append(label, chevron);
  select.parentNode.insertBefore(shell, select); shell.append(select, trigger, options);
  trigger.addEventListener('click', () => { const opening = !shell.classList.contains('open'); closeCustomSelects(shell); shell.classList.toggle('open', opening); trigger.setAttribute('aria-expanded', String(opening)); if (opening) syncCustomSelect(select); });
  trigger.addEventListener('keydown', event => { if (event.key === 'Escape') { closeCustomSelects(); trigger.focus(); } if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!shell.classList.contains('open')) trigger.click(); } });
  select.addEventListener('change', () => syncCustomSelect(select)); syncCustomSelect(select);
}
function enhanceCustomSelects(root = document) { root.querySelectorAll?.('select').forEach(enhanceCustomSelect); }
document.addEventListener('click', event => { if (!event.target.closest('.select-shell')) closeCustomSelects(); });
new MutationObserver(records => { if (records.some(record => record.target instanceof HTMLSelectElement || [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && (node.matches?.('select') || node.querySelector?.('select'))))) queueMicrotask(() => enhanceCustomSelects()); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
enhanceCustomSelects();
function toast(message, error = false) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 12000 : 4500); }
function log(message) { if (state.settings?.loggingEnabled === false) return; const box = $('#log'); box.textContent = (box.textContent + `\n[${new Date().toLocaleTimeString()}] ${message}`).slice(-80000); box.scrollTop = box.scrollHeight; }
async function guard(action) { try { return await action(); } catch (e) { toast(e.message, true); log(e.message); } }
function navigate(view) { $$('.view').forEach(n => n.classList.toggle('active', n.id === `view-${view}`)); $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view)); $('#page-title').textContent = view === 'activity' ? 'Logs' : view[0].toUpperCase() + view.slice(1); if (state.settings?.rememberPage) localStorage.setItem('blocklane:last-page', view); if (view === 'mods') guard(loadModsView); if (view === 'modpacks') guard(loadModpacks); if (view === 'backups') guard(loadBackups); if (view === 'screenshots') guard(loadScreenshots); if (view === 'skins') guard(loadSkins); if (view === 'activity') guard(loadLogViewer); if (view === 'java') guard(loadJavaManager); if (view === 'settings') renderSettings(); }

function renderVisibleLog() { const query = $('#log-search').value.trim().toLowerCase(); const lines = activeLogText.split(/\r?\n/); const visible = query ? lines.filter(line => line.toLowerCase().includes(query)) : lines; $('#log').textContent = visible.join('\n') || (query ? 'No matching lines.' : 'This log is empty.'); $('#log-meta').textContent = activeLog ? `${activeLog.name} · ${formatBytes(activeLog.size)} · ${new Date(activeLog.modifiedAt).toLocaleString()}${query ? ` · ${visible.length.toLocaleString()} matching lines` : ''}` : 'Live launcher activity is shown here until a game log is available.'; }
async function loadLogViewer() { logFiles = await api.listLogs(); const select = $('#log-file'), selected = select.value; select.replaceChildren(); if (!logFiles.length) { activeLog = null; activeLogText = ''; select.append(el('option', '', 'No saved game logs yet')); select.disabled = true; renderVisibleLog(); return; } select.disabled = false; for (const file of logFiles) { const option = el('option', '', file.name); option.value = file.name; select.append(option); } select.value = logFiles.some(file => file.name === selected) ? selected : logFiles[0].name; await loadSelectedLog(); }
async function loadSelectedLog() { const name = $('#log-file').value; if (!name) return; const result = await api.readLog(name); activeLog = logFiles.find(file => file.name === name) || { name, size: result.text.length, modifiedAt: new Date().toISOString() }; activeLogText = result.text; if (result.truncated) activeLogText = '[Showing the last 1 MB of this log.]\n' + activeLogText; renderVisibleLog(); }
async function chooseJavaDefault(executable) { state = await api.saveSettings({ ...state.settings, defaultJava: executable }); await loadJavaManager(); }
async function loadJavaManager() { const data = await api.javaManager(), automatic = ['', 'auto', 'java', 'java.exe'].includes(String(data.defaultJava || '').trim().toLowerCase()); const toggle = $('#java-auto-toggle'); toggle.setAttribute('aria-checked', String(automatic)); toggle.classList.toggle('active', automatic); toggle.querySelector('b').textContent = automatic ? 'Automatic' : 'Manual'; $('#java-auto-copy').textContent = automatic ? data.automatic : `Manual selection is active. Profiles set to auto use ${data.defaultJava}.`; const list = $('#java-runtime-list'), custom = $('#java-custom-list'); list.replaceChildren(); custom.replaceChildren(); if (!data.runtimes.length) list.append(el('div', 'empty', 'No managed runtime is installed yet. Choose a Java version above to install one.')); for (const runtime of data.runtimes) { const selected = !automatic && data.defaultJava === runtime.executable, card = el('article', `java-runtime-card selectable${selected ? ' selected' : ''}`); const action = button(selected ? 'Selected' : 'Use this Java', selected ? 'primary small' : 'quiet small', () => guard(() => chooseJavaDefault(runtime.executable))); action.disabled = !runtime.healthy || selected; card.append(el('span', 'java-runtime-icon', '⌘'), el('div', 'java-runtime-copy', ''), action); const copy = card.querySelector('.java-runtime-copy'); copy.append(el('strong', '', `Java ${runtime.major} · ${runtime.version}`), el('small', '', `${runtime.id} · ${runtime.arch} · ${runtime.healthy ? 'Ready' : 'Needs repair'}`), el('small', '', runtime.executable)); list.append(card); } if (data.custom.length) { custom.append(el('h3', '', 'Custom runtimes')); for (const runtime of data.custom) { const selected = !automatic && data.defaultJava === runtime.executable, card = el('article', `java-runtime-card selectable${selected ? ' selected' : ''}`), copy = el('div', 'java-runtime-copy'), action = button(selected ? 'Selected' : 'Use this Java', selected ? 'primary small' : 'quiet small', () => guard(() => chooseJavaDefault(runtime.executable))); action.disabled = selected; copy.append(el('strong', '', runtime.executable), el('small', '', runtime.profiles.length ? `Used directly by ${runtime.profiles.join(', ')}` : 'Custom Java')); card.append(el('span', 'java-runtime-icon', '↗'), copy, action); custom.append(card); } } }
function installed(id) { return state.installed.find(v => v.id === id); }
function currentProfile() { return state.profiles.find(p => p.id === state.selectedProfile); }
function profileInstalled(p) { return p && installed(p.version) && ((p.loader || 'vanilla') === 'vanilla' || state.installed.some(v => v.baseVersion === p.version && v.loader === p.loader && v.loaderVersion === p.loaderVersion)); }
function profileLabel(p) { return `${loaderNames[p.loader || 'vanilla']} ${p.version}${p.loaderVersion ? ' · ' + p.loaderVersion : ''}`; }
function supported(v) { return ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(v.type); }
function versionTypeLabel(type) { return ({ release: 'release', snapshot: 'snapshot', old_beta: 'old beta', old_alpha: 'old alpha' })[type] || type; }

function render() {
  applySettingsAppearance();
  $('#nav-installed').textContent = state.installed.length;
  $('#stat-installed').textContent = state.installed.length;
  $('#stat-profiles').textContent = state.profiles.length;
  const select = $('#active-profile'); select.replaceChildren();
  if (!state.profiles.length) select.append(el('option', '', 'Create your first profile'));
  for (const p of state.profiles) { const option = el('option', '', p.name); option.value = p.id; select.append(option); }
  select.value = state.selectedProfile || '';
  select.disabled = busy || running || !state.profiles.length;
  const p = currentProfile();
  $('#nav-mods').textContent = modState?.installed?.length || 0;
  $('#nav-modpacks').textContent = installedModpacks.length + customPacks.length;
  $('#profile-detail').textContent = p ? `${profileLabel(p)}  ·  ${p.memory} GB RAM  ·  ${profileInstalled(p) ? 'Installed' : 'Not installed'}` : 'Pin a version and give your worlds a home.';
  $('#edit-active').disabled = !p || busy || running;
  $('#play-button').disabled = busy || running || accountState.pending || loginStarting || (!p && !catalog.versions.length);
  $('#play-button').textContent = running ? 'Minecraft is running' : busy ? 'Working…' : !p ? '＋ Create profile' : profileInstalled(p) ? accountState.selected === 'demo' ? '▷ Play demo' : '▷ Play Minecraft' : '↓ Install profile';
  $('#new-profile').disabled = !catalog.versions.length || busy || running;
  renderVersions(); renderProfiles(); renderAccounts();
}

function modProfiles() { return state.profiles.filter(p => (p.loader || 'vanilla') !== 'vanilla'); }
function selectedModProfile() { return state.profiles.find(p => p.id === $('#mods-profile').value) || modProfiles().find(p => p.id === state.selectedProfile) || modProfiles()[0]; }
function compactDownloads(value) { return value >= 1000000 ? `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}m` : value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value); }
function formatBytes(value) { const bytes = Math.max(0, Number(value) || 0); if (bytes < 1024) return `${bytes} B`; const units = ['KB', 'MB', 'GB']; let size = bytes / 1024, unit = 0; while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; } return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`; }
function contentKey(kind, profileId, projectId) { return `${kind}:${profileId}:${projectId}`; }
function downloadIndicator(task) { const box = el('div', `item-download ${task.status || ''}`), line = el('div', 'item-download-head'), label = el('span', '', task.message || 'Preparing download…'), size = el('span', 'item-download-size'); size.textContent = task.totalBytes > 0 ? `${formatBytes(task.doneBytes)} / ${formatBytes(task.totalBytes)}` : task.status === 'failed' ? 'Failed' : 'Calculating size…'; const bar = document.createElement('progress'); if (task.totalBytes > 0) { bar.max = task.totalBytes; bar.value = Math.min(task.doneBytes || 0, task.totalBytes); } line.append(label, size); box.append(line, bar); return box; }
function profileJvmArguments(memory, version = '') { const max = Math.max(1, Number(memory) || 4), initial = Math.min(2, Math.max(1, Math.ceil(max / 2))), heap = [`-Xms${initial}G`, `-Xmx${max}G`]; return /^26\./.test(version) ? [...heap, '-XX:+UseCompactObjectHeaders', '-XX:+AlwaysPreTouch', '-XX:+UseStringDeduplication', '-XX:+UseZGC'] : [...heap, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=50']; }
function modIcon(url, title) { const fallback = el('span', 'mod-icon-fallback', (title || '?').trim().slice(0, 1).toUpperCase()); try { const parsed = new URL(url || ''); if (parsed.protocol !== 'https:' || !['cdn.modrinth.com', 'api.modrinth.com'].includes(parsed.hostname)) return fallback; const image = document.createElement('img'); image.className = 'mod-icon'; image.loading = 'lazy'; image.alt = ''; image.src = parsed.href; image.addEventListener('error', () => image.replaceWith(fallback), { once: true }); return image; } catch { return fallback; } }
function markdownUrl(value) { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return ''; return url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); } catch { return ''; } }
function markdownToHtml(markdown) { let source = String(markdown || '').replace(/<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["'][^>]*>/gi, (_, url) => `![image](${url})`); let text = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); text = text.replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g, (_, alt, url) => { const safe = markdownUrl(url); return safe ? `<img class="mod-body-image" alt="${alt}" src="${safe}">` : alt; }); text = text.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, label, url) => { const safe = markdownUrl(url); return safe ? `<a href="${safe}" data-external-link="${safe}">${label}</a>` : label; }); text = text.replace(/^###### (.+)$/gm, '<h6>$1</h6>').replace(/^##### (.+)$/gm, '<h5>$1</h5>').replace(/^#### (.+)$/gm, '<h4>$1</h4>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/^[-*] (.+)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>'); text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/_([^_\n]+)_/g, '<em>$1</em>'); return text.split(/\n{2,}/).map(block => /^<(h[1-6]|ul)>/.test(block.trim()) ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`).join(''); }

function renderMods() {
  const profiles = modProfiles(), select = $('#mods-profile'), prior = select.value;
  select.replaceChildren();
  for (const p of profiles) { const option = el('option', '', `${p.name} · ${loaderNames[p.loader]} ${p.version}`); option.value = p.id; select.append(option); }
  select.value = profiles.some(p => p.id === prior) ? prior : profiles.some(p => p.id === state.selectedProfile) ? state.selectedProfile : profiles[0]?.id || '';
  const available = Boolean(profiles.length); $('#mods-unavailable').hidden = available; $('#mods-workspace').hidden = !available;
  if (!available) { $('#nav-mods').textContent = '0'; return; }
  const isShaders = libraryTab === 'shaders';
  if (isShaders && !shaderAdapter) libraryTab = 'mods';
  const shaders = libraryTab === 'shaders', packs = libraryTab === 'resourcepacks', kind = shaders ? 'shader' : packs ? 'resourcepack' : 'mod', current = shaders ? shaderState : packs ? resourcepackState : modState, search = shaders ? shaderSearchState : packs ? resourcepackSearchState : modSearchState;
  $('#shader-tab').hidden = !shaderAdapter; $('#shader-tab').textContent = shaderAdapter ? `Shaders · ${shaderAdapter.label}` : 'Shaders';
  $$('.mod-tabs button').forEach(tab => tab.classList.toggle('active', tab.dataset.libraryTab === libraryTab));
  $('#mod-search').placeholder = shaders ? `Search ${shaderAdapter.label}-compatible shader packs…` : packs ? 'Search compatible resource packs…' : 'Search compatible mods…';
  $('#library-installed-title').textContent = shaders ? 'Installed shader packs' : packs ? 'Installed resource packs' : 'Installed'; $('#library-discover-title').textContent = shaders ? 'Discover shader packs' : packs ? 'Discover resource packs' : 'Discover';
  $('#check-mod-updates').hidden = shaders || packs; $('#mod-update-banner').hidden = shaders || packs || !modUpdates.length; $('#open-mods-folder').textContent = shaders ? 'Shaderpacks folder' : packs ? 'Resourcepacks folder' : 'Mods folder';
  $('#import-library-files').textContent = shaders ? 'Import shaders' : packs ? 'Import resource packs' : 'Import mods';
  const installedList = $('#installed-mods'); installedList.replaceChildren();
  const managed = current?.installed || [], local = current?.local || [];
  $('#nav-mods').textContent = managed.length; $('#mod-count').textContent = `${managed.length} managed${local.length ? ` · ${local.length} local` : ''}`;
  if (!managed.length && !local.length) installedList.append(emptyMods(shaders ? 'No shader packs installed' : packs ? 'No resource packs installed' : 'No mods installed', shaders ? 'Search Modrinth for Iris-compatible shader packs.' : packs ? 'Search Modrinth for packs compatible with this Minecraft version.' : 'Search Modrinth to add compatible mods.'));
  for (const mod of managed) {
    const card = el('article', `mod-card${mod.enabled === false ? ' disabled' : ''}`), title = el('div', 'mod-card-title');
    card.append(modIcon(mod.iconUrl, mod.title));
    title.append(el('strong', '', mod.title), el('small', '', `${mod.versionNumber}${mod.dependencyOnly ? ' · dependency' : ''}${mod.missing ? ' · file missing' : ''}`));
    const actions = el('div', 'mod-actions');
    const toggle = button(mod.enabled === false ? 'Enable' : 'Disable', 'quiet small', async () => { if (shaders) shaderState = await api.enableShader(selectedModProfile().id, mod.projectId, mod.enabled === false); else if (packs) resourcepackState = await api.enableResourcepack(selectedModProfile().id, mod.projectId, mod.enabled === false); else modState = await api.enableMod(selectedModProfile().id, mod.projectId, mod.enabled === false); renderMods(); });
    if (mod.dependencyOnly && mod.requiredBy?.length) toggle.disabled = true;
    actions.append(toggle);
    const remove = button('Remove', 'quiet small', () => confirmModRemoval(card, mod, shaders, packs)); if (mod.dependencyOnly && mod.requiredBy?.length) remove.disabled = true;
    actions.append(remove); card.append(title, actions); installedList.append(card);
  }
  for (const mod of local) { const card = el('article', `mod-card${mod.enabled ? '' : ' disabled'}`); const title = el('div', 'mod-card-title'); title.append(el('strong', '', mod.title), el('small', '', `Local file · ${mod.enabled ? 'enabled' : 'disabled'}`)); card.append(modIcon(null, mod.title), title, el('span', 'badge', 'UNMANAGED')); installedList.append(card); }

  const results = $('#mod-results'); results.replaceChildren();
  if (!search.hits.length) results.append(emptyMods(search.query ? 'No compatible results' : shaders ? 'Find a shader pack' : packs ? 'Find a resource pack' : 'Find your next mod', search.query ? 'Try another search.' : shaders ? `Results are filtered to Minecraft ${selectedModProfile()?.version || ''} and ${shaderAdapter?.label || 'Iris'} compatibility.` : packs ? `Results are filtered to Minecraft ${selectedModProfile()?.version || ''}.` : 'Results are filtered to this profile’s Minecraft version and loader.'));
  const installedIds = new Set(managed.map(mod => mod.projectId));
  for (const hit of search.hits) {
    const card = el('article', 'mod-card result'), copy = el('div', 'mod-card-copy'), profileId = selectedModProfile().id, meta = { kind, profileId, projectId: hit.projectId }, task = contentDownloads.get(contentKey(kind, profileId, hit.projectId));
    copy.append(el('strong', '', hit.title), el('small', '', `by ${hit.author} · ${compactDownloads(hit.downloads)} downloads`), el('p', '', hit.description));
    if (task) copy.append(downloadIndicator(task));
    const add = button(task ? 'Downloading…' : installedIds.has(hit.projectId) ? 'Reinstall' : 'Install', 'primary small', async () => { await installLibraryItem(meta, () => shaders ? api.installShader(profileId, hit.projectId) : packs ? api.installResourcepack(profileId, hit.projectId) : api.installMod(profileId, hit.projectId), !shaders && !packs ? () => api.installMod(profileId, hit.projectId, true) : null); }); add.disabled = Boolean(task);
    card.append(modIcon(hit.iconUrl, hit.title), copy, add); card.addEventListener('click', event => { if (!event.target.closest('button')) showModDetails(hit.projectId); }); results.append(card);
  }
  $('#mod-result-count').textContent = search.query ? `${search.total.toLocaleString()} compatible results` : 'Search Modrinth';
  $('#more-mods').hidden = search.hits.length >= search.total;
  $('#mod-update-copy').textContent = modUpdates.length ? `${modUpdates.length} update${modUpdates.length === 1 ? '' : 's'} available: ${modUpdates.map(u => u.title).join(', ')}` : '';
}

function renderModDetails(details) { const content = $('#mod-details-content'); content.replaceChildren(); const meta = el('div', 'mod-details-meta'); meta.append(modIcon(details.iconUrl, details.title), el('div', '', `${details.projectType} · ${compactDownloads(details.downloads)} downloads · ${compactDownloads(details.followers)} followers`)); content.append(meta, el('p', 'mod-details-description', details.description || 'No description provided.')); const groups = [['Supported Minecraft', details.gameVersions], ['Loaders', details.loaders], ['Categories', details.categories]]; for (const [label, values] of groups) if (values?.length) { const row = el('div', 'mod-detail-row'); row.append(el('strong', '', label), el('span', '', values.join(' · '))); content.append(row); } if (details.license?.name) content.append(el('div', 'mod-detail-row', `License · ${details.license.name}`)); if (details.body) { content.append(el('strong', 'mod-details-body-heading', 'About this mod')); const body = el('div', 'mod-details-body'); body.innerHTML = markdownToHtml(details.body); body.addEventListener('click', event => { const link = event.target.closest('[data-external-link]'); if (link) { event.preventDefault(); guard(() => api.openModrinth(link.dataset.externalLink)); } }); content.append(body); } const links = el('div', 'mod-detail-links'); for (const [label, url] of [['Issues', details.issuesUrl], ['Source', details.sourceUrl], ['Wiki', details.wikiUrl], ['Discord', details.discordUrl]]) if (url) links.append(button(label, 'quiet small', () => guard(() => api.openModrinth(url)))); if (links.children.length) { content.append(el('strong', '', 'Project links'), links); } }
async function showModDetails(projectId) { const p = selectedModProfile(); if (!p) return; const shaders = libraryTab === 'shaders', packs = libraryTab === 'resourcepacks', kind = shaders ? 'shader' : packs ? 'resourcepack' : 'mod', dialog = $('#mod-details-dialog'); $('#mod-details-title').textContent = 'Loading…'; $('#mod-details-content').replaceChildren(el('p', 'field-note', 'Loading project details…')); $('#install-from-details').disabled = true; dialog.showModal(); try { const details = await api.modDetails(p.id, projectId); $('#mod-details-title').textContent = details.title; renderModDetails(details); const installed = new Set(((shaders ? shaderState : packs ? resourcepackState : modState)?.installed || []).map(mod => mod.projectId)); const type = shaders ? 'shader pack' : packs ? 'resource pack' : 'mod', install = $('#install-from-details'), meta = { kind, profileId: p.id, projectId }; install.disabled = contentDownloads.has(contentKey(kind, p.id, projectId)); install.textContent = install.disabled ? 'Downloading…' : installed.has(projectId) ? `Reinstall ${type}` : `Install ${type}`; install.onclick = async () => { dialog.close(); await installLibraryItem(meta, () => shaders ? api.installShader(p.id, projectId) : packs ? api.installResourcepack(p.id, projectId) : api.installMod(p.id, projectId), !shaders && !packs ? () => api.installMod(p.id, projectId, true) : null); }; $('#open-modrinth').onclick = () => guard(() => api.openModrinth(details.projectUrl)); } catch (error) { $('#mod-details-content').replaceChildren(el('p', 'field-note', error.message)); } }
function emptyMods(title, copy) { const node = el('div', 'empty compact'); node.append(el('h3', '', title), el('p', '', copy)); return node; }

function renderModpacks() {
  $('#nav-modpacks').textContent = installedModpacks.length + customPacks.length; $('#modpack-count').textContent = `${installedModpacks.length} installed`;
  $('#custom-pack-count').textContent = `${customPacks.length} project${customPacks.length === 1 ? '' : 's'}`; const customList = $('#custom-packs-list'); customList.replaceChildren();
  if (!customPacks.length) customList.append(emptyMods('No custom packs yet', 'Use the creation wizard to start a pack project separate from your play profiles.'));
  for (const pack of customPacks) { const card = el('article', 'mod-card custom-pack-card'), copy = el('div', 'mod-card-copy'), actions = el('div', 'mod-actions'); copy.append(el('strong', '', pack.name), el('small', '', `${pack.versionId} · Minecraft ${pack.version} · ${loaderNames[pack.loader] || pack.loader}`), el('p', '', pack.summary)); actions.append(button('Play pack', 'primary small', () => guard(() => playCustomPack(pack)))); if (pack.loader !== 'vanilla') actions.append(button('Manage mods', 'quiet small', () => guard(() => openCustomPackMods(pack)))); actions.append(button('Open files', 'quiet small', () => guard(() => api.openCustomPackFolder(pack.id))), button('Export .mrpack', 'quiet small', () => guard(async () => { const result = await api.exportCustomPack(pack.id); if (result) toast(`${pack.name} exported with ${result.files} files (${formatBytes(result.size)}).`); })), button('Delete', 'quiet small', () => confirmCustomPackDelete(card, pack))); card.append(el('span', 'mod-icon-fallback', pack.name[0].toUpperCase()), copy, actions); customList.append(card); }
  const installedList = $('#installed-modpacks'); installedList.replaceChildren();
  if (!installedModpacks.length) installedList.append(emptyMods('No modpacks installed', 'Install from Modrinth or import a local .mrpack or supported ZIP file.'));
  for (const pack of installedModpacks) {
    const card = el('article', 'mod-card'), copy = el('div', 'mod-card-copy'), actions = el('div', 'mod-actions');
    copy.append(el('strong', '', pack.title || pack.profileName), el('small', '', `${pack.versionName || pack.versionNumber || 'Local pack'} · ${loaderNames[pack.loader] || pack.loader} ${pack.version}`));
    actions.append(button('Play profile', 'primary small', async () => { state = await api.selectProfile(pack.profileId); render(); navigate('play'); }));
    if (pack.projectId) actions.append(button('Update', 'quiet small', () => runModpackTask(() => api.updateModpack(pack.profileId), 'Modpack updated.')));
    actions.append(button('Remove', 'quiet small', () => { actions.replaceChildren(el('small', '', 'Remove pack files? Worlds and settings stay.'), button('Keep', 'quiet small', renderModpacks), button('Remove', 'primary small', () => runModpackTask(() => api.removeModpack(pack.profileId), 'Modpack removed.'))); }));
    card.append(modIcon(pack.iconUrl, pack.title), copy, actions); installedList.append(card);
  }
  const results = $('#modpack-results'); results.replaceChildren();
  if (!modpackSearchState.hits.length) results.append(emptyMods(modpackSearchState.query ? 'No modpacks found' : 'Discover modpacks', modpackSearchState.query ? 'Try another search.' : 'Browse popular packs from Modrinth.'));
  for (const hit of modpackSearchState.hits) {
    const card = el('article', 'mod-card result'), copy = el('div', 'mod-card-copy'), task = [...contentDownloads.values()].find(item => item.kind === 'modpack' && item.projectId === hit.projectId);
    copy.append(el('strong', '', hit.title), el('small', '', `by ${hit.author} · ${compactDownloads(hit.downloads)} downloads`), el('p', '', hit.description)); if (task && task.status !== 'complete') copy.append(downloadIndicator(task));
    const install = button(task && !['complete', 'failed'].includes(task.status) ? 'Installing…' : 'Install', 'primary small', () => runModpackTask(() => api.installModpack(hit.projectId), `${hit.title} installed.`)); install.disabled = Boolean(task && !['complete', 'failed'].includes(task.status));
    card.append(modIcon(hit.iconUrl, hit.title), copy, install); card.addEventListener('click', event => { if (!event.target.closest('button')) showModpackDetails(hit.projectId); }); results.append(card);
  }
  $('#modpack-result-count').textContent = `${modpackSearchState.total.toLocaleString()} results`; $('#more-modpacks').hidden = modpackSearchState.hits.length >= modpackSearchState.total;
}
async function playCustomPack(pack) { const result = await api.prepareCustomPack(pack.id); state = result.state; render(); navigate('play'); const profile = state.profiles.find(item => item.id === result.profileId); if (!profileInstalled(profile)) await installSelectedProfile(profile); toast(`${pack.name} is ready to play.`); }

function applySettingsAppearance() {
  const settings = state.settings || {}; document.documentElement.style.fontSize = `${settings.uiScale || 100}%`;
  document.body.classList.toggle('compact-sidebar', Boolean(settings.compactSidebar)); document.body.classList.toggle('reduce-motion', Boolean(settings.reducedMotion || (running && settings.reduceMotionWhilePlaying)));
  document.documentElement.dataset.theme = settings.theme || 'dark';
}
function renderSettings() {
  const tabs = $('#settings-tabs'), panel = $('#settings-panel'); if (!tabs || !panel) return; tabs.replaceChildren(); panel.replaceChildren();
  for (const [id, section] of Object.entries(settingSections)) { const tab = button(section.label, id === settingsTab ? 'active' : '', () => { settingsTab = id; renderSettings(); }); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(id === settingsTab)); tabs.append(tab); }
  for (const [key, title, description, type, options] of settingSections[settingsTab].fields) {
    const card = el('label', 'setting-card'), copy = el('div'); copy.append(el('strong', '', title), el('p', '', description)); let input;
    if (type === 'select') { input = document.createElement('select'); const choices = key === 'defaultAccount' ? [['','Currently selected'], ...(accountState.accounts || []).map(account => [account.id, account.name])] : options; for (const [value, label] of choices) { const option = el('option', '', label); option.value = value; input.append(option); } input.value = String(state.settings?.[key] ?? ''); }
    else { input = document.createElement('input'); input.type = type === 'toggle' ? 'checkbox' : type; if (type === 'toggle') input.checked = Boolean(state.settings?.[key]); else input.value = state.settings?.[key] ?? ''; if (type === 'number') { input.min = '0'; input.step = '1'; } }
    input.dataset.setting = key; input.dataset.settingType = type; card.htmlFor = `setting-${key}-${settingsTab}`; input.id = card.htmlFor; card.append(copy, input); panel.append(card);
  }
  if (settingsTab === 'storage') { const manager = el('section', 'storage-manager'); manager.id = 'storage-manager'; manager.append(el('p', 'field-note', 'Calculating storage usage…')); panel.prepend(manager); guard(loadStorageManager); }
}
async function loadStorageManager() {
  if (settingsTab !== 'storage') return; const summary = await api.storageSummary(), manager = $('#storage-manager'); if (!manager) return; manager.replaceChildren();
  const heading = el('div', 'storage-heading'), title = el('div'); title.append(el('strong', '', 'Storage management'), el('small', '', `${formatBytes(summary.totalBytes)} used inside ${summary.root}`));
  const actions = el('div', 'storage-actions'); actions.append(button('Refresh', 'quiet small', loadStorageManager), button('Open folder', 'quiet small', () => api.openFolder()), button('Clear cache', 'quiet small', async () => { await api.clearStorageCache(); toast('Temporary downloads and staging files cleared.'); await loadStorageManager(); }), button(`Remove unused versions${summary.unusedVersions.length ? ` (${summary.unusedVersions.length})` : ''}`, 'primary small', async () => { await api.removeUnusedVersions(); state = await api.state(); toast('Unused game versions removed.'); await loadStorageManager(); })); actions.lastChild.disabled = !summary.unusedVersions.length;
  heading.append(title, actions); manager.append(heading); const grid = el('div', 'storage-grid'); const maximum = Math.max(1, ...summary.categories.map(item => item.bytes));
  for (const item of summary.categories) { const card = el('button', 'storage-category'), row = el('div', 'storage-category-row'); card.type = 'button'; row.append(el('strong', '', item.label), el('span', '', formatBytes(item.bytes))); const track = el('div', 'storage-track'), fill = el('span'); fill.style.width = `${Math.max(item.bytes ? 2 : 0, item.bytes / maximum * 100)}%`; track.append(fill); card.append(row, track, el('small', '', `${item.files.toLocaleString()} files · View details`)); card.addEventListener('click', () => guard(() => openStorageDetails(item))); grid.append(card); } manager.append(grid);
}
let activeStorageCategory = null;
async function openStorageDetails(category) { activeStorageCategory = category; $('#storage-details-title').textContent = category.label; $('#storage-details-note').textContent = `${formatBytes(category.bytes)} across ${category.files.toLocaleString()} files.`; $('#storage-details-error').textContent = ''; $('#storage-details-dialog').showModal(); await renderStorageDetails(); }
async function renderStorageDetails() {
  const list = $('#storage-details-list'); list.replaceChildren(el('p', 'field-note', 'Reading storage entries…')); const entries = await api.storageDetails(activeStorageCategory.id); list.replaceChildren();
  if (!entries.length) { list.append(emptyMods('Nothing stored here', 'This category is currently empty.')); return; }
  for (const item of entries) {
    const row = el('article', 'storage-detail-row'), copy = el('div'); copy.append(el('strong', '', item.name), el('small', '', `${formatBytes(item.bytes)} · ${item.files.toLocaleString()} files · Modified ${new Date(item.modifiedAt).toLocaleString()}`)); if (item.reason) copy.append(el('small', 'storage-item-note', item.reason)); const actions = el('div', 'storage-item-actions');
    if (item.orphan) actions.append(button('Inspect', 'quiet small', async () => { const details = await api.inspectOrphan(item.key), existing = row.querySelector('.orphan-inspection'); existing?.remove(); const inspection = el('div', 'orphan-inspection'); inspection.append(el('strong', '', `${details.worlds.length} world${details.worlds.length === 1 ? '' : 's'}`)); if (details.worlds.length) inspection.append(el('small', '', details.worlds.map(world => `${world.name}${world.version ? ` · ${world.version}` : ''} · ${formatBytes(world.size)}`).join('\n'))); inspection.append(el('strong', '', 'Largest contents'), el('small', '', details.entries.slice(0, 8).map(entry => `${entry.name} · ${formatBytes(entry.size)}`).join('\n'))); copy.append(inspection); }), button('Recover', 'quiet small', () => openOrphanRecovery(item)), button('Open folder', 'quiet small', () => api.openOrphan(item.key)));
    const action = el('button', item.protected ? 'quiet small' : 'quiet small danger', item.protected ? 'Protected' : 'Delete'); action.type = 'button'; action.disabled = item.protected; let confirming = false; action.addEventListener('click', () => guard(async () => { if (!confirming) { confirming = true; action.textContent = 'Confirm delete'; action.className = 'primary small'; return; } await api.deleteStorageItem(activeStorageCategory.id, item.key); toast(`${item.name} deleted.`); await renderStorageDetails(); await loadStorageManager(); })); actions.append(action); row.append(copy, actions); list.append(row);
  }
}
function openOrphanRecovery(item) { const select = $('#recover-orphan-version'); select.replaceChildren(); for (const version of catalog.versions) { const option = el('option', '', `${version.id} · ${versionTypeLabel(version.type)}`); option.value = version.id; select.append(option); } select.value = catalog.latest?.release || catalog.versions[0]?.id || ''; $('#recover-orphan-id').value = item.key; $('#recover-orphan-name').value = `Recovered ${item.key.slice(0, 8)}`; $('#recover-orphan-error').textContent = ''; $('#recover-orphan-dialog').showModal(); $('#recover-orphan-name').focus(); }
async function loadModpacks() { const request = ++modpackRequest; const [installed, projects, discovery] = await Promise.all([api.listModpacks(), api.listCustomPacks(), api.searchModpacks(modpackSearchState.query, modpackSearchState.offset)]); if (request !== modpackRequest) return; installedModpacks = installed; customPacks = projects; modpackSearchState = { query: modpackSearchState.query, offset: discovery.offset, total: discovery.total, hits: discovery.hits }; renderModpacks(); }
function confirmCustomPackDelete(card, pack) { const actions = card.querySelector('.mod-actions'); actions.replaceChildren(el('small', '', 'Delete this pack project and its files?'), button('Keep', 'quiet small', renderModpacks), button('Delete project', 'primary small', () => guard(async () => { customPacks = await api.deleteCustomPack(pack.id); renderModpacks(); toast('Custom pack deleted.'); }))); }
function renderCustomPackMods() { const installed = $('#custom-pack-installed-mods'), results = $('#custom-pack-mod-results'); installed.replaceChildren(); results.replaceChildren(); const rows = [...(customPackMods?.installed || []), ...(customPackMods?.local || [])], installedIds = new Set((customPackMods?.installed || []).map(mod => mod.projectId)); $('#custom-pack-installed-count').textContent = `${rows.length} mod${rows.length === 1 ? '' : 's'}`; if (!rows.length) installed.append(emptyMods('No mods added', 'Search Modrinth and add compatible mods directly to this pack.')); for (const mod of rows) { const card = el('article', 'mod-card'), copy = el('div', 'mod-card-copy'); copy.append(el('strong', '', mod.title || mod.filename), el('small', '', mod.versionNumber || (mod.local ? 'Local file' : 'Installed'))); const remove = button('Remove', 'quiet small', () => guard(async () => { customPackMods = await api.removeCustomPackMod(customPackEditor.id, mod.projectId); renderCustomPackMods(); })); if (mod.local) remove.disabled = true; card.append(modIcon(mod.iconUrl, mod.title), copy, remove); installed.append(card); } for (const hit of customPackModHits) { const key = contentKey('custom-mod', customPackEditor.id, hit.projectId), task = contentDownloads.get(key), added = installedIds.has(hit.projectId), active = task && !['complete', 'failed'].includes(task.status), card = el('article', 'mod-card result'), copy = el('div', 'mod-card-copy'), add = button(added ? 'Added' : active ? 'Installing…' : 'Add to pack', added || active ? 'quiet small' : 'primary small', () => guard(async () => { contentDownloads.set(key, { key, kind: 'custom-mod', profileId: customPackEditor.id, projectId: hit.projectId, status: 'resolving', message: 'Finding a compatible file…', doneBytes: 0, totalBytes: 0 }); renderCustomPackMods(); try { customPackMods = await api.installCustomPackMod(customPackEditor.id, hit.projectId); contentDownloads.delete(key); renderCustomPackMods(); toast(`${hit.title} added.`); } catch (error) { contentDownloads.delete(key); renderCustomPackMods(); $('#custom-pack-mod-error').textContent = error.message; } })); add.disabled = added || active; copy.append(el('strong', '', hit.title), el('small', '', `by ${hit.author} · ${compactDownloads(hit.downloads)} downloads`), el('p', '', hit.description)); if (active) { const progress = document.createElement('progress'); progress.className = 'custom-pack-mod-progress'; progress.max = Math.max(1, Number(task.totalBytes) || 1); progress.value = Math.min(progress.max, Number(task.doneBytes) || 0); copy.append(progress, el('small', 'custom-pack-mod-progress-note', task.totalBytes ? `${task.message} · ${formatBytes(task.doneBytes)} / ${formatBytes(task.totalBytes)}` : task.message)); } card.append(modIcon(hit.iconUrl, hit.title), copy, add); results.append(card); } if (!customPackModHits.length) results.append(emptyMods('Search for mods', 'Results are filtered to this pack’s Minecraft version and loader.')); }
async function openCustomPackMods(pack) { customPackEditor = pack; $('#custom-pack-mods-title').textContent = `${pack.name} · choose mods`; $('#custom-pack-mods-subtitle').textContent = `Minecraft ${pack.version} · ${loaderNames[pack.loader] || pack.loader} · compatible Modrinth results`; $('#custom-pack-mod-query').value = ''; $('#custom-pack-mod-error').textContent = ''; $('#custom-pack-mods-dialog').showModal(); [customPackMods, { hits: customPackModHits }] = await Promise.all([api.listCustomPackMods(pack.id), api.searchCustomPackMods(pack.id, '', 0)]); renderCustomPackMods(); }
async function searchModpacks(append = false) { const query = $('#modpack-search').value.trim(), offset = append ? modpackSearchState.hits.length : 0, result = await api.searchModpacks(query, offset); modpackSearchState = { query, offset, total: result.total, hits: append ? [...modpackSearchState.hits, ...result.hits] : result.hits }; renderModpacks(); }
async function runModpackTask(action, success) { $('#import-modpack').disabled = true; try { const result = await action(); if (!result) return; if (result.state) state = result.state; else state = await api.state(); installedModpacks = await api.listModpacks(); render(); renderModpacks(); toast(success); } finally { $('#import-modpack').disabled = false; } }
async function showModpackDetails(projectId) { const dialog = $('#modpack-details-dialog'); $('#modpack-details-title').textContent = 'Loading…'; $('#modpack-details-content').replaceChildren(el('p', 'field-note', 'Loading modpack details…')); $('#install-modpack-details').disabled = true; dialog.showModal(); try { const details = await api.modpackDetails(projectId); $('#modpack-details-title').textContent = details.title; const content = $('#modpack-details-content'); content.replaceChildren(); const meta = el('div', 'mod-details-meta'); meta.append(modIcon(details.iconUrl, details.title), el('div', '', `${compactDownloads(details.downloads)} downloads · ${compactDownloads(details.followers)} followers`)); content.append(meta, el('p', 'mod-details-description', details.description)); if (details.gallery?.length) { const gallery = el('div', 'modpack-gallery'); for (const shot of details.gallery) { const image = document.createElement('img'); image.src = shot.url; image.alt = shot.title || details.title; image.loading = 'lazy'; gallery.append(image); } content.append(gallery); } for (const [label, values] of [['Minecraft versions', details.gameVersions], ['Loaders', details.loaders], ['Categories', details.categories]]) if (values?.length) { const row = el('div', 'mod-detail-row'); row.append(el('strong', '', label), el('span', '', values.join(' · '))); content.append(row); } if (details.body) { const body = el('div', 'mod-details-body'); body.innerHTML = markdownToHtml(details.body); body.addEventListener('click', event => { const link = event.target.closest('[data-external-link]'); if (link) { event.preventDefault(); guard(() => api.openModrinth(link.dataset.externalLink)); } }); content.append(body); } $('#open-modpack-page').onclick = () => guard(() => api.openModrinth(details.projectUrl)); const install = $('#install-modpack-details'); install.disabled = false; install.onclick = () => { dialog.close(); guard(() => runModpackTask(() => api.installModpack(projectId), `${details.title} installed.`)); }; } catch (error) { $('#modpack-details-content').replaceChildren(el('p', 'field-note', error.message)); } }
function confirmModRemoval(card, mod, shaders = false, packs = false) {
  const type = shaders ? 'shader pack' : packs ? 'resource pack' : 'mod'; const actions = card.querySelector('.mod-actions'); actions.replaceChildren(el('small', '', `Remove this ${type}?`), button('Keep', 'quiet small', renderMods), button('Remove', 'primary small', async () => { await runModTask(null, () => shaders ? api.removeShader(selectedModProfile().id, mod.projectId) : packs ? api.removeResourcepack(selectedModProfile().id, mod.projectId) : api.removeMod(selectedModProfile().id, mod.projectId)); }));
}
async function loadModsView() {
  renderMods(); const p = selectedModProfile(); if (!p) return;
  const request = ++modRequest; const [value, adapter] = await Promise.all([api.listMods(p.id), api.shaderStatus(p.id)]); if (request !== modRequest) return; modState = value; shaderAdapter = adapter; if (!adapter && libraryTab === 'shaders') libraryTab = 'mods'; const discovery = libraryTab === 'shaders' ? await api.searchShaders(p.id, '', 0) : libraryTab === 'resourcepacks' ? await api.searchResourcepacks(p.id, '', 0) : await api.searchMods(p.id, '', 0); if (request !== modRequest) return; if (libraryTab === 'shaders') { shaderState = await api.listShaders(p.id); shaderSearchState = { ...discovery, query: '', hits: discovery.hits }; } else if (libraryTab === 'resourcepacks') { resourcepackState = await api.listResourcepacks(p.id); resourcepackSearchState = { ...discovery, query: '', hits: discovery.hits }; } else modSearchState = { ...discovery, query: '', hits: discovery.hits }; modUpdates = []; renderMods();
}
async function searchMods(append = false) {
  const p = selectedModProfile(); if (!p) return;
  const shaders = libraryTab === 'shaders', packs = libraryTab === 'resourcepacks', current = shaders ? shaderSearchState : packs ? resourcepackSearchState : modSearchState, query = $('#mod-search').value.trim(), offset = append ? current.hits.length : 0, request = ++modRequest;
  $('#mod-result-count').textContent = 'Searching…';
  const result = await (shaders ? api.searchShaders(p.id, query, offset) : packs ? api.searchResourcepacks(p.id, query, offset) : api.searchMods(p.id, query, offset)); if (request !== modRequest) return;
  const next = { ...result, query, hits: append ? [...current.hits, ...result.hits] : result.hits }; if (shaders) shaderSearchState = next; else if (packs) resourcepackSearchState = next; else modSearchState = next; renderMods();
}
async function runModTask(meta, action) {
  if (!meta) { busy = true; render(); $('#download-panel').hidden = false; $('#cancel-install').disabled = false; try { return await action(); } finally { busy = false; $('#download-panel').hidden = true; state = await api.state(); render(); await loadModsView(); } }
  const key = contentKey(meta.kind, meta.profileId, meta.projectId); contentDownloads.set(key, { ...meta, key, status: 'resolving', message: 'Finding a compatible file…', doneBytes: 0, totalBytes: 0 }); renderMods();
  try { const result = await action(); if (meta.kind === 'shader') shaderState = result; else if (meta.kind === 'resourcepack') resourcepackState = result; else modState = result; modUpdates = []; return result; }
  finally { contentDownloads.delete(key); state = await api.state(); render(); await loadModsView(); }
}
async function installLibraryItem(meta, action, installAnyway = null) {
  try { return await runModTask(meta, action); }
  catch (error) {
    const missingDependency = error.code === 'EMISSINGDEPENDENCY' || /^Required dependency .+ has no compatible .+ file for Minecraft .+\.$/i.test(error.message || '');
    if (!missingDependency || !installAnyway) throw error;
    if (state.settings?.allowMissingDependencies) { const result = await runModTask(meta, installAnyway); toast('Installed despite missing dependencies.'); return result; }
    dependencyInstallQueue.push({ message: error.message, install: async () => { const result = await runModTask(meta, installAnyway); const missing = result?.warnings || []; toast(missing.length ? `Installed without ${missing.length} required dependenc${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}` : 'Installed with missing dependencies.'); } });
    showNextDependencyWarning(); return null;
  }
}

function renderAccounts() {
  const selected = accountState.accounts.find(a => a.id === accountState.selected) || accountState.accounts[0];
  $('#sidebar-account').textContent = selected.name;
  $('#account-avatar').textContent = selected.name[0].toUpperCase();
  const picker = $('#active-account'); picker.replaceChildren();
  for (const a of accountState.accounts) { const label = a.type === 'demo' ? 'Demo' : a.type === 'local' ? 'Local' : 'Microsoft'; const option = el('option', '', `${a.name} · ${label}`); option.value = a.id; picker.append(option); }
  picker.value = selected.id;
  const locked = busy || running || accountState.pending || loginStarting;
  picker.disabled = locked; $('#add-account').disabled = locked || Boolean(accountState.issue) || !accountState.configured;
  $('#play-mode-note').textContent = selected.id === 'demo' ? 'Demo mode is selected. Sign in with an account that has Minecraft Java Edition access to play the full game.' : `Playing as ${selected.name}. Your Minecraft Java access is checked when signing in or renewing your session.`;
  $('#account-notice').textContent = accountState.issue || (!accountState.configured ? 'Microsoft sign-in is not available in this development build. You can play Demo.' : 'Sign in through Microsoft’s website. Saved accounts are encrypted for your Windows user.');
  const grid = $('#accounts-grid'); grid.replaceChildren();
  for (const a of accountState.accounts) {
    const card = el('article', `profile-card${a.id === selected.id ? ' selected' : ''}`);
    card.append(el('small', '', a.type === 'demo' ? 'NO ACCOUNT REQUIRED' : a.type === 'local' ? 'LOCAL PROFILE' : 'MICROSOFT ACCOUNT'), el('h3', '', a.name), el('p', '', a.type === 'demo' ? 'Try Minecraft in demo mode.' : a.type === 'local' ? 'Single-player or offline-mode servers.' : 'Minecraft Java Edition'));
    const actions = el('div', 'profile-card-actions');
    actions.append(button(a.id === selected.id ? 'Selected' : a.type === 'demo' ? 'Choose demo' : a.type === 'local' ? 'Use local profile' : 'Use account', a.id === selected.id ? 'quiet' : 'primary', async () => { accountState = await api.selectAccount(a.id); render(); }));
    if (a.type !== 'demo') actions.append(button('Manage skins', 'quiet', () => { skinAccountId = a.id; navigate('skins'); }));
    if (a.type !== 'demo') actions.append(button('Remove', 'quiet', () => {
      actions.replaceChildren(el('small', '', 'Remove saved sign-in? Worlds are kept.'), button('Keep', 'quiet', renderAccounts), button('Remove account', 'primary', async () => { accountState = await api.removeAccount(a.id); render(); }));
    }));
    actions.querySelectorAll('button').forEach(b => b.disabled = locked);
    card.append(actions); grid.append(card);
  }
}

function renderVersions() {
  const search = $('#search').value.trim().toLowerCase();
  const modded = filter === 'installed' ? state.installed.filter(v => v.type === 'modded').map(v => ({ ...v, releaseTime: v.installedAt })) : [];
  const rows = [...catalog.versions.filter(v => filter === 'installed' ? installed(v.id) : filter === 'legacy' ? ['old_beta', 'old_alpha'].includes(v.type) : v.type === filter), ...modded].filter(v => `${v.id} ${v.loader || ''} ${v.loaderVersion || ''}`.toLowerCase().includes(search));
  const list = $('#version-list'); list.replaceChildren();
  if (!rows.length) { const empty = el('div', 'empty'); empty.append(el('h3', '', catalog.versions.length ? 'No versions here yet.' : 'Catalog unavailable'), el('p', '', catalog.versions.length ? 'Try another filter, or install your first version.' : 'Connect to the internet and refresh to load Minecraft versions.')); list.append(empty); }
  for (const v of rows.slice(0, limit)) {
    const item = installed(v.id), row = el('div', 'version-row');
    const name = el('div', 'version-name'), label = el('div');
    label.append(el('strong', '', v.type === 'modded' ? `${loaderNames[v.loader]} ${v.baseVersion} · ${v.loaderVersion}` : v.id), el('small', '', v.id === catalog.latest.release ? 'LATEST RELEASE' : v.id === catalog.latest.snapshot ? 'LATEST SNAPSHOT' : v.type.toUpperCase())); name.append(el('span', 'cube', '◇'), label);
    row.append(name, el('span', 'version-date', new Date(v.releaseTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })), el('span', `badge${item ? ' ready' : ''}`, item ? '● Installed' : 'Available'));
    const actions = el('div', 'row-actions');
    if (item) {
      if (v.type !== 'modded') actions.append(button('Repair', 'quiet', () => install(v.id)));
      actions.append(button('Use', 'primary', () => {
        if (v.type === 'modded') openProfile({ name: `${loaderNames[v.loader]} ${v.baseVersion}`, version: v.baseVersion, loader: v.loader, loaderVersion: v.loaderVersion });
        else openProfile(null, v.id);
      }));
      const remove = button('×', 'quiet', async () => { state = await api.removeVersion(v.id); render(); }); remove.title = `Remove ${v.id}`; remove.setAttribute('aria-label', remove.title); actions.append(remove);
    } else actions.append(button('↓ Install', 'quiet', () => install(v.id)));
    if (busy || running) actions.querySelectorAll('button').forEach(b => b.disabled = true);
    row.append(actions); list.append(row);
  }
  $('#load-more').hidden = rows.length <= limit;
}

function renderProfiles() {
  const grid = $('#profiles-grid'); grid.replaceChildren();
  if (!state.profiles.length) { const empty = el('div', 'empty'); empty.append(el('h3', '', 'Every adventure starts somewhere.'), el('p', '', 'Create a profile to choose your Minecraft version and memory settings.'), button('＋ Create your first profile', 'primary', () => openProfile())); grid.append(empty); return; }
  for (const p of state.profiles) {
    const selected = state.selectedProfile === p.id;
    const card = el('article', `profile-card${selected ? ' selected' : ''}`), top = el('div', 'profile-card-top');
    card.dataset.id = p.id;
    top.append(el('span', 'stat-icon', '▤'), el('small', '', selected ? 'ACTIVE PROFILE' : loaderNames[p.loader || 'vanilla'].toUpperCase()));
    card.append(top, el('h3', '', p.name), el('p', '', `${profileLabel(p)} · ${p.memory} GB RAM`), el('small', '', profileInstalled(p) ? '● Profile installed' : 'Profile needs installation'));
    const actions = el('div', 'profile-card-actions');
    actions.append(button(selected ? 'Selected' : 'Select profile', selected ? 'quiet' : 'primary', async () => { state = await api.selectProfile(p.id); render(); }), button('Quick-play shortcut', 'quiet', async () => { const shortcut = await api.createQuickPlayShortcut(p.id); toast(`Desktop shortcut created for ${shortcut.name}.`); }), button('Worlds', 'quiet', () => openWorldManager(p)), button('Edit', 'quiet', () => openProfile(p)), button('Clone', 'quiet', async () => { state = await api.cloneProfile(p.id, `${p.name} copy`); render(); toast('Profile cloned with its worlds and settings.'); }), button('Delete profile', 'quiet', () => confirmDeleteProfile(p)));
    if ((p.loader || 'vanilla') !== 'vanilla') actions.append(button('Install / repair', 'quiet', () => installSelectedProfile(p)), button('Mods folder', 'quiet', () => api.openMods(p.id)));
    if (busy || running) actions.querySelectorAll('button').forEach(b => b.disabled = true);
    card.append(actions); grid.append(card);
  }
}

async function confirmDeleteProfile(p) {
  // Use a second deliberate click; worlds are always preserved.
  const card = [...$('#profiles-grid').children].find(c => c.dataset.id === p.id);
  const actions = card.querySelector('.profile-card-actions'); actions.replaceChildren();
  actions.append(el('small', '', 'Remove profile? Worlds are kept.'), button('Keep', 'quiet', () => renderProfiles()), button('Remove', 'primary', async () => { state = await api.deleteProfile(p.id); render(); }));
}

let worldProfile = null, profileWorlds = [], pendingWorldNames = [];
async function refreshWorldManager() {
  if (!worldProfile) return; profileWorlds = await api.listWorlds(worldProfile.id); const list = $('#worlds-list'); list.replaceChildren(); $('#world-delete-confirm').hidden = true;
  if (!profileWorlds.length) list.append(emptyMods('No worlds in this profile', 'Import worlds from the default launcher, another folder, or a ZIP archive.'));
  for (const world of profileWorlds) {
    const label = el('label', 'world-row'), input = document.createElement('input'), copy = el('span', 'world-row-copy'); input.type = 'checkbox'; input.value = world.name;
    const icon = world.iconUrl ? document.createElement('img') : el('span', 'world-icon-fallback', '▦'); if (world.iconUrl) { icon.className = 'world-icon'; icon.src = world.iconUrl; icon.alt = ''; }
    const heading = el('span', 'world-heading'), name = el('strong', '', world.displayName || world.name), health = el('span', `world-health ${world.health || 'damaged'}`, world.health === 'healthy' ? 'Healthy' : world.health === 'recoverable' ? 'Repair available' : 'Needs attention'); heading.append(name, health);
    const folder = world.displayName && world.displayName !== world.name ? `Folder: ${world.name} · ` : '', version = world.gameVersion || (world.dataVersion ? `Data version ${world.dataVersion}` : 'Unknown version'), played = new Date(world.lastPlayed || world.modifiedAt).toLocaleString();
    copy.append(heading, el('small', '', `${folder}${version} · Last played ${played} · ${formatBytes(world.size)}`), el('small', 'world-health-copy', world.healthMessage || ''));
    label.title = world.healthMessage || ''; label.append(input, icon, copy); list.append(label);
  }
  updateWorldActions();
}
function updateWorldActions() { const count = selectedWorldNames().length; $('#transfer-worlds').disabled = !count || state.profiles.length < 2; $('#delete-worlds').disabled = !count; $('#backup-worlds').disabled = !count; }
async function openWorldManager(profile) { worldProfile = profile; $('#worlds-title').textContent = `${profile.name} worlds`; $('#worlds-error').textContent = ''; $('#worlds-dialog').showModal(); await refreshWorldManager(); }
async function runWorldImport(action) { $('#worlds-error').textContent = ''; try { const result = await action(); if (!result) return; await refreshWorldManager(); toast(`${result.imported.length} world${result.imported.length === 1 ? '' : 's'} imported.`); } catch (error) { $('#worlds-error').textContent = error.message; } }
function openWorldTransfer() {
  pendingWorldNames = $$('#worlds-list input:checked').map(input => input.value); if (!pendingWorldNames.length) { $('#worlds-error').textContent = 'Choose at least one world.'; return; }
  const destination = $('#world-destination'); destination.replaceChildren(); for (const profile of state.profiles.filter(profile => profile.id !== worldProfile.id)) { const option = el('option', '', profile.name); option.value = profile.id; destination.append(option); }
  $('#world-transfer-summary').textContent = `${pendingWorldNames.length} selected: ${pendingWorldNames.join(' · ')}`; $('#world-transfer-error').textContent = ''; $('#world-transfer-dialog').showModal();
}
function selectedWorldNames() { return $$('#worlds-list input:checked').map(input => input.value); }
function requestWorldDelete() { const names = selectedWorldNames(); if (!names.length) { $('#worlds-error').textContent = 'Choose at least one world.'; return; } pendingWorldNames = names; $('#worlds-error').textContent = ''; $('#world-delete-copy').textContent = `Permanently delete ${names.length} world${names.length === 1 ? '' : 's'}: ${names.join(' · ')}?`; $('#world-delete-confirm').hidden = false; }
async function loadCustomPackLoaders() { const loader = $('#custom-pack-loader').value, version = $('#custom-pack-minecraft').value.trim(), field = $('#custom-pack-loader-field'), select = $('#custom-pack-loader-version'), modded = loader !== 'vanilla'; field.hidden = !modded; select.replaceChildren(); $('#save-custom-pack').textContent = modded ? 'Create & browse mods' : 'Create custom pack'; $('#custom-pack-modrinth-note').textContent = modded ? 'Create the pack, then Blocklane opens compatible Modrinth results for this Minecraft version and loader. Add mods without leaving the launcher; required dependencies are included automatically.' : 'Vanilla packs do not use loader mods. Choose Fabric, Quilt, Forge, or NeoForge to browse compatible Modrinth mods after creation.'; if (!modded || !catalog.versions.some(item => item.id === version)) return; const versions = await api.loaderVersions(loader, version); for (const item of versions) { const option = el('option', '', item.label || item.version); option.value = item.version; select.append(option); } }
function openCustomPackWizard() { const versions = $('#custom-pack-versions'); versions.replaceChildren(); for (const item of catalog.versions) { const option = document.createElement('option'); option.value = item.id; versions.append(option); } $('#custom-pack-name').value = ''; $('#custom-pack-version-id').value = '1.0.0'; $('#custom-pack-summary').value = ''; $('#custom-pack-minecraft').value = catalog.latest?.release || catalog.versions[0]?.id || ''; $('#custom-pack-loader').value = 'fabric'; $('#custom-pack-error').textContent = ''; $('#custom-pack-dialog').showModal(); guard(loadCustomPackLoaders); }
async function loadSkins() {
  const request = ++skinLoadRequest, accounts = accountState.accounts.filter(account => account.type !== 'demo'), picker = $('#skins-account');
  const prior = skinAccountId || picker.value || (accountState.selected !== 'demo' ? accountState.selected : ''); picker.replaceChildren();
  for (const account of accounts) { const option = el('option', '', `${account.name} · ${account.type === 'local' ? 'Local' : 'Microsoft'}`); option.value = account.id; picker.append(option); }
  skinAccountId = accounts.some(account => account.id === prior) ? prior : accounts[0]?.id || null; picker.value = skinAccountId || ''; picker.disabled = !accounts.length;
  const selectedAccount = accounts.find(account => account.id === skinAccountId);
  $('#skins-notice').textContent = !accounts.length ? 'Add a Microsoft account or local profile before applying a skin. You can still build your library now.' : selectedAccount?.type === 'local' ? 'Local skins appear in compatible modded profiles. Blocklane installs the required client-side skin support automatically when you launch.' : 'Applying a skin uploads it to this Microsoft account through Minecraft Services. Restart Minecraft after changing it.';
  const summary = $('#active-skin-summary'); summary.replaceChildren(el('span', 'muted', skinAccountId ? 'Loading active skin…' : 'No playable account selected.'));
  const libraryPromise = api.listSkins();
  let active = null, activeError = null;
  if (skinAccountId) try { active = await api.accountSkin(skinAccountId); } catch (error) { activeError = error; }
  const skins = await libraryPromise; if (request !== skinLoadRequest) return; skinLibrary = skins;
  summary.replaceChildren();
  if (active?.url) { const image = document.createElement('img'); image.src = active.url; image.alt = 'Active skin'; image.addEventListener('error', () => image.remove(), { once: true }); summary.append(image); }
  const account = accounts.find(value => value.id === skinAccountId), copy = el('div');
  copy.append(el('strong', '', account ? `${account.name} · Active skin` : 'No account selected'), el('small', '', activeError ? activeError.message : active ? `${active.variant === 'slim' ? 'Slim' : 'Classic'} arms${active.url ? '' : ' · Default skin'}` : 'Choose an account to apply skins.')); summary.append(copy);
  renderSkinLibrary();
}
function skinFace(image, rect, overlay = null) { const canvas = document.createElement('canvas'); canvas.width = rect[2] * 8; canvas.height = rect[3] * 8; const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false; context.drawImage(image, ...rect, 0, 0, canvas.width, canvas.height); if (overlay && image.height >= 64) context.drawImage(image, ...overlay, 0, 0, canvas.width, canvas.height); return `url(${canvas.toDataURL()})`; }
function skinPart(image, name, dimensions, position, faces, overlays = null) {
  const part = el('div', `skin-part skin-${name}`); part.style.setProperty('--w', `${dimensions[0] * 4}px`); part.style.setProperty('--h', `${dimensions[1] * 4}px`); part.style.setProperty('--d', `${dimensions[2] * 4}px`); part.style.setProperty('--hw', `${dimensions[0] * 2}px`); part.style.setProperty('--hh', `${dimensions[1] * 2}px`); part.style.setProperty('--hd', `${dimensions[2] * 2}px`); part.style.left = `${position[0] * 4}px`; part.style.top = `${position[1] * 4}px`;
  for (const side of ['front', 'back', 'left', 'right', 'top', 'bottom']) { const face = el('span', `skin-face ${side}`); face.style.backgroundImage = skinFace(image, faces[side], overlays?.[side]); part.append(face); } return part;
}
function createSkinPreview(skin) {
  const stage = el('div', 'skin-3d-stage'), model = el('div', 'skin-3d-model'), loading = el('span', 'skin-3d-loading', 'Loading 3D…'); stage.setAttribute('aria-label', `Interactive 3D preview of ${skin.name}`); stage.title = 'Drag to rotate'; stage.append(model, loading); const image = new Image();
  image.onload = () => { loading.remove(); const slim = skin.variant === 'slim', arm = slim ? 3 : 4;
    const head = { top:[8,0,8,8],bottom:[16,0,8,8],right:[0,8,8,8],front:[8,8,8,8],left:[16,8,8,8],back:[24,8,8,8] }, hat = { top:[40,0,8,8],bottom:[48,0,8,8],right:[32,8,8,8],front:[40,8,8,8],left:[48,8,8,8],back:[56,8,8,8] };
    const body = { top:[20,16,8,4],bottom:[28,16,8,4],right:[16,20,4,12],front:[20,20,8,12],left:[28,20,4,12],back:[32,20,8,12] }, body2 = { top:[20,32,8,4],bottom:[28,32,8,4],right:[16,36,4,12],front:[20,36,8,12],left:[28,36,4,12],back:[32,36,8,12] };
    const limb = (x,y,w=4) => ({ top:[x+4,y,w,4],bottom:[x+4+w,y,w,4],right:[x,y+4,4,12],front:[x+4,y+4,w,12],left:[x+4+w,y+4,4,12],back:[x+8+w,y+4,w,12] });
    model.append(skinPart(image,'head',[8,8,8],[6,0],head,hat), skinPart(image,'body',[8,12,4],[6,8],body,body2), skinPart(image,'right-arm',[arm,12,4],[6-arm,8],limb(40,16,arm),limb(40,32,arm)), skinPart(image,'left-arm',[arm,12,4],[14,8],image.height >= 64 ? limb(32,48,arm) : limb(40,16,arm),image.height >= 64 ? limb(48,48,arm) : null), skinPart(image,'right-leg',[4,12,4],[6,20],limb(0,16),limb(0,32)), skinPart(image,'left-leg',[4,12,4],[10,20],image.height >= 64 ? limb(16,48) : limb(0,16),image.height >= 64 ? limb(0,48) : null));
  }; image.onerror = () => { loading.textContent = 'Preview unavailable'; }; image.src = skin.url;
  let angle = -24, dragging = false, start = 0, origin = angle; const rotate = () => { model.style.transform = `rotateX(-7deg) rotateY(${angle}deg)`; };
  stage.addEventListener('pointerdown', event => { dragging = true; start = event.clientX; origin = angle; stage.classList.add('dragging'); stage.setPointerCapture(event.pointerId); }); stage.addEventListener('pointermove', event => { if (!dragging) return; angle = origin + (event.clientX - start) * .8; rotate(); }); stage.addEventListener('pointerup', event => { dragging = false; stage.classList.remove('dragging'); stage.releasePointerCapture(event.pointerId); }); return stage;
}
function renderSkinLibrary() {
  const grid = $('#skins-grid'); grid.replaceChildren();
  if (!skinLibrary.length) return grid.append(emptyMods('Your skin library is empty', 'Import PNG skins once, then switch between them whenever you want.'));
  for (const skin of skinLibrary) {
    const card = el('article', 'skin-card'); card.dataset.id = skin.id; const preview = createSkinPreview(skin);
    const copy = el('div', 'skin-card-copy'); copy.append(el('strong', '', skin.name), el('small', '', `${skin.variant === 'slim' ? 'Slim' : 'Classic'} arms · Added ${new Date(skin.createdAt).toLocaleDateString()}`));
    const actions = el('div', 'skin-card-actions');
    const apply = button('Apply', 'primary small', async () => { if (!skinAccountId) throw new Error('Add or choose an account first.'); await api.applySkin(skinAccountId, skin.id); await loadSkins(); toast('Skin applied.'); }); apply.disabled = !skinAccountId || busy || running;
    actions.append(apply, button('Rename', 'quiet small', () => { $('#skin-rename-id').value = skin.id; $('#skin-rename-name').value = skin.name; $('#skin-rename-error').textContent = ''; $('#skin-rename-dialog').showModal(); $('#skin-rename-name').focus(); }), button('Delete', 'quiet small', () => confirmDeleteSkin(card, skin)));
    card.append(preview, copy, actions); grid.append(card);
  }
}
function confirmDeleteSkin(card, skin) {
  const actions = card.querySelector('.skin-card-actions'); actions.replaceChildren(el('small', '', 'Delete from library?'), button('Keep', 'quiet small', renderSkinLibrary), button('Delete', 'primary small', async () => { skinLibrary = await api.deleteSkin(skin.id); renderSkinLibrary(); toast('Saved skin deleted.'); }));
}

function profilePicker(id) { const select = $(id), prior = select.value; select.replaceChildren(); for (const profile of state.profiles) { const option = el('option', '', profile.name); option.value = profile.id; select.append(option); } select.value = state.profiles.some(profile => profile.id === prior) ? prior : state.selectedProfile || state.profiles[0]?.id || ''; return select.value; }
async function loadBackups() { const id = profilePicker('#backups-profile'), list = $('#backups-list'); list.replaceChildren(); if (!id) return list.append(emptyMods('No profiles yet', 'Create a profile before backing up worlds.')); const backups = await api.listBackups(id); if (!backups.length) list.append(emptyMods('No backups yet', 'Create a snapshot before changing a world or modpack.')); for (const backup of backups) { const card = el('article', 'profile-card'), actions = el('div', 'profile-card-actions'); card.append(el('small', '', 'WORLD SNAPSHOT'), el('h3', '', backup.name), el('p', '', new Date(backup.createdAt).toLocaleString()), el('small', '', backup.worlds.length ? backup.worlds.join(' · ') : 'No worlds found')); actions.append(button('Restore backup', 'primary', () => openRestoreDialog(id, backup))); card.append(actions); list.append(card); } }
let pendingRestore = null;
function openRestoreDialog(profileId, backup) { pendingRestore = { profileId, backup }; $('#restore-title').textContent = backup.name; $('#restore-error').textContent = ''; const worlds = $('#restore-worlds'); worlds.replaceChildren(); for (const world of backup.worlds) { const label = el('label', 'restore-world'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = world; input.checked = true; label.append(input, document.createTextNode(world)); worlds.append(label); } $('#restore-dialog').showModal(); }
async function loadScreenshots() { const id = profilePicker('#screenshots-profile'), grid = $('#screenshots-grid'); grid.replaceChildren(); if (!id) return grid.append(emptyMods('No profiles yet', 'Create a profile to keep screenshots separate.')); const shots = await api.listScreenshots(id); if (!shots.length) return grid.append(emptyMods('No screenshots yet', 'Minecraft screenshots will appear here.')); for (const shot of shots) { const card = el('article', 'screenshot-card'); if (shot.dataUrl) { const image = document.createElement('img'); image.src = shot.dataUrl; image.alt = shot.name; card.append(image); card.addEventListener('click', () => openScreenshot(id, shot)); } card.append(el('strong', '', shot.name), el('small', '', shot.skipped ? 'Preview skipped: file is large' : `${Math.ceil(shot.size / 1024)} KB`)); grid.append(card); } }
let activeScreenshot = null;
function openScreenshot(profileId, shot) { activeScreenshot = { profileId, ...shot }; $('#screenshot-title').textContent = shot.name; $('#screenshot-full').src = shot.dataUrl; $('#screenshot-full').alt = shot.name; $('#screenshot-dialog').showModal(); }

async function loadCatalog(refresh = false) {
  $('#refresh').disabled = true;
  try {
    catalog = await api.catalog(refresh);
    $('#latest-version').textContent = catalog.latest.release;
    $('#catalog-note').textContent = `${catalog.versions.length} official versions · Releases, snapshots, Beta and Alpha · ${catalog.cached ? 'Offline catalog — connect to install' : 'Source: Mojang'} `;
    $('#connection-label').textContent = catalog.cached ? 'Cached version catalog' : 'Mojang catalog connected';
    render();
  } catch (error) { $('#connection-label').textContent = 'Catalog connection unavailable'; $('#catalog-note').textContent = error.message; throw error; }
  finally { $('#refresh').disabled = false; }
}

function closeVersionPicker() { $('#profile-version-panel').hidden = true; $('#profile-version-trigger').setAttribute('aria-expanded', 'false'); }
function renderProfileVersions(query = '', preferred = '') {
  const input = $('#profile-version'), options = $('#profile-version-options'), search = query.trim().toLowerCase();
  const matches = catalog.versions.filter(supported).filter(v => `${v.id} ${versionTypeLabel(v.type)} ${String(v.releaseTime).slice(0, 10)}`.toLowerCase().includes(search));
  if (preferred) input.value = preferred;
  if (!input.value || !catalog.versions.some(v => v.id === input.value)) input.value = catalog.latest.release || matches[0]?.id || '';
  const selected = catalog.versions.find(v => v.id === input.value);
  $('#profile-version-trigger').firstElementChild.textContent = selected ? `${selected.id} · ${versionTypeLabel(selected.type)}` : 'Choose a version';
  options.replaceChildren();
  for (const v of matches) {
    const option = button(v.id, `version-picker-option${v.id === input.value ? ' active' : ''}`, () => {
      input.value = v.id; renderProfileVersions($('#profile-version-search').value); closeVersionPicker(); input.dispatchEvent(new Event('change'));
    });
    option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(v.id === input.value)); option.append(el('small', '', versionTypeLabel(v.type))); options.append(option);
  }
  if (!matches.length) options.append(el('div', 'empty compact', 'No matching versions.'));
  $('#profile-version-note').textContent = `${matches.length} of ${catalog.versions.filter(supported).length} official versions shown${search ? ` for “${query.trim()}”` : ''}.`;
  $('#save-profile').disabled = !input.value || loaderLoading;
  return input.value;
}

function openProfile(profile = null, version = null) {
  if (!catalog.versions.length) return toast('Load the version catalog first.', true);
  $('#profile-id').value = profile?.id || '';
  $('#dialog-title').textContent = profile?.id ? 'Edit profile' : 'New profile';
  $('#profile-name').value = profile?.name || (version ? `Vanilla ${version}` : 'My survival world');
  $('#profile-version-search').value = '';
  closeVersionPicker();
  renderProfileVersions('', profile?.version || version || catalog.latest.release);
  $('#profile-memory').value = String(profile?.memory || state.settings?.defaultMemory || 4);
  const defaultJava = state.settings?.defaultJava || 'auto'; $('#profile-java').value = !profile?.javaPath ? defaultJava : ['java', 'java.exe', 'auto'].includes(profile.javaPath.toLowerCase()) ? 'auto' : profile.javaPath;
  $('#profile-java-args').value = (profile?.javaArgs || String(state.settings?.defaultJvmArgs || '').split(/\s+/).filter(Boolean)).join('\n');
  $('#profile-game-args').value = (profile?.gameArgs || String(state.settings?.defaultGameArgs || '').split(/\s+/).filter(Boolean)).join('\n');
  $('#profile-jvm-args').textContent = profileJvmArguments(profile?.memory || state.settings?.defaultMemory || 4, $('#profile-version').value).join('\n');
  $('#profile-error').textContent = '';
  $('#java-check-result').textContent = 'Automatic Java is included; matching older runtimes are installed when needed.';
  $('#profile-dialog').showModal();
  $('#profile-loader').value = profile?.loader || state.settings?.defaultLoader || 'vanilla';
  loadLoaderVersions(profile?.loaderVersion);
}

async function loadLoaderVersions(selectedVersion) {
  const request = ++loaderRequest, loader = $('#profile-loader').value, minecraft = $('#profile-version').value;
  const select = $('#profile-loader-version'); select.replaceChildren();
  $('#loader-version-field').hidden = loader === 'vanilla';
  loaderLoading = loader !== 'vanilla'; $('#save-profile').disabled = loaderLoading;
  if (loader === 'vanilla') return;
  $('#loader-note').textContent = 'Loading compatible versions…';
  try {
    const versions = await api.loaderVersions(loader, minecraft);
    if (request !== loaderRequest) return;
    for (const v of versions) { const option = el('option', '', v.version + (v.stable ? '' : ' · preview')); option.value = v.version; select.append(option); }
    select.value = versions.some(v => v.version === selectedVersion) ? selectedVersion : (versions.find(v => v.stable) || versions[0])?.version || '';
    $('#loader-note').textContent = versions.length ? `${loaderNames[loader]} builds for Minecraft ${minecraft}. Add compatible mods to this profile’s mods folder.${loader === 'fabric' ? ' Some mods also need Fabric API.' : loader === 'quilt' ? ' Some mods also need Quilted Fabric API.' : loader === 'liteloader' ? ' LiteLoader is legacy and its 1.12.2 build is a preview.' : ''}` : `No ${loaderNames[loader]} builds are available for Minecraft ${minecraft}. Choose another game version or loader.`;
  } catch (error) { if (request === loaderRequest) $('#loader-note').textContent = error.message; }
  finally { if (request === loaderRequest) { loaderLoading = false; $('#save-profile').disabled = !select.value; } }
}
$('#profile-loader').addEventListener('change', () => loadLoaderVersions());
$('#profile-version').addEventListener('change', () => { $('#profile-jvm-args').textContent = profileJvmArguments(Number($('#profile-memory').value), $('#profile-version').value).join('\n'); loadLoaderVersions(); });
$('#profile-version-trigger').addEventListener('click', () => { const panel = $('#profile-version-panel'), opening = panel.hidden; panel.hidden = !opening; $('#profile-version-trigger').setAttribute('aria-expanded', String(opening)); if (opening) { $('#profile-version-search').focus(); $('#profile-version-search').select(); } });
$('#profile-version-search').addEventListener('input', () => renderProfileVersions($('#profile-version-search').value));
$('#profile-version-search').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeVersionPicker(); $('#profile-version-trigger').focus(); } });
$('#profile-dialog').addEventListener('click', event => { if (!event.target.closest('.version-picker')) closeVersionPicker(); });
$('#profile-memory').addEventListener('change', () => { $('#profile-jvm-args').textContent = profileJvmArguments(Number($('#profile-memory').value), $('#profile-version').value).join('\n'); });
$('#mods-profile').addEventListener('change', () => { modState = null; shaderState = null; resourcepackState = null; shaderAdapter = null; modSearchState = { query: '', offset: 0, total: 0, hits: [] }; shaderSearchState = { query: '', offset: 0, total: 0, hits: [] }; resourcepackSearchState = { query: '', offset: 0, total: 0, hits: [] }; guard(loadModsView); });
$$('[data-library-tab]').forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.libraryTab === 'shaders' && !shaderAdapter) return; libraryTab = tab.dataset.libraryTab; $('#mod-search').value = ''; guard(loadModsView); }));
$('#mod-search-form').addEventListener('submit', event => { event.preventDefault(); guard(() => searchMods(false)); });
$('#more-mods').addEventListener('click', () => guard(() => searchMods(true)));
$('#close-mod-details').addEventListener('click', () => $('#mod-details-dialog').close());
$('#mod-details-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#mod-details-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
function showNextDependencyWarning() { if (pendingDependencyInstall || !dependencyInstallQueue.length) return; pendingDependencyInstall = dependencyInstallQueue.shift(); $('#missing-dependency-copy').textContent = pendingDependencyInstall.message; $('#missing-dependency-dialog').showModal(); }
function closeMissingDependency() { pendingDependencyInstall = null; $('#missing-dependency-dialog').close(); showNextDependencyWarning(); }
$('#close-missing-dependency').addEventListener('click', closeMissingDependency);
$('#cancel-missing-dependency').addEventListener('click', closeMissingDependency);
$('#missing-dependency-dialog').addEventListener('cancel', event => { event.preventDefault(); closeMissingDependency(); });
$('#install-anyway').addEventListener('click', () => { const choice = pendingDependencyInstall; pendingDependencyInstall = null; $('#missing-dependency-dialog').close(); if (choice) guard(choice.install); showNextDependencyWarning(); });
$('#open-mods-folder').addEventListener('click', () => guard(() => libraryTab === 'shaders' ? api.openShaders(selectedModProfile().id) : libraryTab === 'resourcepacks' ? api.openResourcepacks(selectedModProfile().id) : api.openMods(selectedModProfile().id)));
$('#import-library-files').addEventListener('click', () => guard(async () => { const profile = selectedModProfile(), kind = libraryTab === 'shaders' ? 'shader' : libraryTab === 'resourcepacks' ? 'resourcepack' : 'mod', result = await api.importContent(profile.id, kind); if (!result) return; await loadModsView(); toast(`${result.imported.length} ${kind === 'resourcepack' ? 'resource pack' : kind}${result.imported.length === 1 ? '' : 's'} imported.`); }));
$('#mods-create-profile').addEventListener('click', () => openProfile());
$('#check-mod-updates').addEventListener('click', () => guard(async () => { modUpdates = await api.modUpdates(selectedModProfile().id); renderMods(); if (!modUpdates.length) toast('All managed mods are up to date.'); }));
$('#update-all-mods').addEventListener('click', () => guard(() => runModTask(null, () => api.updateAllMods(selectedModProfile().id))));
$('#modpack-search-form').addEventListener('submit', event => { event.preventDefault(); guard(() => searchModpacks(false)); });
$('#more-modpacks').addEventListener('click', () => guard(() => searchModpacks(true)));
$('#import-modpack').addEventListener('click', () => guard(() => runModpackTask(() => api.importModpack(), 'Local modpack imported.')));
$('#close-modpack-details').addEventListener('click', () => $('#modpack-details-dialog').close());
$('#modpack-details-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#modpack-details-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });

async function installSelectedProfile(p) {
  busy = true; render(); $('#download-panel').hidden = false; $('#cancel-install').disabled = false;
  try { state = await api.installProfile(p.id); toast(`${profileLabel(p)} is ready.`); }
  finally { busy = false; $('#download-panel').hidden = true; state = await api.state(); render(); }
}

async function install(id) {
  if (busy || running) return;
  busy = true; render();
  $('#download-panel').hidden = false; $('#download-title').textContent = `Preparing ${id}`; $('#download-count').textContent = 'Reading metadata…'; $('#download-progress').value = 0;
  $('#cancel-install').disabled = false;
  log(`Installing Minecraft ${id}. Existing files will be verified.`);
  try { state = await api.install(id); toast(`Minecraft ${id} is installed.`); log(`${id} installation completed.`); }
  finally { busy = false; $('#download-panel').hidden = true; state = await api.state(); render(); }
}

$$('[data-view]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.go)));
$$('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; limit = 40; $$('[data-filter]').forEach(n => n.classList.toggle('active', n === b)); renderVersions(); }));
$('#search').addEventListener('input', () => { limit = 40; renderVersions(); });
$('#load-more').addEventListener('click', () => { limit += 40; renderVersions(); });
$('#refresh').addEventListener('click', () => guard(() => loadCatalog(true)));
$('#open-folder').addEventListener('click', () => guard(() => api.openFolder()));
async function checkLauncherUpdates({ announceCurrent = false, silent = false } = {}) {
  if (launcherUpdateCheckPending) return;
  const button = $('#check-updates');
  launcherUpdateCheckPending = true; button.disabled = true;
  if (!latestLauncherUpdate?.available) button.textContent = 'Checking…';
  try {
    const result = await api.checkUpdates(); latestLauncherUpdate = result;
    if (result.available) {
      button.textContent = `Download ${result.latest}`; button.className = 'primary small';
      toast(`Blocklane ${result.latest} is available.`);
    } else {
      button.textContent = 'Check for updates'; button.className = 'quiet small';
      if (announceCurrent) toast(`Blocklane ${result.current} is up to date.`);
    }
  } catch (error) {
    button.textContent = 'Check for updates'; button.className = 'quiet small';
    if (silent) log(`Automatic update check failed: ${error.message}`);
    else throw error;
  } finally { launcherUpdateCheckPending = false; button.disabled = false; }
}
$('#check-updates').addEventListener('click', () => guard(() => latestLauncherUpdate?.available
  ? api.openUpdate(latestLauncherUpdate.installerUrl || latestLauncherUpdate.releaseUrl)
  : checkLauncherUpdates({ announceCurrent: true })));
$('#new-profile').addEventListener('click', () => openProfile());
$('#create-custom-pack').addEventListener('click', openCustomPackWizard);
for (const selector of ['#close-custom-pack', '#cancel-custom-pack']) $(selector).addEventListener('click', () => $('#custom-pack-dialog').close());
$('#custom-pack-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#custom-pack-loader').addEventListener('change', () => guard(loadCustomPackLoaders));
$('#custom-pack-minecraft').addEventListener('change', () => guard(loadCustomPackLoaders));
$('#custom-pack-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const pack = await api.createCustomPack({ name: $('#custom-pack-name').value.trim(), versionId: $('#custom-pack-version-id').value.trim(), summary: $('#custom-pack-summary').value.trim(), version: $('#custom-pack-minecraft').value.trim(), loader: $('#custom-pack-loader').value, loaderVersion: $('#custom-pack-loader-version').value }); customPacks = await api.listCustomPacks(); $('#custom-pack-dialog').close(); renderModpacks(); toast(`${pack.name} created.`); if (pack.loader !== 'vanilla') await openCustomPackMods(pack); }).catch(error => { $('#custom-pack-error').textContent = error.message; }); });
for (const selector of ['#close-custom-pack-mods', '#done-custom-pack-mods']) $(selector).addEventListener('click', () => $('#custom-pack-mods-dialog').close());
$('#custom-pack-mods-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#custom-pack-mod-search').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const result = await api.searchCustomPackMods(customPackEditor.id, $('#custom-pack-mod-query').value.trim(), 0); customPackModHits = result.hits; renderCustomPackMods(); }).catch(error => { $('#custom-pack-mod-error').textContent = error.message; }); });
$('#custom-pack-import-mods').addEventListener('click', () => guard(async () => { $('#custom-pack-mod-error').textContent = ''; const result = await api.importCustomPackMods(customPackEditor.id); if (!result) return; customPackMods = result.mods; renderCustomPackMods(); toast(`${result.imported.length} local mod${result.imported.length === 1 ? '' : 's'} imported.`); }));
$('#close-worlds').addEventListener('click', () => $('#worlds-dialog').close());
$('#worlds-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#import-default-worlds').addEventListener('click', () => runWorldImport(() => api.importDefaultWorlds(worldProfile.id)));
$('#import-world-folder').addEventListener('click', () => runWorldImport(() => api.importWorldFolder(worldProfile.id)));
$('#import-world-zip').addEventListener('click', () => runWorldImport(() => api.importWorldZip(worldProfile.id)));
$('#worlds-list').addEventListener('change', updateWorldActions);
$('#backup-worlds').addEventListener('click', () => guard(async () => { const names = selectedWorldNames(); if (!names.length) throw new Error('Choose at least one world.'); const result = await api.backupWorlds(worldProfile.id, names, 'Before upgrade'); toast(`${result.worlds.length} world${result.worlds.length === 1 ? '' : 's'} backed up.`); }).catch(error => { $('#worlds-error').textContent = error.message; }));
$('#transfer-worlds').addEventListener('click', openWorldTransfer);
$('#delete-worlds').addEventListener('click', requestWorldDelete);
$('#cancel-world-delete').addEventListener('click', () => { $('#world-delete-confirm').hidden = true; });
$('#confirm-world-delete').addEventListener('click', () => guard(async () => { const result = await api.deleteWorlds(worldProfile.id, pendingWorldNames); await refreshWorldManager(); toast(`${result.removed.length} world${result.removed.length === 1 ? '' : 's'} deleted.`); }).catch(error => { $('#worlds-error').textContent = error.message; }));
for (const selector of ['#close-world-transfer', '#cancel-world-transfer']) $(selector).addEventListener('click', () => $('#world-transfer-dialog').close());
$('#world-transfer-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#world-transfer-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const destination = $('#world-destination').value, move = $('[name="world-transfer-mode"]:checked').value === 'move'; const result = await api.transferWorlds(worldProfile.id, destination, pendingWorldNames, move); $('#world-transfer-dialog').close(); await refreshWorldManager(); toast(`${result.transferred.length} world${result.transferred.length === 1 ? '' : 's'} ${move ? 'moved' : 'copied'}.`); }).catch(error => { $('#world-transfer-error').textContent = error.message; }); });
$('#backups-profile').addEventListener('change', () => guard(loadBackups));
$('#screenshots-profile').addEventListener('change', () => guard(loadScreenshots));
$('#create-backup').addEventListener('click', () => { $('#backup-name').value = 'World backup'; $('#backup-error').textContent = ''; $('#backup-dialog').showModal(); $('#backup-name').focus(); });
for (const selector of ['#close-backup', '#cancel-backup']) $(selector).addEventListener('click', () => $('#backup-dialog').close());
$('#backup-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const name = $('#backup-name').value.trim(); if (!name) throw new Error('Enter a backup name.'); await api.backupProfile($('#backups-profile').value, name); $('#backup-dialog').close(); await loadBackups(); toast('World backup created.'); }).catch(error => { $('#backup-error').textContent = error.message; }); });
for (const selector of ['#close-restore', '#cancel-restore']) $(selector).addEventListener('click', () => $('#restore-dialog').close());
$('#restore-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const worlds = $$('#restore-worlds input:checked').map(input => input.value); await api.restoreBackup(pendingRestore.profileId, pendingRestore.backup.id, worlds); $('#restore-dialog').close(); await loadBackups(); toast('Selected worlds restored.'); }); });
$('#delete-backup').addEventListener('click', () => guard(async () => { if (!pendingRestore) return; await api.deleteBackup(pendingRestore.profileId, pendingRestore.backup.id); $('#restore-dialog').close(); await loadBackups(); toast('Backup deleted.'); }));
$('#close-screenshot').addEventListener('click', () => $('#screenshot-dialog').close());
$('#export-screenshot').addEventListener('click', () => guard(async () => { if (!activeScreenshot) return; const result = await api.exportScreenshot(activeScreenshot.profileId, activeScreenshot.name); if (result.exported) toast('Screenshot exported.'); }));
$('#open-backups-folder').addEventListener('click', () => guard(() => api.openBackups($('#backups-profile').value)));
$('#open-screenshots-folder').addEventListener('click', () => guard(() => api.openScreenshots($('#screenshots-profile').value)));
$('#edit-active').addEventListener('click', () => openProfile(currentProfile()));
$('#active-profile').addEventListener('change', () => guard(async () => { state = await api.selectProfile($('#active-profile').value); render(); }));
$('#play-button').addEventListener('click', () => guard(async () => {
  const p = currentProfile();
  if (!p) return openProfile();
  if (!profileInstalled(p)) return installSelectedProfile(p);
  busy = true; render(); $('#play-button').textContent = 'Starting…';
  $('#download-panel').hidden = false; $('#download-title').textContent = 'Preparing Java'; $('#download-count').textContent = 'Checking the matching runtime…'; $('#download-progress').value = 0; $('#cancel-install').disabled = false;
  try { await api.launch(p.id); running = (await api.state()).running; log(`Minecraft ${p.version} launched ${accountState.selected === 'demo' ? 'in demo mode' : 'with your Microsoft account'}.`); }
  finally { busy = false; $('#download-panel').hidden = true; render(); }
}));
$('#cancel-install').addEventListener('click', () => guard(async () => { await api.cancel(); $('#cancel-install').disabled = true; $('#download-title').textContent = 'Cancelling…'; }));
$('#log-file').addEventListener('change', () => guard(loadSelectedLog));
$('#log-search').addEventListener('input', renderVisibleLog);
$('#open-logs').addEventListener('click', () => guard(() => api.openLogs()));
$('#copy-log').addEventListener('click', () => guard(async () => { await api.copyText($('#log').textContent); toast('Visible log copied.'); }));
$('#export-log').addEventListener('click', () => guard(async () => { if (!activeLog) throw new Error('Choose a saved game log first.'); const result = await api.exportLog(activeLog.name); if (result) toast('Log exported.'); }));
$('#open-runtimes').addEventListener('click', () => guard(() => api.openRuntimes()));
$('#java-auto-toggle').addEventListener('click', () => guard(async () => { const automatic = $('#java-auto-toggle').getAttribute('aria-checked') === 'true'; if (!automatic) return chooseJavaDefault('auto'); const data = await api.javaManager(), runtime = data.runtimes.find(item => item.healthy); if (!runtime) { $('#java-manager-status').textContent = 'Install a Java runtime before switching to manual selection.'; return; } await chooseJavaDefault(runtime.executable); }));
$('#install-java').addEventListener('click', () => guard(async () => { const installButton = $('#install-java'), major = Number($('#java-install-version').value), panel = $('#java-install-progress'); javaInstalling = true; installButton.disabled = true; $('#java-install-version').disabled = true; $('#choose-custom-java').disabled = true; panel.hidden = false; $('#java-progress-stage').textContent = `Preparing Java ${major}`; $('#java-progress-detail').textContent = 'Reading runtime information…'; $('#java-progress-percent').textContent = '0%'; $('#java-progress-bar').max = 1; $('#java-progress-bar').value = 0; $('#cancel-java-install').disabled = false; $('#java-manager-status').textContent = ''; try { const result = await api.installJava(major); $('#java-progress-stage').textContent = `Java ${result.java.version} is ready`; $('#java-progress-detail').textContent = `${result.java.arch} runtime installed and verified.`; $('#java-progress-percent').textContent = '100%'; $('#java-progress-bar').value = $('#java-progress-bar').max; $('#java-manager-status').textContent = `Java ${result.java.version} installed successfully.`; await loadJavaManager(); } catch (error) { $('#java-progress-stage').textContent = /cancel/i.test(error.message) ? 'Java installation cancelled' : 'Java installation failed'; $('#java-progress-detail').textContent = error.message; throw error; } finally { javaInstalling = false; installButton.disabled = false; $('#java-install-version').disabled = false; $('#choose-custom-java').disabled = false; $('#cancel-java-install').disabled = true; } }));
$('#cancel-java-install').addEventListener('click', () => guard(async () => { $('#cancel-java-install').disabled = true; $('#java-progress-stage').textContent = 'Cancelling Java installation…'; await api.cancel(); }));
$('#choose-custom-java').addEventListener('click', () => guard(async () => { const executable = await api.browseJava(); if (!executable) return; $('#java-manager-status').textContent = 'Checking the selected Java executable…'; const java = await api.inspectJava(executable); await chooseJavaDefault(executable); $('#java-manager-status').textContent = `Java ${java.version} · ${java.arch} selected.`; }));
$('#settings-panel').addEventListener('change', event => guard(async () => {
  const input = event.target.closest('[data-setting]'); if (!input) return; const key = input.dataset.setting, type = input.dataset.settingType;
  const value = type === 'toggle' ? input.checked : type === 'number' || (type === 'select' && /^\d+$/.test(input.value)) ? Number(input.value) : input.value;
  state = await api.saveSettings({ ...state.settings, [key]: value }); applySettingsAppearance(); renderSettings();
  if (key === 'loggingEnabled') $('#log').textContent = value ? 'Game logging enabled. New launches will appear here.\n' : 'Logging disabled. New game launches will discard all output.\n';
  toast(`${settingSections[settingsTab].fields.find(field => field[0] === key)?.[1] || 'Setting'} saved.`);
}));
for (const selector of ['#close-storage-details', '#done-storage-details']) $(selector).addEventListener('click', () => $('#storage-details-dialog').close());
$('#storage-details-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
for (const selector of ['#close-recover-orphan', '#cancel-recover-orphan']) $(selector).addEventListener('click', () => $('#recover-orphan-dialog').close());
$('#recover-orphan-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#recover-orphan-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { try { state = await api.recoverOrphan($('#recover-orphan-id').value, $('#recover-orphan-name').value.trim(), $('#recover-orphan-version').value); $('#recover-orphan-dialog').close(); render(); await renderStorageDetails(); await loadStorageManager(); toast('Profile recovered.'); } catch (error) { $('#recover-orphan-error').textContent = error.message; } }); });
for (const selector of ['#close-dialog', '#cancel-dialog']) $(selector).addEventListener('click', () => $('#profile-dialog').close());
$('#profile-form').addEventListener('submit', async event => {
  if (loaderLoading) { event.preventDefault(); return; }
  event.preventDefault(); $('#save-profile').disabled = true; $('#profile-error').textContent = '';
  try { state = await api.saveProfile({ id: $('#profile-id').value || undefined, name: $('#profile-name').value, version: $('#profile-version').value, memory: Number($('#profile-memory').value), javaPath: $('#profile-java').value, javaArgs: $('#profile-java-args').value.split(/\r?\n/).map(arg => arg.trim()).filter(Boolean), gameArgs: $('#profile-game-args').value.split(/\r?\n/).map(arg => arg.trim()).filter(Boolean), loader: $('#profile-loader').value, loaderVersion: $('#profile-loader-version').value }); $('#profile-dialog').close(); render(); toast('Profile saved.'); }
  catch (error) { $('#profile-error').textContent = error.message; }
  finally { $('#save-profile').disabled = false; }
});
$('#browse-java').addEventListener('click', () => guard(async () => { const javaPath = await api.browseJava(); if (javaPath) $('#profile-java').value = javaPath; }));
$('#check-java').addEventListener('click', async () => {
  if (['', 'auto', 'java', 'java.exe'].includes($('#profile-java').value.trim().toLowerCase())) { $('#java-check-result').textContent = 'Automatic: Blocklane selects and verifies the matching bundled or downloaded Java runtime.'; return; }
  $('#check-java').disabled = true; $('#java-check-result').textContent = 'Checking Java…';
  try { const java = await api.inspectJava($('#profile-java').value); $('#java-check-result').textContent = `Java ${java.version} · ${java.arch}`; }
  catch (error) { $('#java-check-result').textContent = error.message; }
  finally { $('#check-java').disabled = false; }
});
api.on('progress', p => { $('#download-title').textContent = p.message; $('#download-count').textContent = `${p.done.toLocaleString()} / ${p.total.toLocaleString()} files checked`; $('#download-progress').max = p.total; $('#download-progress').value = p.done; if (javaInstalling) { const total = Math.max(1, Number(p.total) || 1), done = Math.min(total, Math.max(0, Number(p.done) || 0)), percent = Math.round(done / total * 100); $('#java-progress-stage').textContent = p.message; $('#java-progress-detail').textContent = total === 1 && done === 0 ? 'Preparing download…' : `${done.toLocaleString()} of ${total.toLocaleString()} runtime files`; $('#java-progress-percent').textContent = `${percent}%`; $('#java-progress-bar').max = total; $('#java-progress-bar').value = done; } });
api.on('content-progress', task => { contentDownloads.set(task.key, task); if (task.kind === 'custom-mod' && customPackEditor?.id === task.profileId && $('#custom-pack-mods-dialog').open) renderCustomPackMods(); else if (task.kind === 'modpack' && $('#view-modpacks').classList.contains('active')) renderModpacks(); else if (selectedModProfile()?.id === task.profileId) renderMods(); });
api.on('log', log);
api.on('game-start', () => { running = true; render(); });
api.on('game-exit', ({ code }) => { running = false; render(); log(`Minecraft exited (code ${code}).`); if (code !== 0) toast('Minecraft closed unexpectedly. Open Activity for the game log.', true); });
api.on('accounts-changed', value => { accountState = value; if (!value.pending) $('#login-dialog').close(); render(); });
api.on('auth-error', message => { $('#login-dialog').close(); toast(message, true); });
api.on('quick-play-error', ({ profile, message }) => toast(`Could not quick-play ${profile}: ${message}`, true));
$('#active-account').addEventListener('change', () => guard(async () => { accountState = await api.selectAccount($('#active-account').value); render(); }));
$('#add-account').addEventListener('click', () => guard(async () => {
  if (!accountState.configured) return;
  loginStarting = true; render();
  try {
    const info = await api.beginLogin();
    accountState = await api.accounts();
    if (!accountState.pending) return;
    $('#login-code').textContent = info.userCode;
    $('#login-status').textContent = `Enter this code at ${info.verificationUri}. Expires at ${new Date(info.expiresAt).toLocaleTimeString()}.`;
    $('#login-dialog').showModal();
    try { await api.openLogin(); } catch { $('#login-status').textContent += ' Click Open Microsoft sign-in to try opening your browser again.'; }
  } finally { loginStarting = false; render(); }
}));
$('#open-login').addEventListener('click', () => guard(() => api.openLogin()));
$('#add-local-account').addEventListener('click', () => { $('#local-name').value = ''; $('#local-error').textContent = ''; $('#local-dialog').showModal(); $('#local-name').focus(); });
$('#close-local').addEventListener('click', () => $('#local-dialog').close());
$('#cancel-local').addEventListener('click', () => $('#local-dialog').close());
$('#local-form').addEventListener('submit', event => guard(async () => { event.preventDefault(); try { accountState = await api.createLocalAccount($('#local-name').value); $('#local-dialog').close(); render(); toast('Local profile created.'); } catch (error) { $('#local-error').textContent = error.message; } }));
$('#skins-account').addEventListener('change', () => { skinAccountId = $('#skins-account').value; guard(loadSkins); });
$('#import-skin').addEventListener('click', () => { $('#skin-import-name').value = ''; $('#skin-import-variant').value = 'classic'; $('#skin-import-error').textContent = ''; $('#skin-import-dialog').showModal(); $('#skin-import-name').focus(); });
for (const selector of ['#close-skin-import', '#cancel-skin-import']) $(selector).addEventListener('click', () => $('#skin-import-dialog').close());
$('#skin-import-form').addEventListener('submit', async event => { event.preventDefault(); $('#skin-import-error').textContent = ''; try { const skin = await api.importSkin($('#skin-import-name').value, $('#skin-import-variant').value); if (!skin) return; $('#skin-import-dialog').close(); await loadSkins(); toast('Skin saved to your library.'); } catch (error) { $('#skin-import-error').textContent = error.message; } });
for (const selector of ['#close-skin-rename', '#cancel-skin-rename']) $(selector).addEventListener('click', () => $('#skin-rename-dialog').close());
$('#skin-rename-form').addEventListener('submit', async event => { event.preventDefault(); $('#skin-rename-error').textContent = ''; try { skinLibrary = await api.renameSkin($('#skin-rename-id').value, $('#skin-rename-name').value); $('#skin-rename-dialog').close(); renderSkinLibrary(); toast('Skin renamed.'); } catch (error) { $('#skin-rename-error').textContent = error.message; } });
$('#copy-code').addEventListener('click', () => guard(async () => { await api.copyDeviceCode($('#login-code').textContent.trim()); toast('Sign-in code copied.'); }));
$('#cancel-login').addEventListener('click', () => guard(async () => { await api.cancelLogin(); $('#login-status').textContent = 'Cancelling…'; }));
$('#login-dialog').addEventListener('cancel', event => { event.preventDefault(); guard(() => api.cancelLogin()); });

async function boot() {
  if (!api) { $('#connection-label').textContent = 'Open this app with Electron'; return; }
  state = await api.state(); busy = state.busy; running = state.running; try { [installedModpacks, customPacks] = await Promise.all([api.listModpacks(), api.listCustomPacks()]); } catch {} render();
  if (state.settings?.rememberPage) { const page = localStorage.getItem('blocklane:last-page'); if (page && $(`#view-${page}`)) navigate(page); }
  try { accountState = await api.accounts(); render(); } catch (error) { toast(error.message, true); }
  $('#stat-java').textContent = 'Managed'; $('#java-caption').textContent = 'Java 25 included · automatic selection';
  if (state.settings?.autoCheckUpdates !== false) void checkLauncherUpdates({ silent: true });
  await guard(() => loadCatalog());
}
guard(boot);







