# Plan 001: Upgrade vulnerable Vite toolchain

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 1224998..HEAD -- package.json package-lock.json vite.config.ts .github/workflows/ci.yml`
> If any in-scope file changed since this plan was written, compare the
> Current state excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1224998`, 2026-06-15

## Why this matters

`npm audit --json` reports a high-severity Vite advisory in the locked dev
server/build toolchain. The app is developed on Windows and Vite is used for
local development, preview, Vitest, and production builds, so this is worth
closing even though it is not a runtime browser dependency. The same audit run
also reports a low-severity `@babel/core` advisory that should disappear as a
transitive update once the Vite/plugin toolchain is refreshed.

## Current state

- `package.json` defines the relevant commands and dev dependencies:
  - `package.json:10` has `"build": "tsc -b && vite build"`.
  - `package.json:12` has `"test": "vitest run"`.
  - `package.json:48` has `"vite": "^8.0.4"`.
  - `package.json:49` has `"vitest": "^4.1.4"`.
- `package-lock.json` locks vulnerable versions:
  - `package-lock.json:122` locks `@babel/core` at `7.29.0`.
  - `package-lock.json:4137` locks `vite`.
  - `package-lock.json:4139` resolves `vite-8.0.8.tgz`.
- Baseline audit output:
  - `vite` high: `vite: server.fs.deny bypass on Windows alternate paths`, affected `>=8.0.0 <=8.0.15`.
  - `vite` moderate: `launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows`, affected `>=8.0.0 <=8.0.15`.
  - `@babel/core` low: arbitrary file read via `sourceMappingURL`, affected `<=7.29.0`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install/update | `npm update vite @vitejs/plugin-react vitest @babel/core` | exit 0; lockfile updated |
| Security check | `npm audit --audit-level=high` | exit 0 |
| Tests | `npm test` | all non-skipped tests pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `package.json`
- `package-lock.json`

**Out of scope**:
- Source changes under `src/`.
- Vite config behavior changes in `vite.config.ts` unless the upgrade requires an explicit compatibility fix. If that happens, STOP and report.
- GitHub workflow changes.

## Git workflow

- Branch: `codex/001-upgrade-vite-toolchain`
- Commit message style: match repo history with a short conventional message, e.g. `fix(security): upgrade vulnerable vite toolchain`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Refresh the locked toolchain

Run `npm update vite @vitejs/plugin-react vitest @babel/core`.

Do not use `npm audit fix --force`; it may jump major versions or rewrite more
than needed.

**Verify**: `rg -n '"vite"|node_modules/vite|node_modules/@babel/core' package-lock.json package.json` -> shows `vite` above `8.0.15` and `@babel/core` above `7.29.0`.

### Step 2: Confirm audit is clean for high severity

Run `npm audit --audit-level=high`.

**Verify**: command exits 0. If low-severity `@babel/core` remains, try one targeted `npm update @babel/core`; if it still remains, keep the plan scoped to the high Vite advisory and note the remaining low item in `plans/README.md`.

### Step 3: Run the app verification gates

Run the standard project checks.

**Verify**:
- `npm test` -> all non-skipped tests pass.
- `npm run lint` -> exit 0.
- `npm run build` -> exit 0.

## Test plan

No new tests are required; this is a dependency security update. The regression guard is the existing Vitest, lint, and build suite.

## Done criteria

- [ ] `npm audit --audit-level=high` exits 0.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Only `package.json` and/or `package-lock.json` changed.
- [ ] `plans/README.md` row 001 updated.

## STOP conditions

- The update requires editing `vite.config.ts` or source code.
- `npm update` changes unrelated major framework versions.
- Build/test failures remain after one targeted compatibility adjustment.

## Maintenance notes

Watch Vite and Vitest together in future upgrades because Vitest depends on Vite internally. Reviewers should check that no generated `dist/` files are committed.
