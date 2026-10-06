// Input checks shared by the socket handlers. Everything a client sends is
// untrusted: these helpers decide what is accepted and how it is normalised.

const COORD_LIMIT = 1e6;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// A usable {x, y} point: finite numbers inside the coordinate limit.
function isPoint(value) {
  return Boolean(value)
    && finite(value.x) && finite(value.y)
    && Math.abs(value.x) < COORD_LIMIT && Math.abs(value.y) < COORD_LIMIT;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// Control characters, zero-width marks and bidi overrides could garble other
// players' screens, so they are removed before any text is shown to anyone.
const INVISIBLE = new RegExp('[' + [
  '\\u0000-\\u001f', '\\u007f', '\\u200b-\\u200f', '\\u202a-\\u202e', '\\u2066-\\u2069',
].join('') + ']', 'g');

function tidyText(raw, maxLength) {
  return String(raw ?? '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// Names that would let a player pass for staff in chat.
function isReservedName(name) {
  return /^\s*(\[?admin\]?|server)\s*$/i.test(name);
}

// A key that really belongs to `table` (never one inherited from a prototype).
function ownKey(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key);
}

module.exports = { finite, isPoint, clamp, tidyText, isReservedName, ownKey };
