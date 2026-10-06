// Instance settings and Mojang metadata define the JVM configuration.
// Preserve normal environment variables, but prevent hidden global JVM flags.
function gameEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !['_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(name.toUpperCase())));
}

// Keep heap sizing deterministic across vanilla and loader-generated metadata.
// A small initial heap causes periodic growth pauses while the client is loading
// chunks and textures. Start at half the selected maximum, capped at 2 GiB.
function jvmMemoryArgs(memory) {
  const max = Math.max(1, Number(memory) || 4);
  const initial = Math.min(2, Math.max(1, Math.ceil(max / 2)));
  return [`-Xms${initial}G`, `-Xmx${max}G`, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=50'];
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
