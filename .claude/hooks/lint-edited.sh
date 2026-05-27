#!/bin/bash
# After an Edit/Write to a TS/TSX file, run eslint --fix on it. Best-effort, non-blocking.
set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); ti=d.get("tool_input",{}); print(ti.get("file_path") or ti.get("path") or "")' 2>/dev/null || true)"

if [[ -z "$file_path" ]]; then
  exit 0
fi

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx)
    cd "$CLAUDE_PROJECT_DIR" || exit 0
    if [[ -x "node_modules/.bin/eslint" ]]; then
      output="$(node_modules/.bin/eslint --fix "$file_path" 2>&1 || true)"
      if [[ -n "$output" ]]; then
        echo "[eslint] $file_path" >&2
        echo "$output" >&2
      fi
    fi
    ;;
esac

exit 0
