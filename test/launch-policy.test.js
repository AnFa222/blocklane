const test = require('node:test');
const assert = require('node:assert/strict');
const { gameEnvironment, jvmMemoryArgs, withoutHeapArgs, liveLogBatch } = require('../src/launch-policy');

test('heap sizing is stable and metadata cannot override the selected profile memory', () => {
  assert.deepEqual(jvmMemoryArgs(12).slice(0, 2), ['-Xms12G', '-Xmx12G']);
  assert.ok(jvmMemoryArgs(4, 25).includes('-XX:+UseZGC'));
  assert.ok(jvmMemoryArgs(4, 8).includes('-XX:+UseG1GC'));
  assert.deepEqual(jvmMemoryArgs(4, 25, ['-XX:+UseG1GC']), ['-Xms4G', '-Xmx4G']);
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
