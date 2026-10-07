const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function clean(value, label, max) { const result = String(value || '').trim(); if (!result || result.length > max) throw new Error(`${label} must be 1–${max} characters.`); return result; }
function validate(input, existingId = null) {
  const loader = String(input?.loader || 'vanilla'); if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) throw new Error('Choose a supported mod loader.');
  const loaderVersion = loader === 'vanilla' ? '' : clean(input?.loaderVersion, 'Loader version', 100);
  return { id: existingId || crypto.randomUUID(), name: clean(input?.name, 'Pack name', 100), versionId: clean(input?.versionId, 'Pack version', 50), summary: clean(input?.summary, 'Summary', 250), version: clean(input?.version, 'Minecraft version', 100), loader, loaderVersion, createdAt: input?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function root(base, id) { return path.join(base, 'custom-packs', id); }
async function list(base) {
  const entries = await fs.readdir(path.join(base, 'custom-packs'), { withFileTypes: true }).catch(() => []), result = [];
  for (const item of entries) { if (!item.isDirectory()) continue; try { const value = JSON.parse(await fs.readFile(path.join(root(base, item.name), 'pack.json'), 'utf8')); if (value.id === item.name) result.push(value); } catch {} }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
async function get(base, id) { const value = (await list(base)).find(pack => pack.id === id); if (!value) throw new Error('Custom pack does not exist.'); return value; }
async function save(base, input) { const existingId = typeof input?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ? input.id : null; const value = validate(input, existingId); const folder = root(base, value.id); await fs.mkdir(path.join(folder, 'instance'), { recursive: true }); await fs.writeFile(path.join(folder, 'pack.json'), JSON.stringify(value, null, 2)); return value; }
async function remove(base, id) { const value = await get(base, id); await fs.rm(root(base, value.id), { recursive: true, force: true }); return value; }

module.exports = { validate, root, list, get, save, remove };
