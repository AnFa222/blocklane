const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const api = window.launcher;
let state = { profiles: [], installed: [], selectedProfile: null };
let catalog = { versions: [], latest: {} };
let filter = 'release', limit = 40, busy = false, running = false, toastTimer;
let accountState = { selected: 'demo', configured: false, accounts: [{ id: 'demo', name: 'Demo player', type: 'demo' }] };
let loginStarting = false;

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function button(text, className, action) { const node = el('button', className, text); node.addEventListener('click', () => guard(action)); return node; }
function toast(message, error = false) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 12000 : 4500); }
function log(message) { const box = $('#log'); box.textContent = (box.textContent + `\n[${new Date().toLocaleTimeString()}] ${message}`).slice(-80000); box.scrollTop = box.scrollHeight; }
async function guard(action) { try { return await action(); } catch (e) { toast(e.message, true); log(e.message); } }
function navigate(view) { $$('.view').forEach(n => n.classList.toggle('active', n.id === `view-${view}`)); $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view)); $('#page-title').textContent = view[0].toUpperCase() + view.slice(1); }
function installed(id) { return state.installed.find(v => v.id === id); }
function currentProfile() { return state.profiles.find(p => p.id === state.selectedProfile); }
function supported(v) { return ['release', 'snapshot'].includes(v.type) && v.releaseTime >= '2018-07-18'; }

function render() {
  $('#nav-installed').textContent = state.installed.length;
  $('#stat-installed').textContent = state.installed.length;
  $('#stat-profiles').textContent = state.profiles.length;
  const select = $('#active-profile'); select.replaceChildren();
  if (!state.profiles.length) select.append(el('option', '', 'Create your first profile'));
  for (const p of state.profiles) { const option = el('option', '', p.name); option.value = p.id; select.append(option); }
  select.value = state.selectedProfile || '';
  select.disabled = busy || running || !state.profiles.length;
  const p = currentProfile();
  $('#profile-detail').textContent = p ? `Vanilla ${p.version}  ·  ${p.memory} GB RAM  ·  ${installed(p.version) ? 'Installed' : 'Not installed'}` : 'Pin a version and give your worlds a home.';
  $('#edit-active').disabled = !p || busy || running;
  $('#play-button').disabled = busy || running || accountState.pending || loginStarting || (!p && !catalog.versions.length);
  $('#play-button').textContent = running ? 'Minecraft is running' : busy ? 'Working…' : !p ? '＋ Create profile' : installed(p.version) ? accountState.selected === 'demo' ? '▷ Play demo' : '▷ Play Minecraft' : '↓ Install version';
  $('#new-profile').disabled = !catalog.versions.length || busy || running;
  renderVersions(); renderProfiles(); renderAccounts();
}

function renderAccounts() {
  const selected = accountState.accounts.find(a => a.id === accountState.selected) || accountState.accounts[0];
  $('#sidebar-account').textContent = selected.name;
  $('#account-avatar').textContent = selected.name[0].toUpperCase();
  const picker = $('#active-account'); picker.replaceChildren();
  for (const a of accountState.accounts) { const option = el('option', '', a.name + (a.type === 'demo' ? ' · Demo' : ' · Microsoft')); option.value = a.id; picker.append(option); }
  picker.value = selected.id;
  const locked = busy || running || accountState.pending || loginStarting;
  picker.disabled = locked; $('#add-account').disabled = locked || Boolean(accountState.issue) || !accountState.configured;
  $('#play-mode-note').textContent = selected.id === 'demo' ? 'Demo mode is selected. Sign in with an account that has Minecraft Java Edition access to play the full game.' : `Playing as ${selected.name}. Your Minecraft Java access is checked when signing in or renewing your session.`;
  $('#account-notice').textContent = accountState.issue || (!accountState.configured ? 'Microsoft sign-in is not available in this development build. You can play Demo.' : 'Sign in through Microsoft’s website. Saved accounts are encrypted for your Windows user.');
  const grid = $('#accounts-grid'); grid.replaceChildren();
  for (const a of accountState.accounts) {
    const card = el('article', `profile-card${a.id === selected.id ? ' selected' : ''}`);
    card.append(el('small', '', a.type === 'demo' ? 'NO ACCOUNT REQUIRED' : 'MICROSOFT ACCOUNT'), el('h3', '', a.name), el('p', '', a.type === 'demo' ? 'Try Minecraft in demo mode.' : 'Minecraft Java Edition'));
    const actions = el('div', 'profile-card-actions');
    actions.append(button(a.id === selected.id ? 'Selected' : a.type === 'demo' ? 'Choose demo' : 'Use account', a.id === selected.id ? 'quiet' : 'primary', async () => { accountState = await api.selectAccount(a.id); render(); }));
    if (a.type !== 'demo') actions.append(button('Remove', 'quiet', () => {
      actions.replaceChildren(el('small', '', 'Remove saved sign-in? Worlds are kept.'), button('Keep', 'quiet', renderAccounts), button('Remove account', 'primary', async () => { accountState = await api.removeAccount(a.id); render(); }));
    }));
    actions.querySelectorAll('button').forEach(b => b.disabled = locked);
    card.append(actions); grid.append(card);
  }
}

