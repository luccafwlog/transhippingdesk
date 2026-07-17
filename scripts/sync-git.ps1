& {
  $ErrorActionPreference = "Stop"
  $remote = "origin"
  $repo = (git rev-parse --show-toplevel).Trim()
  Set-Location $repo

  git fetch $remote --prune --prune-tags
  git remote set-head $remote -a

  $defaultRef = (git symbolic-ref --short "refs/remotes/$remote/HEAD").Trim()
  if (-not $defaultRef) { throw "Branch padrão remota não encontrada." }
  $defaultBranch = $defaultRef.Substring($remote.Length + 1)

  $remoteBranches = @(
    git for-each-ref --format="%(refname:strip=3)" "refs/remotes/$remote" |
      Where-Object { $_ -and $_ -ne "HEAD" }
  )

  $localBranches = @(
    git for-each-ref --format="%(refname:strip=2)" "refs/heads"
  )

  $blocks = ((git worktree list --porcelain) -join "`n") -split "(?m)(?=^worktree )"
  $worktrees = foreach ($block in $blocks) {
    if (-not $block.Trim()) { continue }

    $path = (($block -split "`n" | Where-Object { $_ -like "worktree *" }) -replace "^worktree ", "").Trim()
    $branchLine = (($block -split "`n" | Where-Object { $_ -like "branch *" }) | Select-Object -First 1)
    $branch = if ($branchLine) { ($branchLine -replace "^branch refs/heads/", "").Trim() } else { $null }

    [pscustomobject]@{ Path = $path; Branch = $branch }
  }

  $currentBranch = (git branch --show-current).Trim()
  if ($currentBranch -notin $remoteBranches) {
    if (git show-ref --verify --quiet "refs/heads/$defaultBranch") {
      git switch $defaultBranch
    } else {
      git switch --track "$remote/$defaultBranch"
    }
  }

  foreach ($wt in $worktrees) {
    $resolved = [IO.Path]::GetFullPath($wt.Path)
    if ($resolved -eq [IO.Path]::GetFullPath($repo)) { continue }

    if (-not $wt.Branch -or $wt.Branch -notin $remoteBranches) {
      git worktree remove --force -- $resolved
    } else {
      git -C $resolved reset --hard "$remote/$($wt.Branch)"
      git -C $resolved clean -fdx
    }
  }

  foreach ($branch in $localBranches) {
    if ($branch -notin $remoteBranches -and $branch -ne $defaultBranch) {
      git branch -D -- $branch
    }
  }

  git worktree prune
  git switch $defaultBranch
  git reset --hard "$remote/$defaultBranch"
  git clean -fdx
  git submodule update --init --recursive
  git submodule foreach --recursive git reset --hard
  git submodule foreach --recursive git clean -fdx

  if ((git rev-parse HEAD).Trim() -ne (git rev-parse "$remote/$defaultBranch").Trim()) {
    throw "HEAD local diferente do remoto."
  }

  git diff --exit-code "$remote/$defaultBranch" --
  if (git status --porcelain) {
    throw "Working tree ainda possui alterações."
  }

  Write-Host "`nSincronização concluída: $((git rev-parse HEAD).Trim())" -ForegroundColor Green
}
