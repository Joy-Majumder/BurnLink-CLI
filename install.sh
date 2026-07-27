#!/usr/bin/env bash
# BurnLink CLI installer — macOS / Linux
# Usage: curl -fsSL https://burnlink.page/install.sh | sh
#
# Detects OS + architecture, downloads the matching release tarball
# from GitHub Releases, verifies SHA256, and installs the binary to
# ~/.burnlink/bin/burnlink (with the directory added to PATH for the
# current shell session via a shell-rc snippet).

set -euo pipefail

REPO="${BURNLINK_REPO:-Joy-Majumder/BurnLink-CLI}"
INSTALL_DIR="${BURNLINK_INSTALL_DIR:-$HOME/.burnlink/bin}"
BIN_NAME="burnlink"

log() { printf '\033[1;34m[burnlink]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[burnlink]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. detect OS + arch ----------------------------------------------------
uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
  Darwin) platform="macos" ;;
  Linux)  platform="linux" ;;
  *) fail "Unsupported OS: $uname_s (Windows: use install.ps1)" ;;
esac

case "$uname_m" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) fail "Unsupported architecture: $uname_m" ;;
esac

archive_name="burnlink-${platform}-${arch}.tar.gz"
log "detected ${platform}/${arch}"

# --- 2. fetch latest release tag --------------------------------------------
log "fetching latest release..."
release_json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"
tag="$(printf '%s' "$release_json" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$tag" ] || fail "could not determine latest release"
log "latest version: $tag"

# --- 3. download + verify ---------------------------------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

base_url="https://github.com/${REPO}/releases/download/${tag}"
log "downloading $archive_name..."
curl -fsSL -o "$tmp/$archive_name" "$base_url/$archive_name"

sha_url="$base_url/SHA256SUMS"
if curl -fsSL -o "$tmp/SHA256SUMS" "$sha_url" 2>/dev/null; then
  expected="$(grep -E " ${archive_name}\$" "$tmp/SHA256SUMS" | awk '{print $1}' || true)"
  if [ -n "$expected" ]; then
    actual="$(shasum -a 256 "$tmp/$archive_name" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || fail "checksum mismatch (expected $expected, got $actual)"
    log "checksum verified"
  else
    log "WARNING: $archive_name not in SHA256SUMS, skipping verification"
  fi
else
  log "WARNING: SHA256SUMS not available, skipping verification"
fi

# --- 4. extract + install ----------------------------------------------------
mkdir -p "$INSTALL_DIR"
tar -xzf "$tmp/$archive_name" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/$BIN_NAME"
log "installed → $INSTALL_DIR/$BIN_NAME"

# --- 5. PATH hint -----------------------------------------------------------
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    rc_file=""
    if [ -n "${SHELL:-}" ] && [[ "$SHELL" == *zsh ]]; then
      rc_file="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      rc_file="$HOME/.bashrc"
    elif [ -f "$HOME/.profile" ]; then
      rc_file="$HOME/.profile"
    fi
    if [ -n "$rc_file" ]; then
      printf '\n# BurnLink CLI\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$rc_file"
      log "added $INSTALL_DIR to PATH in $rc_file (restart shell or: source $rc_file)"
    else
      log "add $INSTALL_DIR to your PATH to use '$BIN_NAME'"
    fi
    ;;
esac

log "done. run: $BIN_NAME --version"