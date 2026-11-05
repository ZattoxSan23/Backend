'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPeruTimestamp, getPeruDateStr } = require('../server/lib/peru-time');

test('evening in Peru remains on the previous UTC calendar day', () => {
  assert.equal(getPeruDateStr('2026-11-06T02:00:00Z'), '2026-11-05');
});
test('local midnight changes date at 05:00 UTC', () => {
  assert.equal(getPeruDateStr('2026-11-06T04:59:59Z'), '2026-11-05');
  assert.equal(getPeruDateStr('2026-11-06T05:00:00Z'), '2026-11-06');
});
test('offset timestamp preserves the instant and handles year rollover', () => {
  const input = '2027-01-01T02:00:00Z';
  const result = getPeruTimestamp(input);
  assert.equal(result, '2026-12-31T21:00:00.000-05:00');
  assert.equal(Date.parse(result), Date.parse(input));
});
test('does not mutate Date instances and rejects invalid timestamps', () => {
  const date = new Date('2026-06-01T12:00:00Z');
  getPeruTimestamp(date);
  assert.equal(date.toISOString(), '2026-06-01T12:00:00.000Z');
  assert.throws(() => getPeruTimestamp('invalid'), RangeError);
});
