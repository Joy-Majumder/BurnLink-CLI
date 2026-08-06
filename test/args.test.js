"use strict";

// Unit tests for src/args.js (parseBoolArg). Pure, offline — no server,
// no key required. Run via: `npm test` or `node --test test/args.test.js`.

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseBoolArg } = require("../src/args");

test("parseBoolArg: undefined returns the fallback", () => {
  assert.equal(parseBoolArg(undefined, true), true);
  assert.equal(parseBoolArg(undefined, false), false);
  assert.equal(parseBoolArg(undefined, null), null);
});

test("parseBoolArg: null returns the fallback", () => {
  assert.equal(parseBoolArg(null, true), true);
  assert.equal(parseBoolArg(null, false), false);
});

test("parseBoolArg: bare flag (boolean true) wins over fallback", () => {
  // `--burn-after-read` with no value lands here. The caller is asking
  // for the flag to be on; treat it as true even if the default is false.
  assert.equal(parseBoolArg(true, false), true);
});

test("parseBoolArg: recognized truthy strings", () => {
  assert.equal(parseBoolArg("true", false), true);
  assert.equal(parseBoolArg("TRUE", false), true);
  assert.equal(parseBoolArg("True", false), true);
  assert.equal(parseBoolArg("1", false), true);
  assert.equal(parseBoolArg("yes", false), true);
  assert.equal(parseBoolArg("YES", false), true);
  assert.equal(parseBoolArg("on", false), true);
});

test("parseBoolArg: recognized falsy strings", () => {
  // This is the regression test for the `--burn-after-read false` bug:
  // the flag's value used to arrive as the string "false" and was
  // silently ignored by `args["burn-after-read"] !== false`.
  assert.equal(parseBoolArg("false", true), false);
  assert.equal(parseBoolArg("FALSE", true), false);
  assert.equal(parseBoolArg("False", true), false);
  assert.equal(parseBoolArg("0", true), false);
  assert.equal(parseBoolArg("no", true), false);
  assert.equal(parseBoolArg("NO", true), false);
  assert.equal(parseBoolArg("off", true), false);
});

test("parseBoolArg: unrecognized strings fall back rather than throw", () => {
  // Be lenient: garbage in → fallback out. Callers that require a hard
  // signal should use a separate validator (see CONFIG_VALIDATORS).
  assert.equal(parseBoolArg("garbage", true), true);
  assert.equal(parseBoolArg("garbage", false), false);
  assert.equal(parseBoolArg("", true), true);
  assert.equal(parseBoolArg(2, true), true);      // unknown number → fallback
  assert.equal(parseBoolArg("0", true), false);   // "0" string → recognized falsy
});
