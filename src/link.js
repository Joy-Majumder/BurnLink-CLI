// Burn-link build + parse.
//
// A burn link is:
//
//   <baseUrl>/d/<id>#<keyAndIvB64Url>
//
//   - id       : opaque server-side handle (returned by POST /upload)
//   - fragment : base64url(key[32] || iv[12]). NEVER sent to the server;
//                lives in the URL fragment, which HTTP clients strip
//                before transmission.
//
// build({baseUrl, id, key, iv}) → string
// parse(url) → {ok, id, key, iv, baseUrl} | {ok:false, reason}

"use strict";

const { b64urlDecode, b64urlEncode } = require("./crypto");

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function build({ baseUrl, id, key, iv }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("key must be a 32-byte Buffer");
  }
  if (!Buffer.isBuffer(iv) || iv.length !== 12) {
    throw new Error("iv must be a 12-byte Buffer");
  }
  if (!id) throw new Error("id required");
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  const fragment = b64urlEncode(Buffer.concat([key, iv]));
  return `${trimmed}/d/${id}#${fragment}`;
}

function parse(url) {
  if (typeof url !== "string" || !url) {
    return { ok: false, reason: "empty-url" };
  }
  const hashIdx = url.indexOf("#");
  if (hashIdx === -1) {
    return { ok: false, reason: "missing-key-fragment" };
  }
  const beforeHash = url.slice(0, hashIdx);
  const fragment = url.slice(hashIdx + 1);
  let parsed;
  try {
    parsed = new URL(beforeHash);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  const m = parsed.pathname.match(/\/d\/([A-Za-z0-9_-]+)$/);
  if (!m) return { ok: false, reason: "missing-id" };
  const id = m[1];
  if (!fragment) return { ok: false, reason: "empty-key" };

  let buf;
  try {
    buf = b64urlDecode(fragment);
  } catch {
    return { ok: false, reason: "bad-key-encoding" };
  }
  if (buf.length !== 44) return { ok: false, reason: "bad-key-length" }; // 32+12
  const key = buf.subarray(0, 32);
  const iv = buf.subarray(32, 44);

  return {
    ok: true,
    id,
    key,
    iv,
    baseUrl: `${parsed.protocol}//${parsed.host}`,
  };
}

module.exports = { build, parse, isValidHttpUrl };
