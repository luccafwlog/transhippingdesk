#!/bin/bash
# Block destructive shell commands without explicit user override.
# Override via CLAUDE_ALLOW_DESTRUCTIVE=1.
# Uses Python tokenization to match actual command verbs, not substrings in
# quoted strings (e.g. commit messages).
set -euo pipefail

if [[ "${CLAUDE_ALLOW_DESTRUCTIVE:-0}" == "1" ]]; then
  exit 0
fi

input="$(cat)"

result="$(printf '%s' "$input" | python3 - <<'PY'
import json, sys, shlex, re

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = data.get("tool_input", {}).get("command", "")
if not cmd:
    sys.exit(0)

# Split on shell command separators to inspect each statement individually.
statements = re.split(r'\s*(?:&&|\|\||;|\|)\s*', cmd)

def tokens_of(stmt):
    try:
        return shlex.split(stmt, comments=False, posix=True)
    except ValueError:
        return stmt.split()

def check(stmt):
    toks = tokens_of(stmt)
    if not toks:
        return None
    # strip env assignments like FOO=bar
    i = 0
    while i < len(toks) and re.match(r'^[A-Z_][A-Z0-9_]*=', toks[i]):
        i += 1
    toks = toks[i:]
    if not toks:
        return None
    head = toks[0]
    rest = toks[1:]

    if head == "rm" and any(t in ("-rf", "-fr", "-r", "-f") or t.startswith("-rf") for t in rest):
        # only block if target looks like / ~ or $HOME
        for t in rest:
            if t in ("/", "~", "$HOME") or t.startswith("/") and len(t) <= 3:
                return "rm -rf root/home target"
        return None

    if head == "git":
        sub = rest[0] if rest else ""
        flags = rest[1:]
        if sub == "push" and any(f in ("--force", "-f", "--force-with-lease") for f in flags):
            return "git force push"
        if sub == "reset" and "--hard" in flags:
            return "git reset --hard"
        if sub == "clean" and any(re.match(r'^-[a-z]*f[a-z]*$', f) for f in flags):
            return "git clean -f"
        if sub == "branch" and "-D" in flags:
            return "git branch -D"
        return None

    if head == "supabase" and rest[:2] == ["db", "reset"]:
        return "supabase db reset"

    if head in ("npm", "pnpm", "yarn", "bun"):
        sub = rest[0] if rest else ""
        if sub in ("install", "i", "add", "uninstall", "remove", "rm"):
            return "dependency change"

    return None

for stmt in statements:
    reason = check(stmt.strip())
    if reason:
        print(f"BLOCKED|{reason}|{stmt.strip()}")
        sys.exit(0)
PY
)"

if [[ -n "$result" ]]; then
  IFS='|' read -r tag reason stmt <<< "$result"
  echo "BLOCKED destructive command: $reason" >&2
  echo "Statement: $stmt" >&2
  echo "If intentional, set CLAUDE_ALLOW_DESTRUCTIVE=1 and retry." >&2
  exit 2
fi

exit 0
