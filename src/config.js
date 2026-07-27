// Persistent CLI config stored as JSON.
//
//   macOS/Linux: $XDG_CONFIG_HOME/burnlink/config.json  (defaults to ~/.config/burnlink)
//   Windows    : %APPDATA%\burnlink\config.json
//   Test overrride: BURNLINK_CONFIG_DIR=<path>
//
// Schema:
//   {
//     licenseKey:    "BURNLINK-STD-XXXX-XXXX-CCCC",     # active license
//     apiBaseUrl:    "https://burnlink.app",           # default
//     linkBaseUrl:   "https://burnlink.app",           # default
//     defaultExpiry: "24h",                            # "1h"|"24h"|"7d"
//     apiToken:      null,                             # optional bearer
//     licenseServerUrl: null                           # opt-in remote check
//   }

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULTS = Object.freeze({
  licenseKey: null,
  apiBaseUrl: "https://burnlink.app/api/cli",
  linkBaseUrl: "https://burnlink.app",
  defaultExpiry: "24h",
  apiToken: null,
  licenseServerUrl: null,
});

function configDir() {
  if (process.env.BURNLINK_CONFIG_DIR) {
    return process.env.BURNLINK_CONFIG_DIR;
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "burnlink");
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "burnlink");
}

function configPath() {
  return path.join(configDir(), "config.json");
}

function loadConfig() {
  const p = configPath();
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    // missing or corrupt — start clean
  }
  return { ...DEFAULTS, ...raw };
}

function saveConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), {
    mode: 0o600,
  });
  return cfg;
}

function get(key) {
  const cfg = loadConfig();
  if (key === undefined) return cfg;
  return cfg[key];
}

function set(key, value) {
  if (!(key in DEFAULTS)) {
    throw new Error(
      `unknown config key: ${key} (allowed: ${Object.keys(DEFAULTS).join(", ")})`,
    );
  }
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
  return cfg;
}

module.exports = { DEFAULTS, loadConfig, saveConfig, get, set, configPath };
