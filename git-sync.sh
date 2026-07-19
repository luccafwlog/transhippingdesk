#!/usr/bin/env bash
set -euo pipefail

_contains() { local e; for e in "${@:2}"; do [[ "$e" == "$1" ]] && return 0; done; return 1; }

remote="${1:-origin}"
repo="$(git rev-parse --show-toplevel)"

git fetch "$remote" --prune --prune-tags
git remote set-head "$remote" --auto >/dev/null 2>&1 || true

default_ref="$(git symbolic-ref --short "refs/remotes/$remote/HEAD" 2>/dev/null)" || {
  echo "Default remote branch not found." >&2
  exit 1
}
default_branch="${default_ref#"$remote/"}"
current_branch="$(git branch --show-current)"

remote_branches=()
while IFS= read -r b; do
  [[ -n "$b" && "$b" != "HEAD" ]] && remote_branches+=("$b")
done < <(git for-each-ref --format="%(refname:strip=3)" "refs/remotes/$remote")

local_branches=()
while IFS= read -r b; do
  [[ -n "$b" ]] && local_branches+=("$b")
done < <(git for-each-ref --format="%(refname:strip=2)" "refs/heads")

# worktree list (porcelain)
worktree_data="$(git worktree list --porcelain)"
worktrees=()
while IFS= read -r line; do
  if [[ "$line" == worktree\ * ]]; then
    wt_path="${line#worktree }"
  elif [[ "$line" == branch\ refs/heads/* ]]; then
    wt_branch="${line#branch refs/heads/}"
    worktrees+=("$wt_path|$wt_branch")
  fi
done <<< "$worktree_data"

# switch to default if current branch is stale
if ! _contains "$current_branch" "${remote_branches[@]}"; then
  if git show-ref --verify --quiet "refs/heads/$default_branch"; then
    git switch "$default_branch"
  else
    git switch --track "$remote/$default_branch"
  fi
fi

# manage worktrees
for wt in "${worktrees[@]}"; do
  wt_path="${wt%%|*}"
  wt_branch="${wt##*|}"
  resolved="$(cd "$wt_path" && pwd -P)"

  [[ "$resolved" == "$repo" ]] && continue

  if [[ -z "$wt_branch" ]] || ! _contains "$wt_branch" "${remote_branches[@]}"; then
    git worktree remove --force "$resolved"
  else
    git -C "$resolved" reset --hard "$remote/$wt_branch"
    git -C "$resolved" clean -fdx
  fi
done

# delete local branches missing on remote (except default)
for branch in "${local_branches[@]}"; do
  if ! _contains "$branch" "${remote_branches[@]}" && [[ "$branch" != "$default_branch" ]]; then
    git branch -D "$branch"
  fi
done

git worktree prune
git switch "$default_branch"
git reset --hard "$remote/$default_branch"
git clean -fdx
git submodule update --init --recursive
git submodule foreach --recursive git reset --hard
git submodule foreach --recursive git clean -fdx

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$remote/$default_branch")" ]]; then
  echo "Local HEAD differs from remote." >&2
  exit 1
fi

git diff --exit-code "$remote/$default_branch" --
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree still has changes." >&2
  exit 1
fi

echo "Sync complete: $(git rev-parse HEAD)"
