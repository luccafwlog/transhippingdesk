# Plan 003: Fix the portal operation returned-container filter

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 1224998..HEAD -- src/pages/PortalOperacao.tsx src/pages/__tests__/PortalOperacao.test.tsx`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1224998`, 2026-06-15

## Why this matters

The operation page has a status filter labeled "Devolvidos". A user reading
that filter expects B/Ls whose containers are all returned, but the current
predicate includes any B/L that has at least one returned container. Mixed B/Ls
with one returned container and another still in demurrage appear in the
returned filter, which can hide live operational risk.

## Current state

- `src/pages/PortalOperacao.tsx:16` defines `StatusFilter = '' | 'com_demurrage' | 'todos_devolvidos' | 'com_pendentes'`.
- `src/pages/PortalOperacao.tsx:22` maps `todos_devolvidos` to `['devolvido']`.
- `src/pages/PortalOperacao.tsx:26-29` implements `blStatusMatches()` with `containers.some(...)` for every filter.
- `src/pages/PortalOperacao.tsx:169` displays the option label `Devolvidos`.
- `src/pages/__tests__/PortalOperacao.test.tsx` has a mixed row: `BL001` has one `devolvido` container and one `em_demurrage` container.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused test | `npm test -- src/pages/__tests__/PortalOperacao.test.tsx` | file passes |
| Full tests | `npm test` | all non-skipped tests pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/pages/PortalOperacao.tsx`
- `src/pages/__tests__/PortalOperacao.test.tsx`

**Out of scope**:
- RPC or database changes.
- Renaming routes or changing page layout.
- Changing CSV export behavior beyond what is required by the filter semantics.

## Git workflow

- Branch: `codex/003-fix-portal-operacao-devolvidos-filter`
- Commit message example: `fix(portal): correct returned container filter`.

## Steps

### Step 1: Add a regression test first

Extend `src/pages/__tests__/PortalOperacao.test.tsx`:

- Use the existing `BL001` mixed row as the negative case.
- Add a third row where every container has `status: 'devolvido'`.
- Select the `Status` filter option `Devolvidos`.
- Assert the mixed `BL001` row is not present in the desktop table and the all-returned row is present.

Remember jsdom renders desktop and mobile together in this test file; keep using `desktopView(container)` and `within(desktop)`.

**Verify**: `npm test -- src/pages/__tests__/PortalOperacao.test.tsx` fails before the implementation change for the expected reason.

### Step 2: Fix the predicate

Change `blStatusMatches()` in `src/pages/PortalOperacao.tsx` so:

- `com_demurrage` remains "any container in demurrage".
- `com_pendentes` remains "any pending/non-returned container".
- `todos_devolvidos` requires at least one container and every container status to be `devolvido`.

Keep the function local; do not introduce a new abstraction unless the test becomes awkward.

**Verify**: `npm test -- src/pages/__tests__/PortalOperacao.test.tsx` passes.

### Step 3: Run full gates

**Verify**:
- `npm test` -> all non-skipped tests pass.
- `npm run lint` -> exit 0.
- `npm run build` -> exit 0.

## Test plan

The new component test must cover:

- Mixed returned+demurrage B/L is excluded by `Devolvidos`.
- All-returned B/L is included.
- Existing tests for expansion and empty containers still pass.

## Done criteria

- [ ] The `Devolvidos` filter no longer includes mixed B/Ls.
- [ ] Focused and full tests pass.
- [ ] No files outside the two in-scope files are modified.
- [ ] `plans/README.md` row 003 updated.

## STOP conditions

- Product owner clarifies that "Devolvidos" intentionally means "has any returned container".
- The test setup requires rewriting the page component or shared UI controls.

## Maintenance notes

If more operation statuses are added later, keep the semantics explicit per filter instead of mapping all filters through one `some()` predicate.
