#!/usr/bin/env node
// Admin: generate the BurnLink issuer keypair (Ed25519).
//
// Writes:
//   keys/issuer.pub   — bundled with the CLI + server (safe to commit)
//   keys/issuer.key   — private signing key, gitignored, NEVER commit
//
// Run this once on the maintainer's machine. Re-running will overwrite
// both files — that invalidates every license you've ever issued, so
// don't do it casually.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const keysDir = path.join(__dirname, "..", "keys");
fs.mkdirSync(keysDir, { recursive: true });

if (fs.existsSync(path.join(keysDir, "issuer.key"))) {
  console.error("keys/issuer.key already exists. Aborting.");
  console.error("Move the existing key aside first if you really mean to rotate.");
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(
  path.join(keysDir, "issuer.pub"),
  publicKey.export({ type: "spki", format: "pem" })
);
fs.writeFileSync(
  path.join(keysDir, "issuer.key"),
  privateKey.export({ type: "pkcs8", format: "pem" }),
  { mode: 0o600 }
);

console.log("✓ wrote keys/issuer.pub");
console.log("✓ wrote keys/issuer.key (mode 0600)");
console.log("⚠ keys/issuer.key is gitignored. Back it up somewhere safe.");
