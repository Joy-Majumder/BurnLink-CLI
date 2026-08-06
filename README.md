# BurnLink CLI

Zero-knowledge, self-destructing file sharing from your terminal.

```bash
burnlink activate <key>
burnlink upload ./secrets.zip          # encrypted + uploaded + prints a link
burnlink download <url>                # fetches + decrypts locally
```

Files are encrypted client-side with AES-256-GCM **before** anything is
uploaded. The encryption key never touches the server — it only ever
appears in the burn link's URL fragment (after `#`), which the CLI
never sends over the network. The server only ever sees ciphertext.

Burn-after-read deletes the payload from the server after the first
successful download, so the link self-destructs.

---

## Install

```bash
npm install -g burnlink
```

If you purchased a key before this open-source release, you already
have a working CLI installed. The new public package is fully
backward-compatible with existing keys.

## Quick start

### 1. Get a license key

You need a license key to use hosted BurnLink. Two ways to get one:

- **Buy one** at [burnlink.page](https://burnlink.page) — you'll be
  emailed a key like `BURNLINK-STD-XXXX-XXXX-XXXX`.
- **Mint your own DEV key** (free, for development against your own
  backend) — see [Generate a license key](#generate-a-license-key)
  below.

### 2. Activate it

```bash
burnlink activate BURNLINK-STD-XXXX-XXXX-XXXX
burnlink status
```

### 3. Send a file

```bash
burnlink upload ./secrets.zip
```

Output:

```
[ok] encrypted 1234567 bytes locally
[ok] burn link ready (expires 2026-08-07T13:42:00.000Z)
https://burnlink.page/d/a1b2c3d4e5f6#f9K2...base64url-key...
```

Share the entire URL — the `#` fragment is the decryption key, and
the part before `#` is just the lookup handle.

### 4. Receive a file

```bash
burnlink download https://burnlink.page/d/a1b2c3d4e5f6#f9K2... -o ./secrets.zip
```

The CLI decrypts locally; the decryption key never leaves your
machine.

### 5. Inspect a link without burning it

```bash
burnlink info https://burnlink.page/d/a1b2c3d4e5f6#f9K2...
```

Prints the expiry, burn-after-read flag, and original filename.

---

## Commands

### activate `<key>`

Register a license key. The key is verified offline against the
bundled issuer public key (Ed25519) before being saved to your local
config. A typoed or fabricated key is rejected with no network call.

```bash
burnlink activate BURNLINK-STD-XXXX-XXXX-XXXX
```

### status

Print the active license tier, the API endpoint, and the link base
URL.

```bash
burnlink status
```

### deactivate

Remove the active license from local config. Doesn't make any
network call.

```bash
burnlink deactivate
```

### upload `<file>`

Encrypt the file client-side (AES-256-GCM, random 256-bit key,
random 12-byte IV) and upload the ciphertext to the server. Prints
the burn link on success.

```bash
burnlink upload ./secrets.zip
burnlink upload ./secrets.zip --expiry 1h   # 1h | 24h | 7d (default 24h)
burnlink upload ./secrets.zip --once        # burn after first read
burnlink upload ./secrets.zip --burn-after-read false   # don't burn
```

Flags:

- `--expiry <1h|24h|7d>` — how long the server keeps the ciphertext.
  Defaults to the value of `config.defaultExpiry`, which itself
  defaults to `24h`.
- `--once` — shorthand for `--burn-after-read true` (the default).
- `--burn-after-read <true|false>` — whether the server deletes the
  ciphertext after the first successful download. Accepts
  `true|false|yes|no|1|0|on|off`.

### download `<url>`

Fetch the ciphertext for a burn link and decrypt it locally. Use
`--out` to control where the file is written; otherwise the file
is written to the current working directory under the original
filename (or, if the server doesn't know the original name, under
the id with a `.bin` extension).

```bash
burnlink download https://burnlink.page/d/a1b2c3d4e5f6#f9K2... -o ./secrets.zip
```

### info `<id|url>`

Print metadata for a link without burning it. Accepts either a
full URL or a bare 12-character id.

```bash
burnlink info https://burnlink.page/d/a1b2c3d4e5f6#f9K2...
burnlink info a1b2c3d4e5f6
```

### config

```bash
burnlink config get                       # show all config
burnlink config get apiBaseUrl            # show one key
burnlink config set apiBaseUrl https://api.burnlink.page
burnlink config set defaultExpiry 1h
```

Accepted keys:

- `licenseKey` — managed by `activate` / `deactivate`, not by
  `config set`.
- `apiBaseUrl` — the API root the CLI talks to. Defaults to
  `https://burnlink.page/api/cli`. STD licenses cannot override
  this; DEV licenses can.
- `linkBaseUrl` — the URL prefix used to build the human-readable
  burn link. Defaults to `https://burnlink.page`. Same STD/DEV
  restriction as `apiBaseUrl`.
- `defaultExpiry` — one of `1h`, `24h`, `7d`. Used when
  `--expiry` is not passed to `upload`.
- `apiToken` — optional bearer token. Currently unused by the
  hosted backend; reserved for self-hosted setups.
- `licenseServerUrl` — optional remote revocation/expiry check.
  Currently unused; reserved for a future license-server endpoint.

### uninstall

Removes the CLI. Handles both npm and tarball installations.

```bash
burnlink uninstall             # interactive
burnlink uninstall --yes       # skip the confirmation prompt
```

### help / version

```bash
burnlink help
burnlink version
```

---

## Generate a license key

`gen-key` is a **maintainer-only** command — it mints signed license
keys. It is excluded from the published npm package because the
signing key (`keys/issuer.key`) only exists on the maintainer's
machine.

For end users, this means: **you cannot run `burnlink gen-key` from
your installed CLI.** Buy a key from [burnlink.page](https://burnlink.page)
instead.

If you are the maintainer (or building your own self-hosted backend
and want to mint your own keys), the `gen-key` command lives in the
development-only script:

```bash
# from the BurnLink-CLI repo:
git clone https://github.com/paperfrogs-hq/BurnLink-CLI.git
cd BurnLink-CLI
npm install

# Generate a DEV key (no prerequisites; you can mint DEV keys freely).
node bin/gen-key-dev.js DEV

# Generate a STD key (requires an active DEV key in your config).
node bin/gen-key-dev.js STD
```

The output is a signed key like `BURNLINK-DEV-XXXX-XXXX-CCCC.SigB64`.

Key format:

```
BURNLINK-<TIER>-<GROUP1>-<GROUP2>-<CHECKSUM>.<SIGNATURE>
```

- `TIER` — `STD` (Standard) or `DEV` (Developer).
- `GROUP1`, `GROUP2` — 4-character uppercase groups, generated
  from a 32-symbol alphabet.
- `CHECKSUM` — first 4 hex chars of `SHA-256(tier:group1-group2)`.
  Catches typos and fabricated keys offline.
- `SIGNATURE` — base64url Ed25519 signature of the body before the
  dot, made with the BurnLink issuer private key.

---

## Configuration file

The CLI stores its config under the OS-standard user-config path:

- macOS/Linux: `$XDG_CONFIG_HOME/burnlink/config.json` (default
  `~/.config/burnlink/config.json`)
- Windows: `%APPDATA%\burnlink\config.json`

Override with the `BURNLINK_CONFIG_DIR` environment variable.

The file is created with mode 0600 (owner read/write only).

---

## Security model

| Step                 | What the server sees                                |
|----------------------|-----------------------------------------------------|
| Upload               | Raw ciphertext + filename (plaintext) + expiry/burn flags. Never the key. |
| Download             | Returns raw ciphertext. Never the key.              |
| Info                 | Status JSON. Never the key.                         |

The decryption key lives only in:

- The user's terminal while they're running the CLI.
- The burn link's URL `#fragment` (which browsers/curl never send).

A compromised server cannot decrypt past files.

The issuer public key is bundled into the CLI binary at build time
(`src/issuer-pub.js`). It is used to verify the Ed25519 signature
on a license key before the key is accepted. There is no network
call to verify a key — a forged key is rejected offline.

---

## Develop

```bash
git clone https://github.com/paperfrogs-hq/BurnLink-CLI.git
cd BurnLink-CLI
npm install

npm test                    # unit tests (run offline)
npm run dev-server          # reference server on http://localhost:3000
node bin/burnlink.js --help
node bin/gen-key-dev.js DEV # mint a DEV key against the bundled signer
```

The `server/` directory is a zero-dependency reference backend that
mirrors the contract `src/api.js` expects. Use it to develop and
test the CLI locally without hitting `burnlink.page`.

To run the optional end-to-end suite (requires the local server +
signing key):

```bash
BURNLINK_RUN_E2E=1 npm test
```

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright (c) 2026 Joy G. Majumdar (Paperfrogs HQ).
