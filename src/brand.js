"use strict";
// BurnLink brand palette.
//
// Single source of truth for the CLI's colors. Mirrors the website's
// stylesheets (views/index.ejs, public/upload.js) 1:1. If the website
// palette changes, update HEX here and the ANSI escapes below.
//
// To verify colors match in your terminal:
//
//   node -e 'const b=require("./brand"); for (const [k,v] of Object.entries(b.ANSI)) console.log(k.padEnd(16), b.HEX[k], v)'
//
// (Strip ANSI codes to read clean text; render through a truecolor
// terminal to see the actual hues.)
//
// To prove to yourself the CLI uses the same colors as the website,
// open views/index.ejs and grep for the same hex codes — they should all
// appear in HEX below.

const HEX = {
  // Primary — the flame orange used everywhere on the brand
  primary:     "#eb583d", // web: links, focus, QR buttons, hero em, brand wordmark
  // Secondary — pair in the gradient
  secondary:   "#ff8c42", // web: progress bar gradient (toast.info text)
  // Surfaces (dark theme)
  bg:          "#0f0f0f",
  surface:     "#141414",
  surfaceAlt:  "#1a1a1a",
  border:      "#2a2a2a",
  borderAlt:   "#2b2b2b",
  // Text
  textMuted:   "#888888",
  text:        "#aaaaaa",
  textBright:  "#ffffff",
  // Semantic
  success:     "#28df54", // toast text
  successDeep: "#28a745", // toast border / status accents
  warning:     "#ffb13b", // (no direct web use; inferred from gradient pair)
  danger:      "#ff5252", // (no direct web use; bright terminal red)
};

// Convert each HEX to the corresponding 24-bit ANSI foreground code.
function rgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
function ansiFg(hex) {
  const [r, g, b] = rgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}
function ansiBg(hex) {
  const [r, g, b] = rgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

const ANSI = {};
const BG = {};
for (const [k, h] of Object.entries(HEX)) {
  ANSI[k] = ansiFg(h);
  BG[k] = ansiBg(h);
}

module.exports = { HEX, ANSI, BG, rgb, ansiFg, ansiBg };