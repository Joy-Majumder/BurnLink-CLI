// AES-256-GCM encrypt/decrypt with base64url payload packing.
//
// Payload shape on the wire:
//   base64url( iv[12] || ciphertext || authTag[16] )
//
// The 12-byte IV is prepended; the 16-byte GCM auth tag is appended by
// crypto.createCipheriv automatically. base64url is URL-safe (no '+',
// '/', or '='), so the whole payload is safe in a URL path.

const crypto = require("crypto");

const ALG = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32; // 256-bit
const TAG_BYTES = 16;

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  b64 += "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(b64, "base64");
}

function newKey() {
  return crypto.randomBytes(KEY_BYTES);
}

function encrypt(plaintext, keyIn) {
  const key = Buffer.isBuffer(keyIn) && keyIn.length === KEY_BYTES
    ? keyIn
    : newKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, ct, tag]);
  return { ciphertext: payload, key, iv };
}

function decrypt(payload, ivOrKey, keyMaybe) {
  // Two-call signatures supported:
  //   decrypt(payload, key)            — payload is full on-wire (iv||ct||tag)
  //   decrypt(ctWithTag, iv, key)      — payload is ct||tag only
  let iv, ct, tag, key;
  if (keyMaybe) {
    iv = ivOrKey;
    key = keyMaybe;
    if (payload.length < TAG_BYTES) throw new Error("payload too short");
    tag = payload.subarray(payload.length - TAG_BYTES);
    ct = payload.subarray(0, payload.length - TAG_BYTES);
  } else {
    key = ivOrKey;
    if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
      throw new Error(`key must be a ${KEY_BYTES}-byte Buffer`);
    }
    if (payload.length < IV_BYTES + TAG_BYTES) {
      throw new Error("payload too short");
    }
    iv = payload.subarray(0, IV_BYTES);
    tag = payload.subarray(payload.length - TAG_BYTES);
    ct = payload.subarray(IV_BYTES, payload.length - TAG_BYTES);
  }
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function encryptToB64Url(plaintext, key) {
  const { ciphertext, key: usedKey, iv } = encrypt(plaintext, key);
  return { payload: b64urlEncode(ciphertext), key: usedKey, iv };
}

function decryptFromB64Url(s, key) {
  return decrypt(b64urlDecode(s), key);
}

// Concatenated envelope: [4-byte BE length][json meta][file bytes].
// Lets the recipient recover original filename + size without trusting
// the server. The CLI currently sends bare ciphertext, but this helper
// is here when the on-disk payload needs metadata.
function packPayload({ meta, file }) {
  const metaBuf = Buffer.from(JSON.stringify(meta || {}), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(metaBuf.length, 0);
  return Buffer.concat([lenBuf, metaBuf, file]);
}

function unpackPayload(buf) {
  if (buf.length < 4) throw new Error("payload too short");
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len) throw new Error("payload truncated");
  const meta = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
  const file = buf.subarray(4 + len);
  return { meta, file };
}

module.exports = {
  ALG,
  IV_BYTES,
  KEY_BYTES,
  TAG_BYTES,
  newKey,
  encrypt,
  decrypt,
  encryptToB64Url,
  decryptFromB64Url,
  packPayload,
  unpackPayload,
  b64urlEncode,
  b64urlDecode,
};
