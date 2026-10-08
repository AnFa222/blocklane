const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const exec = promisify(execFile);

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;

  const projectDir = path.resolve(__dirname, '..');
  const version = require(path.join(projectDir, 'package.json')).version;
  const rcedit = path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const executable = path.join(context.appOutDir, 'Blocklane.exe');
  const icon = path.join(projectDir, 'assets', 'icon.ico');

  await exec(rcedit, [
    executable,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', 'Blocklane',
    '--set-version-string', 'FileDescription', 'Blocklane Minecraft Launcher',
    '--set-file-version', version,
    '--set-product-version', version
  ]);
};
