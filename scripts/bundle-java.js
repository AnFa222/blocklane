const path = require('node:path');
const io = require('../src/core');
const { ensureRuntime } = require('../src/runtime');
let last = 0;
ensureRuntime({ javaVersion: { majorVersion: 25, component: 'java-runtime-epsilon' } }, path.resolve(__dirname, '..', 'runtimes'), null, io, undefined,
  (message, done, total) => { if (Date.now() - last > 3000 || done === total) { console.log(`${message}: ${done}/${total}`); last = Date.now(); } })
  .then(executable => console.log(`Bundled and verified: ${executable}`))
  .catch(error => { console.error(error); process.exitCode = 1; });
