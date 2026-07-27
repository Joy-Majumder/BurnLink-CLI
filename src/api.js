// HTTP client for the BurnLink backend.
//
// Wire format:
//   POST  {apiBaseUrl}/upload          body: raw ciphertext bytes (iv||ct||tag)
//        Content-Type: application/octet-stream
//        headers: X-License-Key, X-Original-Name, X-Expiry, X-Burn-After-Read
//        response: { id, expiresAt }
//   GET   {apiBaseUrl}/object/:id
//        response: { payload: <base64url(iv||ct||tag)>, expiresAt, burnAfterRead }
//        (JSON envelope keeps bytes ASCII-safe through Netlify Edge, which
//         replaces non-UTF-8 sequences in raw responses with U+FFFD.)
//   GET   {apiBaseUrl}/info/:id        response: { expiresAt, burnAfterRead }

"use strict";

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");
const { b64urlDecode } = require("./crypto");

const VALID_EXPIRY = new Set(["1h", "24h", "7d"]);

function _request(opts) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(opts.url);
    } catch (e) {
      reject(new Error(`bad URL: ${opts.url}`));
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: opts.method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: opts.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

class ApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
  }
}

async function upload(ciphertext, opts) {
  const { name, expiry, burnAfterRead, apiBaseUrl, apiToken, licenseKey } = opts || {};
  if (!Buffer.isBuffer(ciphertext)) throw new Error("ciphertext must be a Buffer");
  if (!VALID_EXPIRY.has(expiry)) {
    throw new Error(`expiry must be one of: ${[...VALID_EXPIRY].join(", ")}`);
  }
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-License-Key": licenseKey || "",
    "X-Original-Name": name || "upload.bin",
    "X-Expiry": expiry,
    "X-Burn-After-Read": burnAfterRead ? "true" : "false",
    "Content-Length": ciphertext.length,
  };
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  const res = await _request({
    method: "POST",
    url: `${(apiBaseUrl || "").replace(/\/+$/, "")}/upload`,
    headers,
    body: ciphertext,
  });
  if (res.statusCode === 401) throw new ApiError("missing or invalid X-License-Key", 401, res.body);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new ApiError(
      `upload failed (${res.statusCode})`,
      res.statusCode,
      res.body
    );
  }
  let json;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new ApiError("upload returned non-JSON", res.statusCode, res.body);
  }
  if (!json.id) throw new ApiError("upload response missing id", res.statusCode, res.body);
  return { id: json.id, expiresAt: json.expiresAt };
}

async function download(id, opts) {
  const { apiBaseUrl, apiToken, licenseKey } = opts || {};
  const headers = {
    "X-License-Key": licenseKey || "",
    Accept: "application/json",
  };
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  const res = await _request({
    method: "GET",
    url: `${(apiBaseUrl || "").replace(/\/+$/, "")}/object/${encodeURIComponent(id)}`,
    headers,
  });
  if (res.statusCode === 404) {
    throw new ApiError("not found or burned", 404, res.body);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new ApiError(`object failed (${res.statusCode})`, res.statusCode, res.body);
  }
  let json;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new ApiError("object returned non-JSON", res.statusCode, res.body);
  }
  if (!json || typeof json.payload !== "string") {
    throw new ApiError("object missing payload", res.statusCode, res.body);
  }
  let ciphertext;
  try {
    ciphertext = b64urlDecode(json.payload);
  } catch (e) {
    throw new ApiError("payload not base64url", res.statusCode, res.body);
  }
  return {
    ciphertext,
    expiresAt: json.expiresAt || null,
    burnAfterRead: !!json.burnAfterRead,
  };
}

async function info(id, opts) {
  const { apiBaseUrl, apiToken, licenseKey } = opts || {};
  const headers = { "X-License-Key": licenseKey || "" };
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  const res = await _request({
    method: "GET",
    url: `${(apiBaseUrl || "").replace(/\/+$/, "")}/info/${encodeURIComponent(id)}`,
    headers,
  });
  if (res.statusCode === 404) {
    throw new ApiError("not found", 404, res.body);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new ApiError(`info failed (${res.statusCode})`, res.statusCode, res.body);
  }
  let json;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new ApiError("info returned non-JSON", res.statusCode, res.body);
  }
  return {
    expiresAt: json.expiresAt,
    burnAfterRead: !!json.burnAfterRead,
  };
}

module.exports = { upload, download, info, ApiError, VALID_EXPIRY };
