const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const api = window.launcher;
let state = { profiles: [], installed: [], selectedProfile: null };
let catalog = { versions: [], latest: {} };
let filter = 'release', limit = 40, busy = false, running = false, toastTimer;
let accountState = { selected: 'demo', configured: false, accounts: [{ id: 'demo', name: 'Demo player', type: 'demo' }] };
let loginStarting = false;
let loaderRequest = 0, loaderLoading = false;
let modState = null, modSearchState = { query: '', offset: 0, total: 0, hits: [] }, modUpdates = [], modRequest = 0;
let shaderState = null, shaderSearchState = { query: '', offset: 0, total: 0, hits: [] }, shaderAdapter = null, libraryTab = 'mods';
let resourcepackState = null, resourcepackSearchState = { query: '', offset: 0, total: 0, hits: [] };
const loaderNames = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function button(text, className, action) { const node = el('button', className, text); node.addEventListener('click', () => guard(action)); return node; }
function toast(message, error = false) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 12000 : 4500); }
function log(message) { const box = $('#log'); box.textContent = (box.textContent + `\n[${new Date().toLocaleTimeString()}] ${message}`).slice(-80000); box.scrollTop = box.scrollHeight; }
async function guard(action) { try { return await action(); } catch (e) { toast(e.message, true); log(e.message); } }
function navigate(view) { $$('.view').forEach(n => n.classList.toggle('active', n.id === `view-${view}`)); $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view)); $('#page-title').textContent = view[0].toUpperCase() + view.slice(1); if (view === 'mods') guard(loadModsView); if (view === 'backups') guard(loadBackups); if (view === 'screenshots') guard(loadScreenshots); if (view === 'servers') guard(loadServers); }
function installed(id) { return state.installed.find(v => v.id === id); }
function currentProfile() { return state.profiles.find(p => p.id === state.selectedProfile); }
function profileInstalled(p) { return p && installed(p.version) && ((p.loader || 'vanilla') === 'vanilla' || state.installed.some(v => v.baseVersion === p.version && v.loader === p.loader && v.loaderVersion === p.loaderVersion)); }
function profileLabel(p) { return `${loaderNames[p.loader || 'vanilla']} ${p.version}${p.loaderVersion ? ' · ' + p.loaderVersion : ''}`; }
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
  $('#nav-mods').textContent = modState?.installed?.length || 0;
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
function profileJvmArguments(memory) { const max = Math.max(1, Number(memory) || 4), initial = Math.min(2, Math.max(1, Math.ceil(max / 2))); return [`-Xms${initial}G`, `-Xmx${max}G`, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=50']; }
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
  const shaders = libraryTab === 'shaders', packs = libraryTab === 'resourcepacks', current = shaders ? shaderState : packs ? resourcepackState : modState, search = shaders ? shaderSearchState : packs ? resourcepackSearchState : modSearchState;
  $('#shader-tab').hidden = !shaderAdapter; $('#shader-tab').textContent = shaderAdapter ? `Shaders · ${shaderAdapter.label}` : 'Shaders';
  $$('.mod-tabs button').forEach(tab => tab.classList.toggle('active', tab.dataset.libraryTab === libraryTab));
  $('#mod-search').placeholder = shaders ? `Search ${shaderAdapter.label}-compatible shader packs…` : packs ? 'Search compatible resource packs…' : 'Search compatible mods…';
  $('#library-installed-title').textContent = shaders ? 'Installed shader packs' : packs ? 'Installed resource packs' : 'Installed'; $('#library-discover-title').textContent = shaders ? 'Discover shader packs' : packs ? 'Discover resource packs' : 'Discover';
  $('#check-mod-updates').hidden = shaders || packs; $('#mod-update-banner').hidden = shaders || packs || !modUpdates.length; $('#open-mods-folder').textContent = shaders ? 'Shaderpacks folder' : packs ? 'Resourcepacks folder' : 'Mods folder';
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
    const card = el('article', 'mod-card result'), copy = el('div', 'mod-card-copy');
    copy.append(el('strong', '', hit.title), el('small', '', `by ${hit.author} · ${compactDownloads(hit.downloads)} downloads`), el('p', '', hit.description));
    const add = button(installedIds.has(hit.projectId) ? 'Reinstall' : 'Install', 'primary small', async () => { await runModTask(() => shaders ? api.installShader(selectedModProfile().id, hit.projectId) : packs ? api.installResourcepack(selectedModProfile().id, hit.projectId) : api.installMod(selectedModProfile().id, hit.projectId)); });
    card.append(modIcon(hit.iconUrl, hit.title), copy, add); card.addEventListener('click', event => { if (!event.target.closest('button')) showModDetails(hit.projectId); }); results.append(card);
  }
  $('#mod-result-count').textContent = search.query ? `${search.total.toLocaleString()} compatible results` : 'Search Modrinth';
  $('#more-mods').hidden = search.hits.length >= search.total;
  $('#mod-update-copy').textContent = modUpdates.length ? `${modUpdates.length} update${modUpdates.length === 1 ? '' : 's'} available: ${modUpdates.map(u => u.title).join(', ')}` : '';
}

