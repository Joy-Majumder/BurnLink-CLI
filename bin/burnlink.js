#!/usr/bin/env node
// BurnLink CLI — entry point.
// Closed-source commercial tool. Source lives at github.com/Joy-Majumder/BurnLink-CLI.
// Distribute via npm + signed binaries; do not redistribute source.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const os = require("node:os");

const crypto = require("../src/crypto");
const license = require("../src/license");
const linkMod = require("../src/link");
const configMod = require("../src/config");
const api = require("../src/api");
const { parseBoolArg } = require("../src/args");

const VERSION = require("../package.json").version;
// apiBaseUrl / linkBaseUrl come from src/config.js DEFAULTS (which already
// include the `/api/cli` path prefix). No fallbacks needed here.

const HELP = `
BurnLink CLI v${VERSION}
End-to-end encrypted file sharing, from your terminal.

USAGE
  burnlink <command> [options]

COMMANDS
  activate <key>         Install / register a license key.
  deactivate             Remove the active license key.
  status                 Show license tier, endpoints, and version.
  upload <file>          Encrypt a file and print a one-time burn link.
  download <url>         Decrypt a burn link into the current directory.
                         Use --out <path> to write elsewhere.
  info <id|url>          Show metadata for a link without burning it.
  config get [key]       Read a config value (apiBaseUrl, linkBaseUrl, …).
  config set <key> <v>   Write a config value. STD keys cannot override
                         apiBaseUrl or linkBaseUrl.
  uninstall [--yes]      Remove BurnLink (handles npm + tarball installs).
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
  // src/config.js DEFAULTS already provide apiBaseUrl/linkBaseUrl fallbacks
  // (apiBaseUrl includes the /api/cli path prefix). No extra fallbacks here.
  return configMod.loadConfig();
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



async function cmdUpload(args) {
  const { cfg } = requireKey();
  const filePath = args._[1];
  if (!filePath) die("usage: burnlink upload <file>");
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) die(`file not found: ${abs}`);

  const plaintext = fs.readFileSync(abs);
  const name = path.basename(abs);
  const expiry = args.expiry || cfg.defaultExpiry || "24h";
  if (!api.VALID_EXPIRY.has(expiry)) {
    die(`invalid --expiry "${expiry}"; allowed: 1h, 24h, 7d`);
  }
  const burn = parseBoolArg(args["burn-after-read"], true);

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
  if (!parsed.ok) die(`could not parse burn link: ${parsed.reason}`);

  info(`fetching ${parsed.id}…`);
  const { ciphertext, expiresAt, originalName } = await api.download(parsed.id, {
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

  // Default filename: prefer the original upload name so a PNG round-trips
  // as `cat.png` instead of `<id>.bin`. The id-only fallback is kept for
  // old uploads that don't carry an original_name.
  const defaultName =
    (originalName && /[^\w.\-]/.test(originalName) === false && originalName.length > 0)
      ? originalName
      : `${parsed.id}.bin`;
  const out = args.out
    ? path.resolve(args.out)
    : path.resolve(`./${defaultName}`);
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
  if (parsed.ok) id = parsed.id;
  const meta = await api.info(id, {
    apiBaseUrl: cfg.apiBaseUrl,
    apiToken: cfg.apiToken,
    licenseKey: cfg.licenseKey,
  });
  console.log(BOLD("id:        "), id);
  console.log("expires:   ", meta.expiresAt);
  console.log("burn:      ", meta.burnAfterRead ? "yes" : "no");
  if (meta.originalName) console.log("filename:  ", meta.originalName);
}

// Per-key validators for `burnlink config set <key> <value>`. Throw on
// invalid input; the message bubbles up to die() with a friendly prefix.
const CONFIG_VALIDATORS = {
  defaultExpiry: (v) => {
    if (!api.VALID_EXPIRY.has(v)) {
      throw new Error(`defaultExpiry must be one of: 1h, 24h, 7d (got "${v}")`);
    }
    return v;
  },
  apiBaseUrl: (v) => {
    if (!/^https?:\/\//.test(v)) {
      throw new Error("apiBaseUrl must start with http:// or https://");
    }
    return v.replace(/\/+$/, "");
  },
  linkBaseUrl: (v) => {
    if (!/^https?:\/\//.test(v)) {
      throw new Error("linkBaseUrl must start with http:// or https://");
    }
    return v.replace(/\/+$/, "");
  },
};

function cmdConfig(args) {
  const sub = args._[1];
  const key = args._[2];
  let val = args._[3];
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
    // Per-key validation. Validate first so a bad value is rejected even
    // if the user wouldn't be allowed to set it anyway.
    if (CONFIG_VALIDATORS[key]) {
      try {
        val = CONFIG_VALIDATORS[key](val);
      } catch (e) {
        die(e.message);
      }
    }
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

function cmdUninstall(args) {
  const yes = args.yes || args.y;

  // Detect install mode.
  //   tarball: ~/.burnlink/.burnlink-install marker + ~/.burnlink/bin/burnlink
  //   npm:     <npm prefix>/bin/burnlink + <npm prefix>/lib/node_modules/burnlink
  const tarballDir = path.join(os.homedir(), ".burnlink");
  const tarballBin = path.join(tarballDir, "bin", "burnlink");
  const tarballMarker = path.join(tarballDir, ".burnlink-install");
  const isTarball =
    fs.existsSync(tarballBin) && fs.existsSync(tarballMarker);

  // For npm installs we need the global prefix. Try `npm config get prefix`,
  // fall back to npm_config_prefix env, fall back to NVM/Node defaults.
  function npmGlobalPrefix() {
    // 1. Ask npm directly using the *user* npmrc (npm's own resolution).
    try {
      const userRc = path.join(os.homedir(), ".npmrc");
      const env = Object.assign({}, process.env);
      // Force npm to consult the user npmrc by clearing any prefix env.
      delete env.npm_config_prefix;
      const args = ["config", "get", "prefix", "--userconfig", userRc];
      const out = execFileSync("npm", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env,
      });
      const p = out.trim();
      if (p && p !== "undefined") return p;
    } catch (_) {}
    // 2. Parse ~/.npmrc ourselves for `prefix=...`.
    try {
      const userRc = path.join(os.homedir(), ".npmrc");
      if (fs.existsSync(userRc)) {
        const txt = fs.readFileSync(userRc, "utf8");
        const m = txt.match(/^\s*prefix\s*=\s*(.+)\s*$/m);
        if (m) return m[1].trim();
      }
    } catch (_) {}
    // 3. Env var.
    if (process.env.npm_config_prefix) return process.env.npm_config_prefix;
    // 4. Fallback: parent of node's bin dir.
    return path.dirname(path.dirname(process.execPath));
  }

  function planDescription() {
    if (isTarball) {
      const lines = [];
      lines.push("  \u2022 remove " + tarballDir);
      lines.push("  \u2022 strip PATH exports from ~/.zshrc / ~/.bashrc / ~/.profile");
      lines.push("  \u2022 strip PATH exports from fish config (if present)");
      return lines;
    }
    const prefix = npmGlobalPrefix();
    const bin = path.join(prefix, "bin", "burnlink");
    const pkg = path.join(prefix, "lib", "node_modules", "burnlink");
    const lines = [];
    lines.push("  \u2022 remove " + bin + " (npm bin shim)");
    lines.push("  \u2022 remove " + pkg + " (npm package)");
    lines.push("  \u2022 run: npm uninstall -g burnlink  (to keep npm's registry state clean)");
    return lines;
  }

  function confirm() {
    process.stdout.write("Continue? [y/N] ");
    let line = "";
    try {
      const buf = Buffer.alloc(1024);
      const n = fs.readSync(0, buf, 0, 1024, null);
      line = buf.slice(0, n).toString("utf8");
    } catch (_) {
      line = "";
    }
    return /^y(es)?$/i.test(line.trim());
  }

  if (!yes) {
    console.log(BOLD("BurnLink uninstall"));
    console.log("");
    if (isTarball) {
      console.log("Detected tarball install at:", tarballDir);
    } else {
      console.log("Detected npm install.");
    }
    console.log("");
    console.log("This will:");
    for (const l of planDescription()) console.log(l);
    console.log("");
    if (!confirm()) die("aborted");
  }

  if (!isTarball) {
    // npm mode.
    const prefix = npmGlobalPrefix();
    const bin = path.join(prefix, "bin", "burnlink");
    const pkg = path.join(prefix, "lib", "node_modules", "burnlink");

    // Direct fs cleanup. `npm uninstall` would also rewrite the npm registry
    // metadata in package-lock + shrinkwrap, but for a global install there's
    // no lockfile to maintain — global installs don't track deps in package.json.
    if (fs.existsSync(bin)) {
      try { fs.unlinkSync(bin); ok("removed " + bin); }
      catch (e) { info("could not remove " + bin + ": " + e.message); }
    }
    if (fs.existsSync(pkg)) {
      try {
        const stat = fs.lstatSync(pkg);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(pkg);
          ok("unlinked " + pkg);
        } else {
          fs.rmSync(pkg, { recursive: true, force: true });
          ok("removed " + pkg);
        }
      } catch (e) { info("could not remove " + pkg + ": " + e.message); }
    }
    // Best-effort: ask npm to forget the package too. Spawn detached so npm
    // doesn't yank the still-running binary (it shouldn't, since we already
    // removed the bin shim and the lib/node_modules dir above, but defensive).
    try {
      spawnSync("npm", ["uninstall", "-g", "burnlink"], {
        detached: true,
        stdio: "ignore",
      });
    } catch (_) {}
    console.log("");
    ok("BurnLink uninstalled. Open a new shell to drop it from PATH.");
    return;
  }

  // --- tarball cleanup ---
  fs.rmSync(tarballDir, { recursive: true, force: true });
  ok("removed " + tarballDir);

  const rcFiles = [
    path.join(os.homedir(), ".zshrc"),
    path.join(os.homedir(), ".bashrc"),
    path.join(os.homedir(), ".profile"),
    path.join(os.homedir(), ".config", "fish", "config.fish"),
  ];

  const marker = "# burnlink: PATH";
  let stripped = 0;
  for (const f of rcFiles) {
    if (!fs.existsSync(f)) continue;
    let txt = fs.readFileSync(f, "utf8");
    const before = txt;
    const lines = txt.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(marker)) continue;
      if (
        /\.burnlink\/bin/.test(line) &&
        i + 1 < lines.length &&
        lines[i + 1].includes(marker)
      ) {
        continue;
      }
      out.push(line);
    }
    txt = out.join("\n");
    if (txt !== before) {
      fs.writeFileSync(f, txt);
      stripped++;
      ok("cleaned " + f);
    }
  }
  if (stripped === 0) info("no shell-rc PATH entries to strip");

  console.log("");
  ok("BurnLink uninstalled. Open a new shell to drop it from PATH.");
}

// --- router ---------------------------------------------------------------

const ROUTES = {
  activate: cmdActivate,
  deactivate: cmdDeactivate,
  status: cmdStatus,
  upload: cmdUpload,
  download: cmdDownload,
  info: cmdInfo,
  config: cmdConfig,
  uninstall: cmdUninstall,
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