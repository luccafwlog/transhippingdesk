#!/bin/bash
set -euo pipefail

# Project root: prefer the harness-provided var, fall back to this script's path.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Install every committed skill (.claude/skills/*.skill) into the user-level
# skills dir so Claude Code discovers them in both cloud and local sessions.
# Looping over the files keeps this in sync automatically: dropping in a new
# *.skill is picked up here with no edit needed.
#
# A *.skill is one of two formats, detected by its magic bytes:
#   - a ZIP bundle holding <name>/SKILL.md (plus optional assets like LICENSE)
#   - a plain SKILL.md text file
# python3 (already a project hook dependency) unzips bundles portably.
SKILLS_DST="$HOME/.claude/skills"
mkdir -p "$SKILLS_DST"
for skill_file in "$PROJECT_DIR/.claude/skills"/*.skill; do
  [ -e "$skill_file" ] || continue
  name="$(basename "$skill_file" .skill)"
  if [ "$(head -c 2 "$skill_file")" = "PK" ]; then
    # Normalize separators: some bundles were zipped on Windows and store
    # members as "<name>\SKILL.md", which extractall would write as a literal
    # backslash filename instead of a directory.
    python3 - "$skill_file" "$SKILLS_DST" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zf:
    for member in zf.namelist():
        norm = member.replace("\\", "/")
        if norm.endswith("/"):
            continue
        target = os.path.join(dst, *norm.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(member) as fin, open(target, "wb") as fout:
            fout.write(fin.read())
PY
  else
    mkdir -p "$SKILLS_DST/$name"
    cp "$skill_file" "$SKILLS_DST/$name/SKILL.md"
  fi
done

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
