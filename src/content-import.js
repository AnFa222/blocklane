const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');

const TYPES = { mod: { extension: '.jar', folder: 'mods' }, shader: { extension: '.zip', folder: 'shaderpacks' }, resourcepack: { extension: '.zip', folder: 'resourcepacks' } };
async function validArchive(file) { const stat = await fs.stat(file); if (!stat.isFile() || stat.size <= 0 || stat.size > 1024 * 1024 * 1024) throw new Error('Each imported file must be between 1 byte and 1 GB.'); const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true }).catch(() => { throw new Error(`${path.basename(file)} is not a valid archive.`); }); zip.close(); }
async function uniqueDestination(folder, filename) { const ext = path.extname(filename), stem = path.basename(filename, ext); let candidate = filename, number = 2; while (await fs.access(path.join(folder, candidate)).then(() => true).catch(() => false)) candidate = `${stem} (${number++})${ext}`; return path.join(folder, candidate); }
async function importFiles(instance, kind, files) {
  const type = TYPES[kind]; if (!type || !Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string')) throw new Error('Choose files to import.'); const destination = path.join(instance, type.folder); await fs.mkdir(destination, { recursive: true }); const imported = [];
  for (const source of files) { const filename = path.basename(source); if (path.extname(filename).toLowerCase() !== type.extension) throw new Error(`Only ${type.extension} files can be imported here.`); await validArchive(source); const target = await uniqueDestination(destination, filename); await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL); imported.push(path.basename(target)); }
  return imported;
}
module.exports = { TYPES, validArchive, uniqueDestination, importFiles };
