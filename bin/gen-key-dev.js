#!/usr/bin/env node
// burnlink gen-key — DEV-ONLY minting tool.
//
// This script is intentionally NOT shipped to npm. The `gen-key`
// command reads keys/issuer.key from disk and signs a new license;
// that private key never leaves the maintainer's machine, so we keep
// the command out of the public binary.
//
// Usage (from the BurnLink-CLI repo):
//   node bin/gen-key-dev.js <STD|DEV>
//
// The first positional arg selects the tier. STD keys can only be
// minted when an active DEV license is present in the user's
// config — see cmdGenKey in burnlink.js (kept here for parity).

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const license = require("../src/license");
const configMod = require("../src/config");

function die(msg, code = 1) {
  console.error("error:", msg);
  process.exit(code);
}

function loadConfig() {
  // Reuse the same path-resolution logic the CLI does.
  return configMod.loadConfig();
}

function main() {
  const args = process.argv.slice(2);
  const tierRaw = args[0];
  if (!tierRaw) die("usage: node bin/gen-key-dev.js <STD|DEV>");
  const tier = tierRaw.toUpperCase();
  if (!Object.values(license.TIERS).includes(tier)) {
    die(`unknown tier "${tierRaw}" — use STD or DEV`);
  }
  if (tier === license.TIERS.STANDARD) {
    const cfg = loadConfig();
    if (cfg.licenseKey) {
      const existing = license.validateKey(cfg.licenseKey);
      if (!existing.ok || existing.tier === license.TIERS.STANDARD) {
        die("STD keys cannot mint other STD keys. Activate a DEV key first.");
      }
    } else {
      die("activating a STD key requires an existing DEV license.");
    }
  }
  try {
    const key = license.generateKey(tier);
    process.stdout.write(key + "\n");
  } catch (e) {
    // Most common failure here: keys/issuer.key is missing. The
    // bundled public key (issuer.pub) is enough to VERIFY a key, but
    // only the maintainer holds the matching private key.
    if (e && /ENOENT/.test(e.message)) {
      die(`keys/issuer.key not found. This script is for maintainers only.`);
    }
    die(e.message || String(e));
  }
}

main();
