"use strict";

// Argument-parsing helpers for the CLI entry point.
//
// Extracted into its own module so they can be unit-tested without
// having to spawn the CLI binary. The CLI bin file imports these;
// anything else that needs CLI-shaped flags can use them too.

// Parse a boolean flag value that may arrive as:
//   - a bare flag (e.g. `--burn-after-read`            → true)
//   - absent entirely                              → fallback
//   - a string ("true"/"false"/"1"/"0"/etc.)       → parsed value
// Recognized truthy:   true, "true", "1", "yes", "on"
// Recognized falsy:    false, "false", "0", "no", "off"
// Anything else (e.g. "garbage") returns the fallback rather than
// throwing — callers should validate separately if they care.
function parseBoolArg(v, fallback) {
  if (v === true) return true;
  if (v === undefined || v === null) return fallback;
  const s = String(v).toLowerCase();
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  return fallback;
}

module.exports = { parseBoolArg };
