#!/usr/bin/env bash
set -euo pipefail

remote="origin"
repo="$(git rev-parse --show-toplevel)"
cd "$repo"

git fetch "$remote" --prune --prune-tags
git remote set-head "$remote" -a

default_ref="$(git symbolic-ref --short "refs/remotes/$remote/HEAD")"
[[ -n "$default_ref" ]] || { echo "Branch padrão remota não encontrada." >&2; exit 1; }
default_branch="${default_ref#*/}"

remote_branches=()
while IFS= read -r b; do remote_branches+=("$b"); done < <(
  git for-each-ref --format="%(refname:strip=3)" "refs/remotes/$remote" \
    | grep -v '^HEAD$'
)

local_branches=()
while IFS= read -r b; do local_branches+=("$b"); done < <(
  git for-each-ref --format="%(refname:strip=2)" "refs/heads"
)

worktree_data=$(git worktree list --porcelain)
worktrees=()
while IFS= read -r line; do
  if [[ $line == worktree\ * ]]; then
    current_path="${line#worktree }"
    current_branch=""
  elif [[ $line == branch\ * ]]; then
    current_branch="${line#branch refs/heads/}"
    worktrees+=("$current_path|$current_branch")
  fi
done <<< "$worktree_data"

current_branch="$(git branch --show-current)"
if [[ ! " ${remote_branches[*]} " =~ " $current_branch " ]]; then
  if git show-ref --verify --quiet "refs/heads/$default_branch"; then
    git switch "$default_branch"
  else
    git switch --track "$remote/$default_branch"
  fi
fi

for wt in "${worktrees[@]}"; do
  IFS='|' read -r wt_path wt_branch <<< "$wt"
  resolved="$(cd "$wt_path" && pwd -P)"
  repo_resolved="$(cd "$repo" && pwd -P)"
  [[ "$resolved" == "$repo_resolved" ]] && continue

  if [[ -z "$wt_branch" || ! " ${remote_branches[*]} " =~ " $wt_branch " ]]; then
    git worktree remove --force -- "$resolved"
  else
    git -C "$resolved" reset --hard "$remote/$wt_branch"
    git -C "$resolved" clean -fdx
  fi
done

for branch in "${local_branches[@]}"; do
  if [[ ! " ${remote_branches[*]} " =~ " $branch " && "$branch" != "$default_branch" ]]; then
    git branch -D -- "$branch"
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
  echo "HEAD local diferente do remoto." >&2
  exit 1
fi

git diff --exit-code "$remote/$default_branch" --
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree ainda possui alterações." >&2
  exit 1
fi

echo "Sincronização concluída: $(git rev-parse HEAD)"
