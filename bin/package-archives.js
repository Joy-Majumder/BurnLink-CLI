#!/usr/bin/env node
// Package each built binary into a platform-appropriate archive.
// macOS / Linux → .tar.gz; Windows → .zip.
// Output files land in dist/release/ for direct upload to GitHub.
// Also writes a SHA256SUMS manifest alongside the archives.
//
// Naming convention (must stay in sync with install.sh / install.ps1):
//   burnlink-macos-x64.tar.gz
//   burnlink-macos-arm64.tar.gz
//   burnlink-linux-x64.tar.gz
//   burnlink-linux-arm64.tar.gz
//   burnlink-windows-x64.zip

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const dist = path.join(__dirname, "..", "dist");
const out = path.join(dist, "release");
fs.mkdirSync(out, { recursive: true });

const targets = [
  { src: "burnlink-macos-x64",     platform: "macos",   archive: "tar.gz", dest: "burnlink",       wrapper: "burnlink-macos-x64" },
  { src: "burnlink-macos-arm64",   platform: "macos",   archive: "tar.gz", dest: "burnlink",       wrapper: "burnlink-macos-arm64" },
  { src: "burnlink-linux-x64",     platform: "linux",   archive: "tar.gz", dest: "burnlink",       wrapper: "burnlink-linux-x64" },
  { src: "burnlink-linux-arm64",   platform: "linux",   archive: "tar.gz", dest: "burnlink",       wrapper: "burnlink-linux-arm64" },
  { src: "burnlink-win-x64.exe",     platform: "windows", archive: "zip",  dest: "burnlink.exe",   wrapper: "burnlink-windows-x64" },
];

function sh(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function stageBinary(t) {
  // Stage the binary at the top level (no wrapper subdir) so the
  // installer can extract it directly into the install dir.
  const tmpDir = path.join(dist, "stage");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const staged = path.join(tmpDir, t.dest);
  fs.copyFileSync(path.join(dist, t.src), staged);
  if (!t.dest.endsWith(".exe")) {
    fs.chmodSync(staged, 0o755);
  }
  return tmpDir;
}

function packageArchive(tmpDir, t) {
  const archiveName = `${t.wrapper}.${t.archive}`;
  const archive = path.join(out, archiveName);
  if (t.archive === "tar.gz") {
    // Transform the leading path component off so the tarball
    // contains just the binary at the root, not stage/burnlink.
    sh(`tar -czf "${archive}" -C "${tmpDir}" "${t.dest}"`);
  } else {
    sh(`cd "${tmpDir}" && zip -r "${archive}" "${t.dest}"`);
  }
  return archiveName;
}

const built = [];
for (const t of targets) {
  const src = path.join(dist, t.src);
  if (!fs.existsSync(src)) {
    console.error(`! skipping ${t.src} (not built)`);
    continue;
  }
  const tmpDir = stageBinary(t);
  const archiveName = packageArchive(tmpDir, t);
  built.push(archiveName);
  console.log(`✓ dist/release/${archiveName}`);
}

// Clean up staging tree.
fs.rmSync(path.join(dist, "stage"), { recursive: true, force: true });

// SHA256 sums for every archive.
const sums = [];
for (const f of built.sort()) {
  const full = path.join(out, f);
  const h = execSync(`shasum -a 256 "${full}"`).toString().trim();
  sums.push(h);
  fs.appendFileSync(path.join(out, f + ".sha256"), h + "\n");
}
fs.writeFileSync(path.join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`✓ dist/release/SHA256SUMS`);
