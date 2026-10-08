const fs = require('node:fs/promises');
const path = require('node:path');

// Use the Windows GUI entry point for the game; runtime inspection still uses java.exe.
async function gameJavaExecutable(executable, platform = process.platform) {
  if (platform !== 'win32' || path.basename(executable).toLowerCase() !== 'java.exe') return executable;
  const gui = path.join(path.dirname(executable), 'javaw.exe');
  try { if ((await fs.stat(gui)).isFile()) return gui; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return executable;
}

// Instance settings and Mojang metadata define the JVM configuration.
// Preserve normal environment variables, but prevent hidden global JVM flags.
function gameEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !['_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(name.toUpperCase())));
}

// Match the official launcher presets while substituting the profile's RAM cap.
function jvmMemoryArgs(memory, javaMajor = 21, customArgs = []) {
  const max = Math.max(1, Number(memory) || 4);
  const args = [`-Xms${Math.min(2, max)}G`, `-Xmx${max}G`];
  if (customArgs.some(arg => /^-XX:[+-]Use[A-Za-z0-9]+GC$/.test(arg))) return args;
  if (javaMajor >= 25) return [...args, '-XX:+UseCompactObjectHeaders', '-XX:+AlwaysPreTouch', '-XX:+UseStringDeduplication', '-XX:+UseZGC'];
  return [...args, '-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M'];
}

function withoutHeapArgs(args) {
  return args.filter(arg => !/^-Xm[ sx].+/i.test(arg));
}

// Disk logging stays lossless; only the live UI keeps a bounded recent tail.
function liveLogBatch(emit, delay = 250, limit = 16000) {
  let pending = '', timer;
  function flush() {
    clearTimeout(timer); timer = undefined;
    const text = pending; pending = '';
    if (text) emit(text);
  }
  return {
    push(data) {
      pending = (pending + data.toString()).slice(-limit);
      if (!timer) { timer = setTimeout(flush, delay); timer.unref?.(); }
    },
    flush
  };
}
module.exports = { gameJavaExecutable, gameEnvironment, jvmMemoryArgs, withoutHeapArgs, liveLogBatch };
