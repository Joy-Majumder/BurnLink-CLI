#!/usr/bin/env node
// BurnLink CLI — entry point.
// Closed-source commercial tool. Source lives at github.com/Joy-Majumder/BurnLink-CLI.
// Distribute via npm + signed binaries; do not redistribute source.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

const crypto = require("../src/crypto");
const license = require("../src/license");
const linkMod = require("../src/link");
const configMod = require("../src/config");
const api = require("../src/api");

const VERSION = require("../package.json").version;
const DEFAULT_API = "https://burnlink.page";
const DEFAULT_LINK = "https://burnlink.page";

const HELP = `
BurnLink CLI v${VERSION}
End-to-end encrypted file sharing, from your terminal.

USAGE
  burnlink <command> [options]

COMMANDS
  activate <key>         Install / register a license key.
  deactivate             Remove the active license key.
  status                 Show license tier, endpoints, and version.
  gen-key <STD|DEV>      [dev] Generate a license key (offline tool).
  upload <file>          Encrypt a file and print a one-time burn link.
  download <url>         Decrypt a burn link into the current directory.
                         Use --out <path> to write elsewhere.
  info <id|url>          Show metadata for a link without burning it.
  config get [key]       Read a config value (apiBaseUrl, linkBaseUrl, …).
  config set <key> <v>   Write a config value. STD keys cannot override
                         apiBaseUrl or linkBaseUrl.
  help                   Show this message.
  version                Print version.

EXAMPLES
  burnlink activate BURNLINK-STD-AAAA-BBBB-CCCC
  burnlink upload ./secret.pdf
  burnlink download https://burnlink.page/d/abc123 --out ./secret.pdf
  burnlink info https://burnlink.page/d/abc123

All network payloads are AES-256-GCM encrypted client-side. The server
only ever sees ciphertext. Burn-after-read deletes the payload after
the first successful download.
`.trim();

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GRN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function die(msg, code = 1) {
  console.error(RED("error:"), msg);
  process.exit(code);
}

function ok(msg) {
  console.log(GRN("✓"), msg);
}

function info(msg) {
  console.log(DIM("•"), msg);
}

// Tiny argv parser. Avoids pulling commander/yargs into a closed-source
// binary where we control every flag.
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) {
        args[key.slice(0, eq)] = key.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    } else if (a.startsWith("-") && a.length === 2) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        args[a.slice(1)] = next;
        i++;
      } else {
        args[a.slice(1)] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function loadConfig() {
  const cfg = configMod.loadConfig();
  cfg.apiBaseUrl = cfg.apiBaseUrl || DEFAULT_API;
  cfg.linkBaseUrl = cfg.linkBaseUrl || DEFAULT_LINK;
  return cfg;
}

function requireKey() {
  const cfg = loadConfig();
  const key = cfg.licenseKey;
  if (!key) {
    die("no active license — run `burnlink activate <key>` first.");
  }
  const parsed = license.validateKey(key);
  if (!parsed.ok) {
    die(`license key invalid: ${parsed.reason}`);
  }
  return { key, parsed, cfg };
}

// --- commands --------------------------------------------------------------

function cmdActivate(args) {
  const key = args._[1];
  if (!key) die("usage: burnlink activate <key>");
  const parsed = license.validateKey(key);
  if (!parsed.ok) die(`invalid key: ${parsed.reason}`);
  configMod.set("licenseKey", key);
  ok(`activated ${parsed.tier} license (${key.slice(0, 18)}…)`);
}

function cmdDeactivate() {
  const cfg = loadConfig();
  if (!cfg.licenseKey) {
    info("no active license");
    return;
  }
  configMod.set("licenseKey", null);
  ok("license removed");
}

function cmdStatus() {
  const cfg = loadConfig();
  console.log(BOLD("BurnLink CLI"), `v${VERSION}`);
  console.log("license:    ", cfg.licenseKey ? `${cfg.licenseKey.slice(0, 18)}…` : DIM("(none)"));
  if (cfg.licenseKey) {
    const parsed = license.validateKey(cfg.licenseKey);
    console.log("tier:       ", parsed.ok ? parsed.tier : RED("invalid"));
  }
  console.log("api:        ", cfg.apiBaseUrl);
  console.log("links:      ", cfg.linkBaseUrl);
}

function cmdGenKey(args) {
  const tierRaw = args._[1];
  if (!tierRaw) die("usage: burnlink gen-key <STD|DEV>");
  const tier = tierRaw.toUpperCase();
  if (!Object.values(license.TIERS).includes(tier)) {
    die(`unknown tier "${tierRaw}" — use STD or DEV`);
  }
  // Gated: STD key generation requires the existing key to be STD or DEV.
  // DEV key generation is the dev's own escape hatch — open by design.
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
  const key = license.generateKey(tier);
  console.log(key);
}

async function cmdUpload(args) {
  const { cfg } = requireKey();
  const filePath = args._[1];
  if (!filePath) die("usage: burnlink upload <file>");
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) die(`file not found: ${abs}`);

  const plaintext = fs.readFileSync(abs);
  const name = path.basename(abs);
  const expiry = args.expiry || "24h";
  const burn = args["burn-after-read"] !== false; // default true

  const { ciphertext, key, iv } = crypto.encrypt(plaintext);
  info(`encrypted ${plaintext.length} bytes → ${ciphertext.length} bytes`);

  const { id, expiresAt } = await api.upload(ciphertext, {
    name,
    expiry,
    burnAfterRead: burn,
    apiBaseUrl: cfg.apiBaseUrl,
    apiToken: cfg.apiToken,
    licenseKey: cfg.licenseKey,
  });

  const url = linkMod.build({ id, key, iv, baseUrl: cfg.linkBaseUrl });
  ok(`burn link ready (expires ${expiresAt})`);
  console.log(BOLD(url));
  info("the fragment after # holds the decryption key — share the whole URL, never the API.");
}

