// BurnLink license key handling.
//
// Format: BURNLINK-<TIER>-XXXX-XXXX-CCCC.<SIG>
//   TIER  = STD | DEV
//   XXXX  = two random uppercase groups (4 chars each)
//   CCCC  = 4-char checksum of (TIER + first two X groups), first 4 hex
//   SIG   = base64url Ed25519 signature of the body before the dot,
//           using the BurnLink issuer private key.
//
// Examples:
//   BURNLINK-STD-7QKF-AM2V-8E4C.3xYpV7...
//   BURNLINK-DEV-3X9P-LW7R-B1D2.Qm9t...
//
// The signature is verified offline against the bundled public key — no
// network roundtrip needed to catch a typo or a forged key. STD and DEV
// keys are interchangeable in shape; tier governs behavior (e.g. DEV
// keys may point the CLI at a custom backend).
//
// The private signing key lives only at keys/issuer.key (gitignored).
// Anyone with that key can mint new licenses, so it must never leave
// the maintainer's machine.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TIERS = Object.freeze({
  STANDARD: "STD",
  DEV: "DEV",
});

const PREFIX = "BURNLINK";
const GROUP_RE = /^[A-Z0-9]{4}$/;

// Load the bundled issuer public key. The PEM string is embedded at
// build time by bin/embed-issuer-pub.js, so pkg-built binaries don't
// need to bundle any external file. We also try the on-disk path for
// dev / installed runs.
const EMBEDDED_PUB = require("./issuer-pub");
const ISSUER_PUB_PATH = path.join(__dirname, "..", "keys", "issuer.pub");
let _issuerPub = null;
function _loadPub() {
  if (_issuerPub) return _issuerPub;
  let pem;
  if (EMBEDDED_PUB && typeof EMBEDDED_PUB === "string") {
    pem = EMBEDDED_PUB;
  } else {
    try {
      pem = fs.readFileSync(ISSUER_PUB_PATH, "utf8");
    } catch (e) {
      throw new Error(
        `issuer.pub not found at ${ISSUER_PUB_PATH} and no embedded copy`
      );
    }
  }
  _issuerPub = crypto.createPublicKey(pem);
  return _issuerPub;
}

function _normalize(k) {
  return String(k || "").trim().toUpperCase();
}

function _groupChecksum(tier, group1, group2) {
  const h = crypto
    .createHash("sha256")
    .update(`${tier}:${group1}-${group2}`)
    .digest();
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

// Sign a license body (everything before the dot) with the issuer
// private key. Returns base64url. Caller decides where the private key
// lives; for the dev gen-key flow we read from keys/issuer.key.
function _sign(body, privateKeyPem) {
  const keyObj = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(body, "utf8"), keyObj);
  return sig.toString("base64url");
}

function _verify(body, sigB64, publicKeyPem) {
  try {
    const keyObj = publicKeyPem
      ? crypto.createPublicKey(publicKeyPem)
      : _loadPub();
    const sig = Buffer.from(sigB64, "base64url");
    const ok = crypto.verify(null, Buffer.from(body, "utf8"), keyObj, sig);
    if (!ok && process.env.BURNLINK_DEBUG) {
      console.error("[license] verify returned false", { body, sigB64 });
    }
    return ok;
  } catch (e) {
    if (process.env.BURNLINK_DEBUG) console.error("[license] verify threw:", e.message);
    return false;
  }
}

// Generate a signed license. Reads the private key from disk — this is
// the offline minting tool; production keys are issued by the admin
// script in bin/sign-key.js. Throws if the private key is missing.
function generateKey(tier, opts = {}) {
  const t = tier === TIERS.DEV ? TIERS.DEV : TIERS.STANDARD;
  const g1 = _rand4();
  const g2 = _rand4();
  const cc = _groupChecksum(t, g1, g2);
  const body = `${PREFIX}-${t}-${g1}-${g2}-${cc}`;
  const privPath =
    opts.privateKeyPath ||
    path.join(__dirname, "..", "keys", "issuer.key");
  const priv = fs.readFileSync(privPath, "utf8");
  const sig = _sign(body, priv);
  return `${body}.${sig}`;
}

// Parse + validate. Returns { ok, tier, group1, group2, checksum, sig }
// or { ok:false, reason }. Pure function, offline.
function parse(key, opts = {}) {
  const raw = String(key || "").trim();
  // Split body and signature on the last dot — the signature may
  // contain '.' only as padding-equivalent '_' / '-' characters, so
  // lastIndexOf is safe here.
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return { ok: false, reason: "format-invalid" };
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const m = body.match(
    /^BURNLINK-(STD|DEV)-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/
  );
  if (!m) return { ok: false, reason: "format-invalid" };
  const [, tier, g1, g2, cc] = m;
  if (!GROUP_RE.test(g1) || !GROUP_RE.test(g2) || !GROUP_RE.test(cc)) {
    return { ok: false, reason: "group-invalid-chars" };
  }
  const expected = _groupChecksum(tier, g1, g2);
  if (cc !== expected) return { ok: false, reason: "checksum-mismatch" };
  if (!/^[A-Za-z0-9_-]+$/.test(sig)) return { ok: false, reason: "signature-invalid" };
  const sigOk = _verify(body, sig, opts.publicKeyPem);
  if (!sigOk) return { ok: false, reason: "signature-invalid" };
  return { ok: true, tier, group1: g1, group2: g2, checksum: cc, sig };
}

function isStandard(parsed) {
  return parsed && parsed.ok && parsed.tier === TIERS.STANDARD;
}

function isDev(parsed) {
  return parsed && parsed.ok && parsed.tier === TIERS.DEV;
}

// Aliases: tests + the CLI bin expect validateKey / canUseCustomBackend
// to accept either a string or a parsed object.
function validateKey(keyOrParsed, opts) {
  if (keyOrParsed && typeof keyOrParsed === "object" && "ok" in keyOrParsed) {
    return keyOrParsed;
  }
  return parse(keyOrParsed, opts);
}

function _asParsed(keyOrParsed, opts) {
  return validateKey(keyOrParsed, opts);
}

// canUseCustomBackend: returns true iff the active license tier allows
// the user to point the CLI at their own backend. Accepts a raw key
// string or a parsed object.
function canUseCustomBackend(keyOrParsed, opts) {
  const parsed = _asParsed(keyOrParsed, opts);
  return isDev(parsed);
}

// Optional remote revocation/expiry check. Stubbed — kept as a hook so
// future ops can wire a license server without touching the CLI.
async function verifyRemote(_parsed, _opts) {
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
