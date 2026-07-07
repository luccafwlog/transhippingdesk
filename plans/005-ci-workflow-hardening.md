# Plan 005: Harden GitHub Actions — least-privilege token and pinned deploy tooling

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a894c5d..HEAD -- .github/workflows`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a894c5d`, 2026-07-07

## Why this matters

Neither workflow declares a `permissions:` block, so every job runs with the
repository's default `GITHUB_TOKEN` scope (write-all on many repos) even
though CI only builds/tests and deploy authenticates to Firebase with a
separate service account. Worse, the deploy step runs
`npx firebase-tools@latest` — an unpinned package resolved at deploy time —
*after* the Firebase service-account key has been written to disk. A
malicious `firebase-tools` release would execute with production hosting
credentials in hand. Pinning and least-privilege shrink the blast radius of
any compromised dependency or action to near zero, at zero functional cost.

## Current state

- `.github/workflows/ci.yml` — PR checks (docs:check, lint, build, test).
  No `permissions:` key anywhere in the file. Uses `actions/checkout@v4`,
  `actions/setup-node@v4`. Build consumes `secrets.VITE_SUPABASE_URL` /
  `secrets.VITE_SUPABASE_ANON_KEY` (public-by-design values; fine).
- `.github/workflows/firebase-deploy.yml` — deploy on push to `main`.
  No `permissions:` key. Deploy step today (lines 29–37):

  ```yaml
  - name: Deploy to Firebase Hosting
    env:
      GOOGLE_APPLICATION_CREDENTIALS: /tmp/firebase-sa.json
    run: |
      echo '${{ secrets.FIREBASE_SERVICE_ACCOUNT_IMPORTMANAGER_BDA3E }}' > /tmp/firebase-sa.json
      npx firebase-tools@latest deploy --only hosting:transhippingdesk \
        --project importmanager-bda3e \
        --non-interactive
  ```

- Both workflows trigger safely (`pull_request`, not `pull_request_target`);
  no `${{ github.event.* }}` interpolation in `run:` steps. Those are fine —
  don't restructure them.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| YAML sanity | `node -e "const y=require('js-yaml');['ci','firebase-deploy'].forEach(f=>y.load(require('fs').readFileSync('.github/workflows/'+f+'.yml','utf8')));console.log('ok')"` | prints `ok` (js-yaml is available transitively; if not, fall back to careful visual diff) |
| Docs check | `npm run docs:check` | exit 0 |

Workflow changes cannot be fully verified locally; the real gate is the next
CI run. Note that in your report.

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml`
- `.github/workflows/firebase-deploy.yml`
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Workflow triggers, job structure, build/test steps, secret names.
- Repository settings (default token permissions, environments) — dashboard
  actions; mention in report only.
- Pinning `actions/checkout` / `actions/setup-node` to commit SHAs — optional
  hardening explicitly deferred (first-party actions, low risk, high churn).

## Git workflow

- Branch: use the branch the operator designates (or `advisor/005-ci-workflow-hardening`).
- Commit message style: `fix(security): permissions minimas e firebase-tools pinado nos workflows`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Least-privilege token in both workflows

Add at the top level (below `name:`, above `on:` or `jobs:`) of BOTH files:

```yaml
permissions:
  contents: read
```

**Verify**: `grep -A1 "^permissions:" .github/workflows/ci.yml .github/workflows/firebase-deploy.yml` → both show `contents: read`.

### Step 2: Pin `firebase-tools`

1. Determine the current stable major version:
   `npm view firebase-tools version` → note the exact version (e.g. `14.x.y`).
2. In `firebase-deploy.yml`, replace `npx firebase-tools@latest` with
   `npx firebase-tools@<that exact version>`.

**Verify**: `grep -n "firebase-tools@" .github/workflows/firebase-deploy.yml` → shows a fixed `x.y.z` version, no `latest`.

### Step 3: Report residual items

Include in your completion report (operator/dashboard items, not repo
changes): (a) confirm the org/repo default workflow token permission is
"read-only" in Settings → Actions; (b) the first post-merge deploy run is the
real verification — watch it; (c) `firebase-tools` now needs an occasional
manual version bump (suggest checking on dependency-update passes).

## Test plan

- No unit tests apply. Verification is the greps above plus the next CI run
  on the PR (CI workflow exercises itself) and the first deploy after merge.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Both workflows contain a top-level `permissions: contents: read`
- [ ] `grep -c "@latest" .github/workflows/firebase-deploy.yml` → 0 matches (exit 1)
- [ ] `npm run docs:check` exits 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated; residual-items note in report

## STOP conditions

Stop and report back (do not improvise) if:

- The deploy step no longer matches the "Current state" excerpt (drift).
- You discover any step in either workflow that actually writes to the repo
  via `GITHUB_TOKEN` (e.g. a comment/annotation action added later) — it
  would break under `contents: read`; report which permission it needs
  instead of granting write-all.
- `npm view firebase-tools version` is unreachable in your environment —
  STOP and ask the operator for the version to pin rather than guessing.

## Maintenance notes

- When a future workflow step needs more scope (e.g. posting PR comments),
  grant the single scope on that job (`permissions: { pull-requests: write }`),
  not a global write.
- Reviewer should scrutinize: YAML indentation of the new `permissions:`
  block (top-level, not nested under `on:`), and that the pinned version is
  a real published version.
- Deferred: SHA-pinning first-party actions; a scheduled workflow to bump the
  pinned firebase-tools version.
