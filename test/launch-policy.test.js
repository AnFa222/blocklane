const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gameJavaExecutable, gameEnvironment, jvmMemoryArgs, withoutHeapArgs, liveLogBatch } = require('../src/launch-policy');

test('Windows game launches use javaw from the selected runtime', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane-javaw-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const java = path.join(dir, 'java.exe');
  const javaw = path.join(dir, 'javaw.exe');
  assert.equal(await gameJavaExecutable(java, 'win32'), java);
  await fs.writeFile(javaw, 'fixture');
  assert.equal(await gameJavaExecutable(java, 'win32'), javaw);
  assert.equal(await gameJavaExecutable(java, 'linux'), java);
});

test('heap sizing is stable and metadata cannot override the selected profile memory', () => {
  assert.deepEqual(jvmMemoryArgs(12).slice(0, 2), ['-Xms2G', '-Xmx12G']);
  assert.deepEqual(jvmMemoryArgs(8), ['-Xms2G', '-Xmx8G', '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:MaxGCPauseMillis=50']);
  assert.deepEqual(jvmMemoryArgs(8, 25), ['-Xms2G', '-Xmx8G', '-XX:+UseCompactObjectHeaders', '-XX:+AlwaysPreTouch', '-XX:+UseStringDeduplication', '-XX:+UseZGC']);
  assert.deepEqual(jvmMemoryArgs(1).slice(0, 2), ['-Xms1G', '-Xmx1G']);
  assert.deepEqual(jvmMemoryArgs(2).slice(0, 2), ['-Xms1G', '-Xmx2G']);
  assert.deepEqual(withoutHeapArgs(['-cp', 'x', '-Xmx1G', '-Xms256M']), ['-cp', 'x']);
});

test('global JVM injections cannot override a profile; normal environment is preserved', () => {
  const env = { Path: 'java-path', USERPROFILE: 'user', _JAVA_OPTIONS: '-Xmx1G', java_tool_options: '-javaagent:agent.jar', JDK_JAVA_OPTIONS: '-Xms8G' };
  assert.deepEqual(gameEnvironment(env), { Path: 'java-path', USERPROFILE: 'user' });
  assert.equal(env._JAVA_OPTIONS, '-Xmx1G');
});

test('a log flood produces one bounded live update, with the final tail flushed', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [], log = liveLogBatch(text => updates.push(text));
  for (let i = 0; i < 10000; i++) log.push('log message\n');
  assert.equal(updates.length, 0);
  t.mock.timers.tick(250);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].length, 16000);
  log.push('last line\n'); log.flush();
  assert.equal(updates[1], 'last line\n');
  t.mock.timers.tick(250);
  assert.equal(updates.length, 2);
});
