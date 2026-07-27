// BurnLink license key handling.
//
// Format: BURNLINK-<TIER>-XXXX-XXXX-CCCC
//   TIER  = STD | DEV
//   XXXX  = two random uppercase groups (4 chars each)
//   CCCC  = 4-char checksum of (TIER + first two X groups), first 4 hex
//
// Examples:
//   BURNLINK-STD-7QKF-AM2V-8E4C
//   BURNLINK-DEV-3X9P-LW7R-B1D2
//
// Validation is offline — no network roundtrip needed to catch a typo.

const crypto = require("crypto");

const TIERS = Object.freeze({
  STANDARD: "STD",
  DEV: "DEV",
});

const PREFIX = "BURNLINK";
const GROUP_RE = /^[A-Z0-9]{4}$/;

function _normalize(k) {
  return String(k || "").trim().toUpperCase();
}

function _groupChecksum(tier, group1, group2) {
  const h = crypto
    .createHash("sha256")
    .update(`${tier}:${group1}-${group2}`)
    .digest();
  // Use uppercase hex for legibility, take first 4 chars.
  return h.toString("hex").toUpperCase().slice(0, 4);
}

function _rand4() {
  const alphabet = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  const buf = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) {
    out += alphabet[buf[i] % alphabet.length];
  }
  return out;
}

function generateKey(tier) {
  const t = tier === TIERS.DEV ? TIERS.DEV : TIERS.STANDARD;
  const g1 = _rand4();
  const g2 = _rand4();
  const cc = _groupChecksum(t, g1, g2);
  return `${PREFIX}-${t}-${g1}-${g2}-${cc}`;
}

// Aliases: tests + the CLI bin expect validateKey / canUseCustomBackend
// to accept either a string or a parsed object.
function validateKey(keyOrParsed) {
  if (keyOrParsed && typeof keyOrParsed === "object" && "ok" in keyOrParsed) {
    return keyOrParsed;
  }
  return parse(keyOrParsed);
}

function _asParsed(keyOrParsed) {
  return validateKey(keyOrParsed);
}

// Parse + validate. Returns { ok, tier, group1, group2, checksum } or
// { ok:false, reason }. Pure function, offline.
function parse(key) {
  const norm = _normalize(key);
  const m = norm.match(
    /^BURNLINK-(STD|DEV)-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/
  );
  if (!m) return { ok: false, reason: "format-invalid" };
  const [, tier, g1, g2, cc] = m;
  if (!GROUP_RE.test(g1) || !GROUP_RE.test(g2) || !GROUP_RE.test(cc)) {
    return { ok: false, reason: "group-invalid-chars" };
  }
  const expected = _groupChecksum(tier, g1, g2);
  if (cc !== expected) return { ok: false, reason: "checksum-mismatch" };
  return { ok: true, tier, group1: g1, group2: g2, checksum: cc };
}

function isStandard(parsed) {
  return parsed && parsed.ok && parsed.tier === TIERS.STANDARD;
}

function isDev(parsed) {
  return parsed && parsed.ok && parsed.tier === TIERS.DEV;
}

// canUseCustomBackend: returns true iff the active license tier allows
// the user to point the CLI at their own backend. Accepts a raw key
// string or a parsed object.
function canUseCustomBackend(keyOrParsed) {
  const parsed = _asParsed(keyOrParsed);
  return isDev(parsed);
}

// Optional remote revocation/expiry check. Stubbed — kept as a hook so
// future ops can wire a license server without touching the CLI.
async function verifyRemote(_parsed, _opts) {
  // No-op until a license server exists. Returning true means "trust the
  // offline check". Replace with an HTTP call when ready.
  return { ok: true, reason: "offline-only" };
}

module.exports = {
  TIERS,
  PREFIX,
  parse,
  validateKey,
  generateKey,
  isStandard,
  isDev,
  canUseCustomBackend,
  verifyRemote,
};
