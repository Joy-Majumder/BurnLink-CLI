"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoMod = require("../src/crypto");

const IV_BYTES = 12;
const TAG_BYTES = 16;

test("encrypt → decrypt round-trips plaintext", () => {
  const plaintext = Buffer.from("the crows have returned to burn the bridge again");
  const { ciphertext, key, iv } = cryptoMod.encrypt(plaintext);
  assert.ok(ciphertext.length > 0, "ciphertext produced");
  assert.equal(iv.length, 12, "iv is 12 bytes");
  assert.equal(key.length, 32, "key is 32 bytes");
  // ciphertext is iv || ct || tag. Use the 2-arg form for the full payload.
  const decoded = cryptoMod.decrypt(ciphertext, key);
  assert.deepEqual(decoded, plaintext);
});

test("encrypt uses a fresh iv each call (no nonce reuse)", () => {
  const plaintext = Buffer.from("same input twice");
  const a = cryptoMod.encrypt(plaintext);
  const b = cryptoMod.encrypt(plaintext);
  assert.notDeepEqual(a.iv, b.iv, "ivs differ between calls");
  assert.notDeepEqual(a.ciphertext, b.ciphertext, "ciphertexts differ");
});

test("decrypt 3-arg form: ct||tag with separate iv", () => {
  const { ciphertext, iv, key } = cryptoMod.encrypt(Buffer.from("hello there"));
  const ctWithTag = ciphertext.subarray(IV_BYTES); // strip leading iv
  const decoded = cryptoMod.decrypt(ctWithTag, iv, key);
  assert.equal(decoded.toString(), "hello there");
});

test("decrypt with the wrong key throws (auth tag fails)", () => {
  const { ciphertext, iv } = cryptoMod.encrypt(Buffer.from("secret"));
  const wrongKey = Buffer.alloc(32, 7);
  assert.throws(() => cryptoMod.decrypt(ciphertext, iv, wrongKey));
});

test("decrypt with a tampered ciphertext throws", () => {
  const { ciphertext, iv, key } = cryptoMod.encrypt(Buffer.from("secret"));
  ciphertext[IV_BYTES] ^= 0xff; // flip a byte in the ct region
  assert.throws(() => cryptoMod.decrypt(ciphertext, iv, key));
});

test("packPayload / unpackPayload carries metadata + file bytes", () => {
  const meta = { name: "a.txt", expiry: "24h" };
  const file = Buffer.from("hello world");
  const packed = cryptoMod.packPayload({ meta, file });
  const opened = cryptoMod.unpackPayload(packed);
  assert.deepEqual(opened.meta, meta);
  assert.deepEqual(opened.file, file);
});