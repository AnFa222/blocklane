const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gameJavaExecutable, gameEnvironment, jvmMemoryArgs, withoutHeapArgs, liveLogBatch } = require('../src/launch-policy');

test('Windows game launches use the matching javaw without changing custom or non-Windows executables', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blocklane javaw '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const java = path.join(dir, 'java.exe'), javaw = path.join(dir, 'javaw.exe');
  assert.equal(await gameJavaExecutable(java, 'win32'), java);
  await fs.writeFile(javaw, 'fixture');
  assert.equal(await gameJavaExecutable(java, 'win32'), javaw);
  assert.equal(await gameJavaExecutable(java, 'linux'), java);
  const custom = path.join(dir, 'custom-java.exe');
  assert.equal(await gameJavaExecutable(custom, 'win32'), custom);
  assert.equal(await gameJavaExecutable(javaw, 'win32'), javaw);
});

test('heap sizing is stable and metadata cannot override the selected profile memory', () => {
  assert.deepEqual(jvmMemoryArgs(12).slice(0, 2), ['-Xms2G', '-Xmx12G']);
  assert.ok(jvmMemoryArgs(4, 25).includes('-XX:+UseZGC'));
  assert.ok(jvmMemoryArgs(4, 25).includes('-XX:+UseCompactObjectHeaders'));
  assert.ok(jvmMemoryArgs(4, 21).includes('-XX:+UseG1GC'));
  assert.deepEqual(jvmMemoryArgs(4, 25, ['-XX:+UseG1GC']), ['-Xms2G', '-Xmx4G']);
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
