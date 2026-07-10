#!/bin/bash
set -euo pipefail

# Project root: prefer the harness-provided var, fall back to this script's path.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Install every committed skill (skills/<name>/SKILL.md) into the user-level
# skill dirs of both harnesses so they are discovered in cloud and local
# sessions. skills/ is the single source of truth; the Node installer runs the
# same on Windows/macOS/Linux and also provisions Codex's ~/.codex/skills, so a
# Claude session keeps both harnesses in sync. Codex-only sessions run the same
# script from the Codex worktree setup script. Guarded so a failure never aborts
# session start.
if command -v node >/dev/null 2>&1; then
  node "$PROJECT_DIR/scripts/skills/install-skills.mjs" || true
fi

# --- no-mistakes git gate: works in both Claude Code cloud and local ---
# Installs a PINNED, checksum-verified no-mistakes binary, then gates this repo,
# which also (re)installs the version-matched /no-mistakes agent skill. Every
# step is guarded so a network failure never aborts session start.
# Authorized by the user (see scripts/no-mistakes/).
if [ -x "$PROJECT_DIR/scripts/no-mistakes/setup.sh" ]; then
  "$PROJECT_DIR/scripts/no-mistakes/setup.sh" || true
  nm_bin="$HOME/.no-mistakes/bin/no-mistakes"
  if [ -x "$nm_bin" ] && git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1; then
    export PATH="$HOME/.local/bin:$PATH"
    # init is idempotent ("set up or refresh") and installs the /no-mistakes skill.
    ( cd "$PROJECT_DIR" && "$nm_bin" init >/dev/null 2>&1 ) || true
  fi
fi
