"use strict";
// Premium CLI UI helpers — model: gh, stripe, pnpm, bun, wrangler.
//
// Conventions:
//   - TTY-aware colors; honours NO_COLOR / --no-color / piped output.
//   - All output goes through these helpers so we can swap to a JSON mode
//     (`--json`) later without rewriting every command.
//   - Symbols: ✓ ✗ ⚠ i — use Unicode only where safe (xterm/iTerm/WT all OK;
//     Windows cmd.exe gets the ASCII fallback).
//
// Exposed:
//   ui.success / warn / error / info
//   ui.kv(table)            — 2-col key/value table, like `gh status`
//   ui.box(title, body)     — bordered panel
//   ui.link(label, url)
//   ui.command(name)        — highlighted command name
//   ui.dim / ui.bold        — passthrough escape helpers
//   ui.isTTY                — colour-eligibility boolean

const TTY =
  !!process.stdout.isTTY &&
  !process.env.NO_COLOR &&
  !process.env.CI &&
  process.env.TERM !== "dumb";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

// Brand palette — sourced from ./brand.js (which mirrors views/index.ejs
// and public/upload.js exactly). Friendly aliases below — what each one
// is FOR in the CLI, and where it appears on the website.
const brand = require("./brand");
const FG = {
  orange:       brand.ANSI.primary,       // #eb583d — burnlink commands, links (web: links, focus)
  orangeLight:  brand.ANSI.secondary,     // #ff8c42 — gradient pair           (web: progress gradient)
  success:      brand.ANSI.success,       // #28df54 — ✓ checkmark              (web: toast.success text)
  successDeep:  brand.ANSI.successDeep,   // #28a745 — deeper green for borders (web: toast.success border)
  danger:       "\x1b[38;2;255;82;82m",   // #ff5252 — ✗ errors                (web: no equivalent; CLI-only)
  warning:      "\x1b[38;2;255;177;59m",  // #ffb13b — ⚠ warnings              (web: no equivalent; CLI-only)
  cyan:         "\x1b[38;2;132;204;22m",  // #84cc16 — info accent              (web: no equivalent; CLI-only)
  gray:         "\x1b[38;2;136;136;136m", // #888888 — dim text                  (web: implicit via opacity)
};

function paint(color, s) {
  return TTY ? `${FG[color]}${s}${RESET}` : s;
}

function dim(s) {
  return TTY ? `${DIM}${s}${RESET}` : s;
}
function bold(s) {
  return TTY ? `${BOLD}${s}${RESET}` : s;
}
function command(s) {
  // Wordmark the command name in orange. Used everywhere we mention a command.
  return paint("orange", s);
}

// Symbol fallbacks for terminals that can't render glyphs.
const sym = {
  tick: TTY ? "✓" : "[ok]",
  cross: TTY ? "✗" : "[x]",
  warn: TTY ? "⚠" : "[!]",
  info: TTY ? "i" : ">",
  arrow: TTY ? "→" : "->",
};

function success(msg) {
  // Matches the website's #28df54 (success toasts) plus the same tick ✓.
  process.stdout.write(`${paint("success", sym.tick)} ${msg}\n`);
}
function warn(msg) {
  // Matches the website's #ffb13b (warning amber) plus the ⚠ glyph.
  process.stdout.write(`${paint("warning", sym.warn)} ${msg}\n`);
}
function error(msg) {
  // Bright red for CLI errors (no equivalent on the web — distinct signal).
  process.stderr.write(`${paint("danger", sym.cross)} ${msg}\n`);
}
function info(msg) {
  // Uses the brand orange for info hints so they read as "from Burnlink."
  process.stdout.write(`${paint("orange", sym.info)} ${msg}\n`);
}

function link(label, url) {
  // OSC 8 hyperlink if supported; falls back to "label (url)".
  if (TTY && process.platform !== "win32") {
    return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
  }
  return `${label} ${dim("(" + url + ")")}`;
}

// 2-col key/value table. Keys are dimmed, values rendered as-is.
function kv(rows) {
  const keyWidth = Math.max(...rows.map(([k]) => k.length));
  const out = [];
  for (const [k, v] of rows) {
    out.push(`  ${dim(pad(k, keyWidth))}  ${v}`);
  }
  return out.join("\n");
}

function pad(s, w) {
  if (s.length >= w) return s;
  return s + " ".repeat(w - s.length);
}

// Rounded single-line box (no Unicode box-drawing, only ASCII).
function box(title, body) {
  const width = Math.max(
    40,
    ...body.split("\n").map((l) => l.length),
    title.length + 4,
  );
  const top = `  ${DIM}+${"-".repeat(width + 2)}+${RESET}`;
  const head = `  ${DIM}|${RESET} ${bold(title)} ${dim("".padEnd(width - title.length - 1, " "))} ${DIM}|${RESET}`;
  const sep = `  ${DIM}+${RESET}${dim("-".repeat(width + 2))}${DIM}+${RESET}`;
  const lines = body.split("\n").map((l) => {
    const vis = l.replace(/\x1b\[[0-9;]*m/g, "");
    const padn = Math.max(0, width - vis.length);
    return `  ${DIM}|${RESET} ${l}${" ".repeat(padn)} ${DIM}|${RESET}`;
  });
  const bot = `  ${DIM}+${"-".repeat(width + 2)}+${RESET}`;
  return [top, head, sep, ...lines, bot].join("\n");
}

module.exports = {
  isTTY: TTY,
  success,
  warn,
  error,
  info,
  kv,
  box,
  link,
  command,
  dim,
  bold,
  paint,
  RESET,
  DIM,
  BOLD,
  FG,
  sym,
};