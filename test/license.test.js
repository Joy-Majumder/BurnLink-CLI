"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const license = require("../src/license");

test("generateKey → validateKey round-trips for STD", () => {
  const key = license.generateKey(license.TIERS.STANDARD);
  assert.ok(key.startsWith("BURNLINK-STD-"), "prefix matches");
  const parsed = license.validateKey(key);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tier, license.TIERS.STANDARD);
});

test("generateKey → validateKey round-trips for DEV", () => {
  const key = license.generateKey(license.TIERS.DEV);
  const parsed = license.validateKey(key);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tier, license.TIERS.DEV);
});

test("validateKey rejects a tampered checksum", () => {
  const key = license.generateKey(license.TIERS.STANDARD);
  // Flip a char in the checksum group; the new last char is the start
  // of the signature, so this also breaks the Ed25519 sig — either
  // failure mode is acceptable.
  const tampered = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
  const parsed = license.validateKey(tampered);
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /checksum|signature/);
});

test("validateKey rejects malformed strings", () => {
  for (const bad of [
    "",
    "not-a-key",
    "BURNLINK-STD-AAAA",
    "BURNLINK-XXX-AAAA-BBBB-CCCC",
    "BURNLINK-STD-AAAA-BBBB-CCCC-EXTRA",
  ]) {
    const parsed = license.validateKey(bad);
    assert.equal(parsed.ok, false, `should reject: ${bad}`);
  }
});

test("canUseCustomBackend blocks STD, allows DEV", () => {
  const std = license.generateKey(license.TIERS.STANDARD);
  const dev = license.generateKey(license.TIERS.DEV);
  assert.equal(license.canUseCustomBackend(std), false);
  assert.equal(license.canUseCustomBackend(dev), true);
});

test("two STD keys from the same source look distinct (random groups)", () => {
  const a = license.generateKey(license.TIERS.STANDARD);
  const b = license.generateKey(license.TIERS.STANDARD);
  assert.notEqual(a, b);
});