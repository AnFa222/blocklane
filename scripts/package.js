const fs = require('node:fs/promises');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const target = path.join(project, 'dist', `Blocklane-${version}-win32-x64`);

async function main() {
  const config = { ...require('../src/app-config.json') };
  config.microsoftClientId = process.env.BLOCKLANE_MICROSOFT_CLIENT_ID || config.microsoftClientId;
  if (config.microsoftClientId) require('../src/auth').clientId(config.microsoftClientId);
  if (process.argv.includes('--release') && !config.microsoftClientId) throw new Error('Release blocked: configure Blocklane’s Microsoft client ID at build time. Players must never configure it.');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this portable release on Windows x64.');
  await fs.access(path.join(project, 'node_modules/electron/dist/electron.exe'));
  await fs.access(path.join(project, 'runtimes/java-runtime-epsilon/installed.json'));
  await fs.mkdir(target, { recursive: true });
  await fs.cp(path.join(project, 'node_modules/electron/dist'), target, { recursive: true });
  await fs.rename(path.join(target, 'electron.exe'), path.join(target, 'Blocklane.exe'));
  const app = path.join(target, 'resources/app');
  await fs.mkdir(app, { recursive: true });
  await fs.cp(path.join(project, 'src'), path.join(app, 'src'), { recursive: true });
  await fs.writeFile(path.join(app, 'src/app-config.json'), JSON.stringify(config, null, 2));
  await fs.cp(path.join(project, 'runtimes'), path.join(app, 'runtimes'), { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  delete manifest.devDependencies; delete manifest.scripts;
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify(manifest, null, 2));
  const seen = new Set();
  async function copyDependency(name, from) {
    const manifestPath = require.resolve(`${name}/package.json`, { paths: [from] });
    const packageRoot = path.dirname(manifestPath);
    if (seen.has(packageRoot)) return;
    seen.add(packageRoot);
    await fs.cp(packageRoot, path.join(app, 'node_modules', name), { recursive: true });
    const metadata = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const dep of Object.keys(metadata.dependencies || {})) await copyDependency(dep, packageRoot);
  }
  for (const dep of Object.keys(manifest.dependencies)) await copyDependency(dep, project);
  await fs.copyFile(path.join(project, 'README.md'), path.join(target, 'README.md'));
  await fs.copyFile(path.join(project, 'VALIDATION.md'), path.join(target, 'VALIDATION.md'));
  await fs.copyFile(path.join(project, 'MICROSOFT-SETUP.md'), path.join(target, 'MICROSOFT-SETUP.md'));
  await fs.copyFile(path.join(project, 'LAUNCH-POLICY.md'), path.join(target, 'LAUNCH-POLICY.md'));
  await fs.copyFile(path.join(project, 'LOADERS.md'), path.join(target, 'LOADERS.md'));
  await fs.copyFile(path.join(project, 'MODS.md'), path.join(target, 'MODS.md'));
  console.log(`Portable Windows launcher: ${target}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