function renderVersions() {
  const search = $('#search').value.trim().toLowerCase();
  const rows = catalog.versions.filter(v => (filter === 'installed' ? installed(v.id) : v.type === filter) && v.id.toLowerCase().includes(search));
  const list = $('#version-list'); list.replaceChildren();
  if (!rows.length) { const empty = el('div', 'empty'); empty.append(el('h3', '', catalog.versions.length ? 'No versions here yet.' : 'Catalog unavailable'), el('p', '', catalog.versions.length ? 'Try another filter, or install your first version.' : 'Connect to the internet and refresh to load Minecraft versions.')); list.append(empty); }
  for (const v of rows.slice(0, limit)) {
    const item = installed(v.id), row = el('div', 'version-row');
    const name = el('div', 'version-name'), label = el('div');
    label.append(el('strong', '', v.id), el('small', '', v.id === catalog.latest.release ? 'LATEST RELEASE' : v.id === catalog.latest.snapshot ? 'LATEST SNAPSHOT' : v.type.toUpperCase())); name.append(el('span', 'cube', '◇'), label);
    row.append(name, el('span', 'version-date', new Date(v.releaseTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })), el('span', `badge${item ? ' ready' : ''}`, item ? '● Installed' : supported(v) ? 'Available' : 'Legacy · later'));
    const actions = el('div', 'row-actions');
    if (item) {
      actions.append(button('Repair', 'quiet', () => install(v.id)), button('Use', 'primary', () => openProfile(null, v.id)));
      const remove = button('×', 'quiet', async () => { state = await api.removeVersion(v.id); render(); }); remove.title = `Remove ${v.id}`; remove.setAttribute('aria-label', remove.title); actions.append(remove);
    } else { const b = button('↓ Install', 'quiet', () => install(v.id)); b.disabled = !supported(v); if (!supported(v)) b.title = 'Legacy versions are planned for a later release.'; actions.append(b); }
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
    top.append(el('span', 'stat-icon', '▤'), el('small', '', selected ? 'ACTIVE PROFILE' : 'VANILLA'));
    card.append(top, el('h3', '', p.name), el('p', '', `Minecraft ${p.version} · ${p.memory} GB RAM`), el('small', '', installed(p.version) ? '● Version installed' : 'Version needs installation'));
    const actions = el('div', 'profile-card-actions');
    actions.append(button(selected ? 'Selected' : 'Select profile', selected ? 'quiet' : 'primary', async () => { state = await api.selectProfile(p.id); render(); }), button('Edit', 'quiet', () => openProfile(p)), button('Delete profile', 'quiet', () => confirmDeleteProfile(p)));
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

async function loadCatalog(refresh = false) {
  $('#refresh').disabled = true;
  try {
    catalog = await api.catalog(refresh);
    $('#latest-version').textContent = catalog.latest.release;
    $('#catalog-note').textContent = `${catalog.versions.length} official versions · Vanilla 1.13+ supported · ${catalog.cached ? 'Offline catalog — connect to install' : 'Source: Mojang'} `;
    $('#connection-label').textContent = catalog.cached ? 'Cached version catalog' : 'Mojang catalog connected';
    render();
  } catch (error) { $('#connection-label').textContent = 'Catalog connection unavailable'; $('#catalog-note').textContent = error.message; throw error; }
  finally { $('#refresh').disabled = false; }
}

function openProfile(profile = null, version = null) {
  if (!catalog.versions.length) return toast('Load the version catalog first.', true);
  $('#profile-id').value = profile?.id || '';
  $('#dialog-title').textContent = profile ? 'Edit profile' : 'New profile';
  $('#profile-name').value = profile?.name || (version ? `Vanilla ${version}` : 'My survival world');
  const select = $('#profile-version'); select.replaceChildren();
  for (const v of catalog.versions.filter(supported)) { const option = el('option', '', `${v.id}${v.type === 'snapshot' ? ' · snapshot' : ''}`); option.value = v.id; select.append(option); }
  select.value = profile?.version || version || catalog.latest.release;
  $('#profile-memory').value = String(profile?.memory || 4);
  $('#profile-java').value = !profile?.javaPath || ['java', 'java.exe', 'auto'].includes(profile.javaPath.toLowerCase()) ? 'auto' : profile.javaPath;
  $('#profile-error').textContent = '';
  $('#java-check-result').textContent = 'Automatic Java is included; matching older runtimes are installed when needed.';
  $('#profile-dialog').showModal();
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
$('#new-profile').addEventListener('click', () => openProfile());
$('#edit-active').addEventListener('click', () => openProfile(currentProfile()));
$('#active-profile').addEventListener('change', () => guard(async () => { state = await api.selectProfile($('#active-profile').value); render(); }));
$('#play-button').addEventListener('click', () => guard(async () => {
  const p = currentProfile();
  if (!p) return openProfile();
  if (!installed(p.version)) return install(p.version);
  busy = true; render(); $('#play-button').textContent = 'Starting…';
  $('#download-panel').hidden = false; $('#download-title').textContent = 'Preparing Java'; $('#download-count').textContent = 'Checking the matching runtime…'; $('#download-progress').value = 0; $('#cancel-install').disabled = false;
  try { await api.launch(p.id); running = (await api.state()).running; log(`Minecraft ${p.version} launched ${accountState.selected === 'demo' ? 'in demo mode' : 'with your Microsoft account'}.`); }
  finally { busy = false; $('#download-panel').hidden = true; render(); }
}));
$('#cancel-install').addEventListener('click', () => guard(async () => { await api.cancel(); $('#cancel-install').disabled = true; $('#download-title').textContent = 'Cancelling…'; }));
$('#clear-log').addEventListener('click', () => $('#log').textContent = 'Activity view cleared. Game logs remain in the launcher folder.\n');
for (const selector of ['#close-dialog', '#cancel-dialog']) $(selector).addEventListener('click', () => $('#profile-dialog').close());
$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#save-profile').disabled = true; $('#profile-error').textContent = '';
  try { state = await api.saveProfile({ id: $('#profile-id').value || undefined, name: $('#profile-name').value, version: $('#profile-version').value, memory: Number($('#profile-memory').value), javaPath: $('#profile-java').value }); $('#profile-dialog').close(); render(); toast('Profile saved.'); }
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
api.on('progress', p => { $('#download-title').textContent = p.message; $('#download-count').textContent = `${p.done.toLocaleString()} / ${p.total.toLocaleString()} files checked`; $('#download-progress').max = p.total; $('#download-progress').value = p.done; });
api.on('log', log);
api.on('game-start', () => { running = true; render(); });
api.on('game-exit', ({ code }) => { running = false; render(); log(`Minecraft exited (code ${code}).`); if (code !== 0) toast('Minecraft closed unexpectedly. Open Activity for the game log.', true); });
api.on('accounts-changed', value => { accountState = value; if (!value.pending) $('#login-dialog').close(); render(); });
api.on('auth-error', message => { $('#login-dialog').close(); toast(message, true); });
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
$('#copy-code').addEventListener('click', () => guard(async () => { await navigator.clipboard.writeText($('#login-code').textContent); toast('Sign-in code copied.'); }));
$('#cancel-login').addEventListener('click', () => guard(async () => { await api.cancelLogin(); $('#login-status').textContent = 'Cancelling…'; }));
$('#login-dialog').addEventListener('cancel', event => { event.preventDefault(); guard(() => api.cancelLogin()); });

async function boot() {
  if (!api) { $('#connection-label').textContent = 'Open this app with Electron'; return; }
  state = await api.state(); busy = state.busy; running = state.running; render();
  try { accountState = await api.accounts(); render(); } catch (error) { toast(error.message, true); }
  $('#stat-java').textContent = 'Managed'; $('#java-caption').textContent = 'Java 25 included · automatic selection';
  await guard(() => loadCatalog());
}
guard(boot);
