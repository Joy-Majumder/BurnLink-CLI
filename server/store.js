// In-memory store for the reference server.
// Mirrors what the production BurnLink backend should expose at
//   POST /api/cli/upload
//   GET  /api/cli/object/:id
//   GET  /api/cli/info/:id
//
// Holds ciphertext only — server cannot decrypt anything.

"use strict";

const crypto = require("node:crypto");

const EXPIRY_MAP = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function newId() {
  return crypto.randomBytes(9).toString("base64url");
}

function createStore({ now = () => Date.now(), onExpire } = {}) {
  const items = new Map();

  function put({ ciphertext, name, expiry, burnAfterRead }) {
    const ttl = EXPIRY_MAP[expiry] || EXPIRY_MAP["24h"];
    const id = newId();
    const expiresAt = new Date(now() + ttl).toISOString();
    items.set(id, {
      id,
      ciphertext,
      name,
      burnAfterRead: !!burnAfterRead,
      createdAt: now(),
      expiresAt,
      timer: setTimeout(() => {
        items.delete(id);
        if (onExpire) onExpire(id);
      }, ttl),
    });
    return { id, expiresAt };
  }

  function get(id) {
    return items.get(id) || null;
  }

  // Returns ciphertext once, then deletes if burnAfterRead is true.
  function burn(id) {
    const item = items.get(id);
    if (!item) return null;
    if (item.burnAfterRead) {
      clearTimeout(item.timer);
      items.delete(id);
    }
    return item;
  }

  function info(id) {
    const item = items.get(id);
    if (!item) return null;
    return { expiresAt: item.expiresAt, burnAfterRead: item.burnAfterRead };
  }

  function size() {
    return items.size;
  }

  function clear() {
    for (const it of items.values()) clearTimeout(it.timer);
    items.clear();
  }

  return { put, get, burn, info, size, clear };
}

module.exports = { createStore, EXPIRY_MAP };
