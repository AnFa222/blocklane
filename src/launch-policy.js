const fs = require('node:fs/promises');
const path = require('node:path');

async function gameJavaExecutable(executable, platform = process.platform) {
  if (platform !== 'win32' || path.basename(executable).toLowerCase() !== 'java.exe') return executable;
  const javaw = path.join(path.dirname(executable), 'javaw.exe');
  try {
    if ((await fs.stat(javaw)).isFile()) return javaw;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return executable;
}

// Instance settings and Mojang metadata define the JVM configuration.
// Preserve normal environment variables, but prevent hidden global JVM flags.
function gameEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !['_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(name.toUpperCase())));
}

// Keep heap sizing deterministic across vanilla and loader-generated metadata.
// Java 25 Minecraft releases use the same low-pause collector policy currently
// emitted by Mojang's launcher. Older runtimes retain the compatible G1 policy.
function jvmMemoryArgs(memory, javaMajor = 21) {
  const max = Math.max(1, Number(memory) || 4);
  const initial = Math.min(2, Math.max(1, Math.ceil(max / 2)));
  const heap = [`-Xms${initial}G`, `-Xmx${max}G`];
  if (javaMajor >= 25) return [...heap, '-XX:+UseCompactObjectHeaders', '-XX:+AlwaysPreTouch', '-XX:+UseStringDeduplication', '-XX:+UseZGC'];
  return [...heap, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=50'];
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
