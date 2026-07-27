// Zero-dep reference server for BurnLink CLI tests.
// Exposes the same /api/cli/* shape the production backend will use.
// Returns ciphertext + metadata only — never plaintext.

"use strict";

const http = require("node:http");
const { createStore } = require("./store");

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limit) {
        reject(Object.assign(new Error("payload too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  res.writeHead(status, {
    "Content-Length": buf.length,
    ...headers,
  });
  res.end(buf);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });
}

function createServer({ store } = {}) {
  const s = store || createStore();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;

      // POST /upload
      // Headers: X-Original-Name, X-Expiry, X-Burn-After-Read, X-License-Key
      if (req.method === "POST" && p === "/upload") {
        const licenseKey = req.headers["x-license-key"];
        if (!licenseKey) return sendJson(res, 401, { error: "missing X-License-Key" });
        const body = await readBody(req);
        const name = req.headers["x-original-name"] || "upload.bin";
        const expiry = req.headers["x-expiry"] || "24h";
        const burn = req.headers["x-burn-after-read"] !== "false";
        const { id, expiresAt } = s.put({
          ciphertext: body,
          name,
          expiry,
          burnAfterRead: burn,
        });
        return sendJson(res, 200, { id, expiresAt });
      }

      // GET /object/:id
      if (req.method === "GET" && p.startsWith("/object/")) {
        const id = p.slice("/object/".length);
        const item = s.burn(id);
        if (!item) return sendJson(res, 404, { error: "not found or burned" });
        return send(res, 200, item.ciphertext, {
          "Content-Type": "application/octet-stream",
          "X-Expires-At": item.expiresAt,
          "X-Burn-After-Read": String(item.burnAfterRead),
        });
      }

      // GET /info/:id
      if (req.method === "GET" && p.startsWith("/info/")) {
        const id = p.slice("/info/".length);
        const meta = s.info(id);
        if (!meta) return sendJson(res, 404, { error: "not found" });
        return sendJson(res, 200, meta);
      }

      // GET /health
      if (req.method === "GET" && p === "/health") {
        return sendJson(res, 200, { ok: true, size: s.size() });
      }

      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      sendJson(res, e.statusCode || 500, { error: e.message });
    }
  });

  return { server, store: s };
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: addr.port, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

module.exports = { createServer, listen, close };
