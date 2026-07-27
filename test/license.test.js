"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const license = require("../src/license");

// Tests use a throwaway keypair committed under test/fixtures/ so the
// test suite has no dependency on keys/issuer.key (which only lives on
// the maintainer's machine).
const FIXTURES = path.join(__dirname, "fixtures");
const TEST_PRIV = path.join(FIXTURES, "test-issuer.key");
const TEST_PUB = require("node:fs").readFileSync(
  path.join(FIXTURES, "test-issuer.pub"),
  "utf8"
);
const genOpts = { privateKeyPath: TEST_PRIV };
const parseOpts = { publicKeyPem: TEST_PUB };

test("generateKey → validateKey round-trips for STD", () => {
  const key = license.generateKey(license.TIERS.STANDARD, genOpts);
  assert.ok(key.startsWith("BURNLINK-STD-"), "prefix matches");
  const parsed = license.validateKey(key, parseOpts);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tier, license.TIERS.STANDARD);
});

test("generateKey → validateKey round-trips for DEV", () => {
  const key = license.generateKey(license.TIERS.DEV, genOpts);
  const parsed = license.validateKey(key, parseOpts);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tier, license.TIERS.DEV);
});

test("validateKey rejects a tampered checksum", () => {
  const key = license.generateKey(license.TIERS.STANDARD, genOpts);
  // Tamper a char in the checksum group (positions 19..22 of "BURNLINK-STD-XXXX-XXXX-CCCC.<sig>").
  // Flip a char deep inside the checksum so the signature is definitely
  // for a different body and cannot verify.
  const dot = key.indexOf(".");
  const body = key.slice(0, dot);
  const checksumStart = body.length - 4;
  const ch = body[checksumStart];
  const replaced = ch === "A" ? "B" : "A";
  const tamperedBody = body.slice(0, checksumStart) + replaced + body.slice(checksumStart + 1);
  const tampered = tamperedBody + key.slice(dot);
  const parsed = license.validateKey(tampered, parseOpts);
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
    const parsed = license.validateKey(bad, parseOpts);
    assert.equal(parsed.ok, false, `should reject: ${bad}`);
  }
});

test("canUseCustomBackend blocks STD, allows DEV", () => {
  const std = license.generateKey(license.TIERS.STANDARD, genOpts);
  const dev = license.generateKey(license.TIERS.DEV, genOpts);
  assert.equal(license.canUseCustomBackend(std, parseOpts), false);
  assert.equal(license.canUseCustomBackend(dev, parseOpts), true);
});

test("two STD keys from the same source look distinct (random groups)", () => {
  const a = license.generateKey(license.TIERS.STANDARD, genOpts);
  const b = license.generateKey(license.TIERS.STANDARD, genOpts);
  assert.notEqual(a, b);
});