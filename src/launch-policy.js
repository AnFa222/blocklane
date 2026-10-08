// Instance settings and Mojang metadata define the JVM configuration.
// Preserve normal environment variables, but prevent hidden global JVM flags.
function gameEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !['_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(name.toUpperCase())));
}

// Keep heap sizing deterministic across vanilla and loader-generated metadata.
// Modern clients use ZGC so chunk generation does not cause visible stop-the-world
// pauses. A fixed heap also removes periodic heap-growth stalls while moving.
function jvmMemoryArgs(memory, javaMajor = 21, customArgs = []) {
  const max = Math.max(1, Number(memory) || 4);
  const args = [`-Xms${max}G`, `-Xmx${max}G`];
  if (customArgs.some(arg => /^-XX:[+-]Use[A-Za-z0-9]+GC$/.test(arg))) return args;
  if (javaMajor >= 17) return [...args, '-XX:+UseZGC', '-XX:+DisableExplicitGC'];
  return [...args, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=50'];
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
module.exports = { gameEnvironment, jvmMemoryArgs, withoutHeapArgs, liveLogBatch };
