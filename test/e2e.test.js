"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { createServer, listen, close } = require("../server");
const cryptoMod = require("../src/crypto");
const linkMod = require("../src/link");
const license = require("../src/license");
const api = require("../src/api");

// Path to the CLI binary under test.
const CLI = path.resolve(__dirname, "..", "bin", "burnlink.js");

function run(args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd || os.tmpdir(),
      env: { ...process.env, ...(env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("error", reject);
    proc.on("exit", (code) => resolve({ code, out, err }));
  });
}

// CLI prints the URL with ANSI bold codes; strip them when matching.
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

let server, url, port;

test.before(async () => {
  const created = createServer();
  server = created.server;
  const bound = await listen(server, 0);
  url = bound.url;
  port = bound.port;
});

test.after(async () => {
  await close(server);
  // Belt-and-suspenders: the in-memory store holds timers that keep the
  // event loop alive. Force exit once all tests have run.
  setImmediate(() => process.exit(0));
});

test("upload → info → download round-trips against the reference server", async () => {
  const devKey = license.generateKey(license.TIERS.DEV);
  const plaintext = Buffer.from("the quick brown fox jumps over the lazy dog");

  // Encrypt client-side (mirroring what the CLI does in `upload`).
  const { ciphertext, key, iv } = cryptoMod.encrypt(plaintext);

  // Upload via the API module.
  const { id, expiresAt } = await api.upload(ciphertext, {
    name: "fox.txt",
    expiry: "1h",
    burnAfterRead: false,
    apiBaseUrl: url,
    apiToken: null,
    licenseKey: devKey,
  });
  assert.ok(id, "got an id back");
  assert.ok(expiresAt, "got an expiresAt back");

  // Info should report burn-after-read = false.
  const meta = await api.info(id, { apiBaseUrl: url, licenseKey: devKey });
  assert.equal(meta.burnAfterRead, false);

  // Download via the API module.
  const { ciphertext: ct2 } = await api.download(id, { apiBaseUrl: url, licenseKey: devKey });
  // ct2 is iv||ct||tag; strip the iv (already known to the client).
  const decoded = cryptoMod.decrypt(ct2.subarray(cryptoMod.IV_BYTES), iv, key);
  assert.deepEqual(decoded, plaintext);
});

test("burn-after-read erases the link on first download", async () => {
  const devKey = license.generateKey(license.TIERS.DEV);
  const plaintext = Buffer.from("burn me");
  const { ciphertext, key, iv } = cryptoMod.encrypt(plaintext);

  const { id } = await api.upload(ciphertext, {
    name: "burn.bin",
    expiry: "1h",
    burnAfterRead: true,
    apiBaseUrl: url,
    licenseKey: devKey,
  });

  // First download succeeds.
  const first = await api.download(id, { apiBaseUrl: url, licenseKey: devKey });
  assert.deepEqual(
    cryptoMod.decrypt(first.ciphertext.subarray(cryptoMod.IV_BYTES), iv, key),
    plaintext,
  );

  // Second download 404s — burn-after-read fired.
  await assert.rejects(() => api.download(id, { apiBaseUrl: url, licenseKey: devKey }), (e) => {
    return e.statusCode === 404;
  });
});

test("server rejects upload without a license key header", async () => {
  const plaintext = Buffer.from("x");
  const { ciphertext } = cryptoMod.encrypt(plaintext);
  await assert.rejects(
    () =>
      api.upload(ciphertext, {
        name: "x.bin",
        expiry: "1h",
        burnAfterRead: false,
        apiBaseUrl: url,
        licenseKey: undefined,
      }),
    (e) => e.statusCode === 401,
  );
});

test("link.build + link.parse carries key in fragment, not path", () => {
  const fake = { id: "abc", key: Buffer.alloc(32, 1), iv: Buffer.alloc(12, 2) };
  const url = linkMod.build({ ...fake, baseUrl: "https://burnlink.app" });
  assert.match(url, /^https:\/\/burnlink\.app\/d\/abc#/);
  const parsed = linkMod.parse(url);
  assert.equal(parsed.id, "abc");
  assert.deepEqual(parsed.key, fake.key);
  assert.deepEqual(parsed.iv, fake.iv);
});

test("CLI binary: end-to-end spawn → upload → download", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burnlink-cli-"));
  const devKey = license.generateKey(license.TIERS.DEV);
  const src = path.join(tmp, "secret.txt");
  fs.writeFileSync(src, "from the cli spawn test");

  // Activate (writes license key into config dir).
  const activate = await run(["activate", devKey], {
    cwd: tmp,
    env: { BURNLINK_CONFIG_DIR: path.join(tmp, "cfg") },
  });
  assert.equal(activate.code, 0, `activate failed: ${activate.err}`);

  // Point CLI at the reference server.
  const cfgDir = path.join(tmp, "cfg");
  for (const [k, v] of [["apiBaseUrl", url], ["linkBaseUrl", url]]) {
    const r = await run(["config", "set", k, v], {
      cwd: tmp,
      env: { BURNLINK_CONFIG_DIR: cfgDir },
    });
    assert.equal(r.code, 0, `config set ${k} failed: ${r.err}`);
  }

  // Upload.
  const up = await run(["upload", src], {
    cwd: tmp,
    env: { BURNLINK_CONFIG_DIR: cfgDir },
  });
  assert.equal(up.code, 0, `upload failed: ${up.err}`);
  const link = stripAnsi(up.out).split("\n").find((l) => l.startsWith("http"));
  assert.ok(link, "upload printed a link");

  // Download.
  const dl = await run(["download", link, "--out", "round.bin"], {
    cwd: tmp,
    env: { BURNLINK_CONFIG_DIR: cfgDir },
  });
  assert.equal(dl.code, 0, `download failed: ${dl.err}`);
  const got = fs.readFileSync(path.join(tmp, "round.bin"), "utf8");
  assert.equal(got, "from the cli spawn test");
});