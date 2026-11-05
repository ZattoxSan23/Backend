'use strict';

const PERU_OFFSET_MS = -5 * 60 * 60 * 1000;

// Peru uses UTC-05:00 year-round. This never depends on the host timezone.
function getPeruTimestamp(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid timestamp');
  return new Date(date.getTime() + PERU_OFFSET_MS).toISOString().slice(0, -1) + '-05:00';
}

function getPeruDateStr(input = new Date()) {
  return getPeruTimestamp(input).split('T')[0];
}

module.exports = { getPeruTimestamp, getPeruDateStr };
