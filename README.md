# BurnLink CLI

Zero-knowledge, self-destructing file sharing from your terminal.

```bash
burnlink activate <key>
burnlink upload ./secrets.zip        # encrypted + uploaded + prints a link
burnlink receive <code>              # fetches + decrypts locally
```

Files are encrypted client-side with AES-256-GCM **before** anything is
uploaded. The encryption key never touches the server — it only ever
appears in the burn link's URL fragment (after `#`), which the CLI
never sends over the network. The server only ever sees ciphertext.

---

## Install (private)

This is a paid, closed-source tool. It is **not** on the public npm
registry. To install, you'll be sent a `burnlink-credentials.txt` file
or a private registry URL when you purchase a key.

```bash
# After purchase — example for a private registry:
npm install -g burnlink --registry https://npm.paperfrogs.dev
burnlink activate BURNLINK-STD-XXXX-XXXX-XXXX
```

## Usage

### Activate a license
```bash
burnlink activate BURNLINK-STD-XXXX-XXXX-XXXX
burnlink status
```

### Send a file
```bash
burnlink upload ./secrets.zip
burnlink upload ./secrets.zip --expiry 1h   # 1h | 24h | 7d (default 24h)
burnlink upload ./secrets.zip --once        # burn after first read
```

Output:
```
✓ Encrypted 1.2 MB locally
✓ Uploaded ciphertext
https://burnlink.page/d/a1b2c3#f9K2...base64url-key...
```

### Receive a file
```bash
burnlink download https://burnlink.page/d/a1b2c3#f9K2... -o ./secrets.zip
```

### Inspect a link without downloading
```bash
burnlink info https://burnlink.page/d/a1b2c3#f9K2...
```

### Configuration
```bash
burnlink config get                       # show all
burnlink config get apiBaseUrl
burnlink config set apiBaseUrl https://api.burnlink.page
burnlink config set defaultExpiry 1h
```

## License

Two tiers:

| Tier   | Key format                  | Backend           |
|--------|-----------------------------|-------------------|
| Standard | `BURNLINK-STD-XXXX-XXXX-XXXX` | Locked to BurnLink's hosted backend |
| Dev      | `BURNLINK-DEV-XXXX-XXXX-XXXX` | Free to point at your own backend |

The final `XXXX` is a SHA-256-derived checksum that catches typos and
fabricated keys offline — no network call needed.

## Develop

```bash
npm install
npm test                    # run unit + e2e tests
npm run dev-server          # reference server on http://localhost:8787
node bin/burnlink.js --help
```

The `server/` directory is a zero-dependency reference backend that
matches the contract `src/api.js` expects. Use it to develop and test
the CLI locally without hitting `burnlink.page`.

## Security model

| Step                 | What the server sees                  |
|----------------------|---------------------------------------|
| Upload               | Raw ciphertext + filename (plaintext) + expiry/burn flags. Never the key. |
| Download             | Returns raw ciphertext. Never the key. |
| Info                 | Status JSON. Never the key.           |

The decryption key lives only in:
- The user's terminal while they're running the CLI
- The burn link's URL `#fragment` (which browsers/curl never send)

A compromised server cannot decrypt past files.

## License (proprietary)

Proprietary, all rights reserved. See `LICENSE`.