async function cmdDownload(args) {
  const { cfg } = requireKey();
  const urlRaw = args._[1];
  if (!urlRaw) die("usage: burnlink download <url> [--out <path>]");
  const parsed = linkMod.parse(urlRaw);
  if (!parsed) die("could not parse burn link");

  info(`fetching ${parsed.id}…`);
  const { ciphertext, expiresAt } = await api.download(parsed.id, {
    apiBaseUrl: cfg.apiBaseUrl,
    apiToken: cfg.apiToken,
    licenseKey: cfg.licenseKey,
  });

  let plaintext;
  try {
    // ciphertext from the server is iv||ct||tag. The IV in the URL
    // fragment must match; if it doesn't, the GCM auth tag will fail
    // and we exit cleanly.
    if (!parsed.iv.equals(ciphertext.subarray(0, crypto.IV_BYTES))) {
      die("link IV does not match server payload — the link is corrupt");
    }
    const ctWithTag = ciphertext.subarray(crypto.IV_BYTES);
    plaintext = crypto.decrypt(ctWithTag, parsed.iv, parsed.key);
  } catch (e) {
    die(`decryption failed: ${e.message}`);
  }

  const out = args.out
    ? path.resolve(args.out)
    : path.resolve(`./${parsed.id}.bin`);
  fs.writeFileSync(out, plaintext);
  ok(`wrote ${plaintext.length} bytes → ${out}`);
  info(`link expired ${expiresAt}`);
}

async function cmdInfo(args) {
  const { cfg } = requireKey();
  let raw = args._[1];
  if (!raw) die("usage: burnlink info <id|url>");
  // accept either full URL or bare id
  let id = raw;
  const parsed = linkMod.parse(raw);
  if (parsed) id = parsed.id;
  const meta = await api.info(id, {
    apiBaseUrl: cfg.apiBaseUrl,
    apiToken: cfg.apiToken,
    licenseKey: cfg.licenseKey,
  });
  console.log(BOLD("id:        "), id);
  console.log("expires:   ", meta.expiresAt);
  console.log("burn:      ", meta.burnAfterRead ? "yes" : "no");
}

function cmdConfig(args) {
  const sub = args._[1];
  const key = args._[2];
  const val = args._[3];
  const cfg = loadConfig();

  if (sub === "get") {
    if (!key) {
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }
    console.log(cfg[key] ?? "");
    return;
  }

  if (sub === "set") {
    if (!key || val === undefined) die("usage: burnlink config set <key> <value>");
    // Gate: STD tier cannot redirect to a different backend.
    if ((key === "apiBaseUrl" || key === "linkBaseUrl") && cfg.licenseKey) {
      const parsed = license.validateKey(cfg.licenseKey);
      if (parsed.ok && parsed.tier === license.TIERS.STANDARD) {
        die(`STD license cannot override ${key}. Upgrade to DEV to use a custom backend.`);
      }
    }
    configMod.set(key, val);
    ok(`${key} = ${val}`);
    return;
  }

  die("usage: burnlink config <get|set> [key] [value]");
}

// --- router ---------------------------------------------------------------

const ROUTES = {
  activate: cmdActivate,
  deactivate: cmdDeactivate,
  status: cmdStatus,
  "gen-key": cmdGenKey,
  upload: cmdUpload,
  download: cmdDownload,
  info: cmdInfo,
  config: cmdConfig,
  help: () => console.log(HELP),
  version: () => console.log(VERSION),
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) return console.log(HELP);
  if (args.version || args.V) return console.log(VERSION);

  const cmd = args._[0];
  if (!cmd) {
    console.log(HELP);
    return;
  }
  const handler = ROUTES[cmd];
  if (!handler) die(`unknown command: ${cmd} — try \`burnlink help\``);

  try {
    await handler(args);
  } catch (e) {
    if (e && e.statusCode) {
      die(`${e.message || "request failed"} (HTTP ${e.statusCode})`);
    }
    die(e && e.message ? e.message : String(e));
  }
}

main();