function renderModDetails(details) { const content = $('#mod-details-content'); content.replaceChildren(); const meta = el('div', 'mod-details-meta'); meta.append(modIcon(details.iconUrl, details.title), el('div', '', `${details.projectType} · ${compactDownloads(details.downloads)} downloads · ${compactDownloads(details.followers)} followers`)); content.append(meta, el('p', 'mod-details-description', details.description || 'No description provided.')); const groups = [['Supported Minecraft', details.gameVersions], ['Loaders', details.loaders], ['Categories', details.categories]]; for (const [label, values] of groups) if (values?.length) { const row = el('div', 'mod-detail-row'); row.append(el('strong', '', label), el('span', '', values.join(' · '))); content.append(row); } if (details.license?.name) content.append(el('div', 'mod-detail-row', `License · ${details.license.name}`)); if (details.body) { content.append(el('strong', 'mod-details-body-heading', 'About this mod')); const body = el('div', 'mod-details-body'); body.innerHTML = markdownToHtml(details.body); body.addEventListener('click', event => { const link = event.target.closest('[data-external-link]'); if (link) { event.preventDefault(); guard(() => api.openModrinth(link.dataset.externalLink)); } }); content.append(body); } const links = el('div', 'mod-detail-links'); for (const [label, url] of [['Issues', details.issuesUrl], ['Source', details.sourceUrl], ['Wiki', details.wikiUrl], ['Discord', details.discordUrl]]) if (url) links.append(button(label, 'quiet small', () => guard(() => api.openModrinth(url)))); if (links.children.length) { content.append(el('strong', '', 'Project links'), links); } }
async function showModDetails(projectId) { const p = selectedModProfile(); if (!p) return; const shaders = libraryTab === 'shaders', packs = libraryTab === 'resourcepacks', dialog = $('#mod-details-dialog'); $('#mod-details-title').textContent = 'Loading…'; $('#mod-details-content').replaceChildren(el('p', 'field-note', 'Loading project details…')); $('#install-from-details').disabled = true; dialog.showModal(); try { const details = await api.modDetails(p.id, projectId); $('#mod-details-title').textContent = details.title; renderModDetails(details); const installed = new Set(((shaders ? shaderState : packs ? resourcepackState : modState)?.installed || []).map(mod => mod.projectId)); const type = shaders ? 'shader pack' : packs ? 'resource pack' : 'mod', install = $('#install-from-details'); install.disabled = false; install.textContent = installed.has(projectId) ? `Reinstall ${type}` : `Install ${type}`; install.onclick = async () => { await runModTask(() => shaders ? api.installShader(p.id, projectId) : packs ? api.installResourcepack(p.id, projectId) : api.installMod(p.id, projectId)); dialog.close(); }; $('#open-modrinth').onclick = () => guard(() => api.openModrinth(details.projectUrl)); } catch (error) { $('#mod-details-content').replaceChildren(el('p', 'field-note', error.message)); } }
function emptyMods(title, copy) { const node = el('div', 'empty compact'); node.append(el('h3', '', title), el('p', '', copy)); return node; }
function confirmModRemoval(card, mod, shaders = false, packs = false) {
  const type = shaders ? 'shader pack' : packs ? 'resource pack' : 'mod'; const actions = card.querySelector('.mod-actions'); actions.replaceChildren(el('small', '', `Remove this ${type}?`), button('Keep', 'quiet small', renderMods), button('Remove', 'primary small', async () => { await runModTask(() => shaders ? api.removeShader(selectedModProfile().id, mod.projectId) : packs ? api.removeResourcepack(selectedModProfile().id, mod.projectId) : api.removeMod(selectedModProfile().id, mod.projectId)); }));
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
async function runModTask(action) {
  busy = true; render(); $('#download-panel').hidden = false; $('#cancel-install').disabled = false;
  try { const result = await action(); if (libraryTab === 'shaders') shaderState = result; else if (libraryTab === 'resourcepacks') resourcepackState = result; else modState = result; modUpdates = []; }
  finally { busy = false; $('#download-panel').hidden = true; state = await api.state(); render(); await loadModsView(); }
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
  const rows = [...catalog.versions.filter(v => (filter === 'installed' ? installed(v.id) : v.type === filter)), ...modded].filter(v => `${v.id} ${v.loader || ''} ${v.loaderVersion || ''}`.toLowerCase().includes(search));
  const list = $('#version-list'); list.replaceChildren();
  if (!rows.length) { const empty = el('div', 'empty'); empty.append(el('h3', '', catalog.versions.length ? 'No versions here yet.' : 'Catalog unavailable'), el('p', '', catalog.versions.length ? 'Try another filter, or install your first version.' : 'Connect to the internet and refresh to load Minecraft versions.')); list.append(empty); }
  for (const v of rows.slice(0, limit)) {
    const item = installed(v.id), row = el('div', 'version-row');
    const name = el('div', 'version-name'), label = el('div');
    label.append(el('strong', '', v.type === 'modded' ? `${loaderNames[v.loader]} ${v.baseVersion} · ${v.loaderVersion}` : v.id), el('small', '', v.id === catalog.latest.release ? 'LATEST RELEASE' : v.id === catalog.latest.snapshot ? 'LATEST SNAPSHOT' : v.type.toUpperCase())); name.append(el('span', 'cube', '◇'), label);
    row.append(name, el('span', 'version-date', new Date(v.releaseTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })), el('span', `badge${item ? ' ready' : ''}`, item ? '● Installed' : supported(v) ? 'Available' : 'Legacy · later'));
    const actions = el('div', 'row-actions');
    if (item) {
      if (v.type !== 'modded') actions.append(button('Repair', 'quiet', () => install(v.id)));
      actions.append(button('Use', 'primary', () => {
        if (v.type === 'modded') openProfile({ name: `${loaderNames[v.loader]} ${v.baseVersion}`, version: v.baseVersion, loader: v.loader, loaderVersion: v.loaderVersion });
        else openProfile(null, v.id);
      }));
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
    top.append(el('span', 'stat-icon', '▤'), el('small', '', selected ? 'ACTIVE PROFILE' : loaderNames[p.loader || 'vanilla'].toUpperCase()));
    card.append(top, el('h3', '', p.name), el('p', '', `${profileLabel(p)} · ${p.memory} GB RAM`), el('small', '', profileInstalled(p) ? '● Profile installed' : 'Profile needs installation'));
    const actions = el('div', 'profile-card-actions');
    actions.append(button(selected ? 'Selected' : 'Select profile', selected ? 'quiet' : 'primary', async () => { state = await api.selectProfile(p.id); render(); }), button('Edit', 'quiet', () => openProfile(p)), button('Clone', 'quiet', async () => { state = await api.cloneProfile(p.id, `${p.name} copy`); render(); toast('Profile cloned with its worlds and settings.'); }), button('Delete profile', 'quiet', () => confirmDeleteProfile(p)));
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

function profilePicker(id) { const select = $(id), prior = select.value; select.replaceChildren(); for (const profile of state.profiles) { const option = el('option', '', profile.name); option.value = profile.id; select.append(option); } select.value = state.profiles.some(profile => profile.id === prior) ? prior : state.selectedProfile || state.profiles[0]?.id || ''; return select.value; }
async function loadBackups() { const id = profilePicker('#backups-profile'), list = $('#backups-list'); list.replaceChildren(); if (!id) return list.append(emptyMods('No profiles yet', 'Create a profile before backing up worlds.')); const backups = await api.listBackups(id); if (!backups.length) list.append(emptyMods('No backups yet', 'Create a snapshot before changing a world or modpack.')); for (const backup of backups) { const card = el('article', 'profile-card'), actions = el('div', 'profile-card-actions'); card.append(el('small', '', 'WORLD SNAPSHOT'), el('h3', '', backup.name), el('p', '', new Date(backup.createdAt).toLocaleString()), el('small', '', backup.worlds.length ? backup.worlds.join(' · ') : 'No worlds found')); actions.append(button('Restore backup', 'primary', () => openRestoreDialog(id, backup))); card.append(actions); list.append(card); } }
let pendingRestore = null;
function openRestoreDialog(profileId, backup) { pendingRestore = { profileId, backup }; $('#restore-title').textContent = backup.name; $('#restore-error').textContent = ''; const worlds = $('#restore-worlds'); worlds.replaceChildren(); for (const world of backup.worlds) { const label = el('label', 'restore-world'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = world; input.checked = true; label.append(input, document.createTextNode(world)); worlds.append(label); } $('#restore-dialog').showModal(); }
async function loadScreenshots() { const id = profilePicker('#screenshots-profile'), grid = $('#screenshots-grid'); grid.replaceChildren(); if (!id) return grid.append(emptyMods('No profiles yet', 'Create a profile to keep screenshots separate.')); const shots = await api.listScreenshots(id); if (!shots.length) return grid.append(emptyMods('No screenshots yet', 'Minecraft screenshots will appear here.')); for (const shot of shots) { const card = el('article', 'screenshot-card'); if (shot.dataUrl) { const image = document.createElement('img'); image.src = shot.dataUrl; image.alt = shot.name; card.append(image); } card.append(el('strong', '', shot.name), el('small', '', shot.skipped ? 'Preview skipped: file is large' : `${Math.ceil(shot.size / 1024)} KB`)); grid.append(card); } }
async function loadServers() { const id = profilePicker('#servers-profile'), list = $('#servers-list'); list.replaceChildren(); if (!id) return list.append(emptyMods('No profiles yet', 'Create a profile before saving servers.')); const servers = await api.profileServers(id); if (!servers.length) list.append(emptyMods('No saved servers', 'Add an address to keep it with this profile.')); for (const server of servers) { const card = el('article', 'mod-card'), copy = el('div', 'mod-card-copy'), actions = el('div', 'mod-actions'); copy.append(el('strong', '', server.name), el('small', '', server.address)); actions.append(button('Play', 'primary small', async () => { busy = true; render(); try { await api.launchServer(id, server.address); toast(`Joining ${server.name}…`); } finally { busy = false; render(); } }), button('Remove', 'quiet small', async () => { await api.profileServers(id, servers.filter(item => item !== server)); loadServers(); })); card.append(copy, actions); list.append(card); } }

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
  $('#dialog-title').textContent = profile?.id ? 'Edit profile' : 'New profile';
  $('#profile-name').value = profile?.name || (version ? `Vanilla ${version}` : 'My survival world');
  const select = $('#profile-version'); select.replaceChildren();
  for (const v of catalog.versions.filter(supported)) { const option = el('option', '', `${v.id}${v.type === 'snapshot' ? ' · snapshot' : ''}`); option.value = v.id; select.append(option); }
  select.value = profile?.version || version || catalog.latest.release;
  $('#profile-memory').value = String(profile?.memory || 4);
  $('#profile-java').value = !profile?.javaPath || ['java', 'java.exe', 'auto'].includes(profile.javaPath.toLowerCase()) ? 'auto' : profile.javaPath;
  $('#profile-java-args').value = (profile?.javaArgs || []).join('\n');
  $('#profile-game-args').value = (profile?.gameArgs || []).join('\n');
  $('#profile-jvm-args').textContent = profileJvmArguments(profile?.memory || 4).join('\n');
  $('#profile-error').textContent = '';
  $('#java-check-result').textContent = 'Automatic Java is included; matching older runtimes are installed when needed.';
  $('#profile-dialog').showModal();
  $('#profile-loader').value = profile?.loader || 'vanilla';
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
    $('#loader-note').textContent = versions.length ? `${loaderNames[loader]} builds for Minecraft ${minecraft}. Add compatible mods to this profile’s mods folder.${loader === 'fabric' ? ' Some mods also need Fabric API.' : ''}` : `No ${loaderNames[loader]} builds are available for Minecraft ${minecraft}. Choose another game version or loader.`;
  } catch (error) { if (request === loaderRequest) $('#loader-note').textContent = error.message; }
  finally { if (request === loaderRequest) { loaderLoading = false; $('#save-profile').disabled = !select.value; } }
}
$('#profile-loader').addEventListener('change', () => loadLoaderVersions());
$('#profile-version').addEventListener('change', () => loadLoaderVersions());
$('#profile-memory').addEventListener('change', () => { $('#profile-jvm-args').textContent = profileJvmArguments(Number($('#profile-memory').value)).join('\n'); });
$('#mods-profile').addEventListener('change', () => { modState = null; shaderState = null; resourcepackState = null; shaderAdapter = null; modSearchState = { query: '', offset: 0, total: 0, hits: [] }; shaderSearchState = { query: '', offset: 0, total: 0, hits: [] }; resourcepackSearchState = { query: '', offset: 0, total: 0, hits: [] }; guard(loadModsView); });
$$('[data-library-tab]').forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.libraryTab === 'shaders' && !shaderAdapter) return; libraryTab = tab.dataset.libraryTab; $('#mod-search').value = ''; guard(loadModsView); }));
$('#mod-search-form').addEventListener('submit', event => { event.preventDefault(); guard(() => searchMods(false)); });
$('#more-mods').addEventListener('click', () => guard(() => searchMods(true)));
$('#close-mod-details').addEventListener('click', () => $('#mod-details-dialog').close());
$('#mod-details-dialog').addEventListener('cancel', event => { event.preventDefault(); event.currentTarget.close(); });
$('#mod-details-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$('#open-mods-folder').addEventListener('click', () => guard(() => libraryTab === 'shaders' ? api.openShaders(selectedModProfile().id) : libraryTab === 'resourcepacks' ? api.openResourcepacks(selectedModProfile().id) : api.openMods(selectedModProfile().id)));
$('#mods-create-profile').addEventListener('click', () => openProfile());
$('#check-mod-updates').addEventListener('click', () => guard(async () => { modUpdates = await api.modUpdates(selectedModProfile().id); renderMods(); if (!modUpdates.length) toast('All managed mods are up to date.'); }));
$('#update-all-mods').addEventListener('click', () => guard(() => runModTask(() => api.updateAllMods(selectedModProfile().id))));

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
$('#check-updates').addEventListener('click', () => guard(async () => { const result = await api.checkUpdates(); if (!result.available) return toast(`Blocklane ${result.current} is up to date.`); const button = $('#check-updates'); button.textContent = `Download ${result.latest}`; button.className = 'primary small'; button.onclick = () => guard(() => api.openUpdate(result.installerUrl || result.releaseUrl)); toast(`Blocklane ${result.latest} is available.`); }));
$('#new-profile').addEventListener('click', () => openProfile());
$('#backups-profile').addEventListener('change', () => guard(loadBackups));
$('#screenshots-profile').addEventListener('change', () => guard(loadScreenshots));
$('#servers-profile').addEventListener('change', () => guard(loadServers));
$('#create-backup').addEventListener('click', () => { $('#backup-name').value = 'World backup'; $('#backup-error').textContent = ''; $('#backup-dialog').showModal(); $('#backup-name').focus(); });
for (const selector of ['#close-backup', '#cancel-backup']) $(selector).addEventListener('click', () => $('#backup-dialog').close());
$('#backup-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const name = $('#backup-name').value.trim(); if (!name) throw new Error('Enter a backup name.'); await api.backupProfile($('#backups-profile').value, name); $('#backup-dialog').close(); await loadBackups(); toast('World backup created.'); }).catch(error => { $('#backup-error').textContent = error.message; }); });
for (const selector of ['#close-restore', '#cancel-restore']) $(selector).addEventListener('click', () => $('#restore-dialog').close());
$('#restore-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const worlds = $$('#restore-worlds input:checked').map(input => input.value); await api.restoreBackup(pendingRestore.profileId, pendingRestore.backup.id, worlds); $('#restore-dialog').close(); await loadBackups(); toast('Selected worlds restored.'); }); });
$('#delete-backup').addEventListener('click', () => guard(async () => { if (!pendingRestore) return; await api.deleteBackup(pendingRestore.profileId, pendingRestore.backup.id); $('#restore-dialog').close(); await loadBackups(); toast('Backup deleted.'); }));
$('#open-backups-folder').addEventListener('click', () => guard(() => api.openBackups($('#backups-profile').value)));
$('#open-screenshots-folder').addEventListener('click', () => guard(() => api.openScreenshots($('#screenshots-profile').value)));
$('#add-server').addEventListener('click', () => { $('#server-name').value = ''; $('#server-address').value = ''; $('#server-error').textContent = ''; $('#server-dialog').showModal(); $('#server-name').focus(); });
for (const selector of ['#close-server', '#cancel-server']) $(selector).addEventListener('click', () => $('#server-dialog').close());
$('#server-form').addEventListener('submit', event => { event.preventDefault(); guard(async () => { const name = $('#server-name').value.trim(), address = $('#server-address').value.trim(); if (!name || !address) throw new Error('Enter a server name and address.'); const id = $('#servers-profile').value, servers = await api.profileServers(id); await api.profileServers(id, [...servers, { name, address }]); $('#server-dialog').close(); await loadServers(); toast('Server saved.'); }).catch(error => { $('#server-error').textContent = error.message; }); });
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
$('#clear-log').addEventListener('click', () => $('#log').textContent = 'Activity view cleared. Game logs remain in the launcher folder.\n');
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
$('#add-local-account').addEventListener('click', () => { $('#local-name').value = ''; $('#local-error').textContent = ''; $('#local-dialog').showModal(); $('#local-name').focus(); });
$('#close-local').addEventListener('click', () => $('#local-dialog').close());
$('#cancel-local').addEventListener('click', () => $('#local-dialog').close());
$('#local-form').addEventListener('submit', event => guard(async () => { event.preventDefault(); try { accountState = await api.createLocalAccount($('#local-name').value); $('#local-dialog').close(); render(); toast('Local profile created.'); } catch (error) { $('#local-error').textContent = error.message; } }));
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







