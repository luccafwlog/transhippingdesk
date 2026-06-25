#!/bin/sh
# Pinned, checksum-verified installer for the no-mistakes git gate.
#
# Works in both Claude Code cloud (ephemeral container, re-runs each session)
# and local. Downloads a PINNED release artifact and verifies it against the
# committed checksums file before use - it does not pipe remote code to a shell.
#
# To upgrade: bump NM_VERSION, replace scripts/no-mistakes/checksums-<ver>.txt
# with the matching official checksums.txt, and commit both.
#
# ponytail: best-effort. If the release host is unreachable or the checksum
# does not match, the gate is skipped for this session rather than aborting.
set -eu

NM_VERSION="v1.30.1"
REPO="kunchenguid/no-mistakes"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKSUMS="$SCRIPT_DIR/checksums-$NM_VERSION.txt"

INSTALL_DIR="$HOME/.no-mistakes/bin"
BIN_PATH="$INSTALL_DIR/no-mistakes"
LINK_DIR="$HOME/.local/bin"
LINK_PATH="$LINK_DIR/no-mistakes"

log() { printf 'no-mistakes: %s\n' "$1" >&2; }

# Already installed at the pinned version? Nothing to do.
if [ -x "$BIN_PATH" ] && "$BIN_PATH" --version 2>/dev/null | grep -q "$NM_VERSION"; then
  exit 0
fi

[ -f "$CHECKSUMS" ] || { log "missing $CHECKSUMS; skipping"; exit 0; }

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) log "unsupported arch $ARCH; skipping"; exit 0 ;;
esac
case "$OS" in
  darwin|linux) ;;
  *) log "unsupported OS $OS; skipping"; exit 0 ;;
esac

FILENAME="no-mistakes-$NM_VERSION-$OS-$ARCH.tar.gz"
EXPECTED="$(grep " $FILENAME\$" "$CHECKSUMS" | awk '{print $1}')"
[ -n "$EXPECTED" ] || { log "no checksum for $FILENAME; skipping"; exit 0; }

URL="https://github.com/$REPO/releases/download/$NM_VERSION/$FILENAME"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! curl -fsSL "$URL" -o "$TMP/$FILENAME"; then
  log "download failed ($URL); skipping"
  exit 0
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP/$FILENAME" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "$TMP/$FILENAME" | awk '{print $1}')"
fi
if [ "$ACTUAL" != "$EXPECTED" ]; then
  log "checksum mismatch for $FILENAME; refusing to install"
  exit 0
fi

tar xzf "$TMP/$FILENAME" -C "$TMP"
mkdir -p "$INSTALL_DIR" "$LINK_DIR"
mv "$TMP/no-mistakes" "$BIN_PATH"
chmod 755 "$BIN_PATH" 2>/dev/null || true
ln -sf "$BIN_PATH" "$LINK_PATH"
log "$NM_VERSION installed (checksum verified)"
exit 0
