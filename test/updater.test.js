const test = require('node:test');
const assert = require('node:assert/strict');
const { newer, versionParts } = require('../src/updater');

test('parses release versions with optional v prefix', () => {
  assert.deepEqual(versionParts('v0.4.4'), [0, 4, 4]);
  assert.deepEqual(versionParts('not-a-version'), [0, 0, 0]);
});

test('detects newer releases', () => {
  assert.equal(newer('0.4.4', '0.4.3'), true);
  assert.equal(newer('0.5.0', '0.4.9'), true);
  assert.equal(newer('0.4.3', '0.4.3'), false);
  assert.equal(newer('0.4.2', '0.4.3'), false);
});
