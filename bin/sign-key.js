#!/usr/bin/env node
// Admin: mint signed BurnLink license keys.
//
// Usage: node bin/sign-key.js <STD|DEV> [<tier> ...]
// Prints one or more signed keys to stdout. Requires the issuer private
// key at keys/issuer.key — that key is gitignored and only lives on the
// maintainer's machine.
//
// Examples:
//   node bin/sign-key.js STD          # one STD key
//   node bin/sign-key.js DEV 5        # five DEV keys

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const license = require("../src/license");

const tier = (process.argv[2] || "").toUpperCase();
const count = Math.max(1, parseInt(process.argv[3] || "1", 10) || 1);

if (!tier || !Object.values(license.TIERS).includes(tier)) {
  console.error(`usage: node bin/sign-key.js <STD|DEV> [count]`);
  process.exit(2);
}

const privPath = path.join(__dirname, "..", "keys", "issuer.key");
if (!fs.existsSync(privPath)) {
  console.error(`error: missing private key at ${privPath}`);
  console.error(`       run \`node bin/gen-issuer.js\` first.`);
  process.exit(1);
}

for (let i = 0; i < count; i++) {
  const key = license.generateKey(tier, { privateKeyPath: privPath });
  process.stdout.write(key + "\n");
}
