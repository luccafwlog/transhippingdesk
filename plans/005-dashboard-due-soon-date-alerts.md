# Plan 005: Make dashboard due-soon alerts date-based

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 1224998..HEAD -- src/pages/PortalDashboard.tsx src/pages/__tests__`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1224998`, 2026-06-15

## Why this matters

The dashboard warns customers about invoices due in the next seven days. The
current helper compares full timestamps from `new Date(dateStr)` and `new Date()`.
For date-only values like `2026-06-15`, JavaScript parses midnight, so the
invoice may stop counting as "due soon" during the actual due date after local
time has advanced past midnight. Finance alerts should be based on calendar
days, not the current hour.

## Current state

- `src/pages/PortalDashboard.tsx:15` defines `isDueSoon(dateStr)`.
- `src/pages/PortalDashboard.tsx:17-19` compares `dueDate.getTime() - today.getTime()`.
- `src/pages/PortalDashboard.tsx:53` filters invoices with `isDueSoon(i.due_date)`.
- There is no `PortalDashboard` component test under `src/pages/__tests__`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `npm test -- src/pages/__tests__/PortalDashboard.test.tsx` | file passes |
| Full tests | `npm test` | all non-skipped tests pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/pages/PortalDashboard.tsx`
- `src/pages/__tests__/PortalDashboard.test.tsx` (create if absent)

**Out of scope**:
- Changing invoice status derivation in SQL.
- Changing copy or dashboard layout beyond alert correctness.
- Adding date libraries.

## Git workflow

- Branch: `codex/005-dashboard-due-soon-date-alerts`
- Commit message example: `fix(portal): compare due soon alerts by calendar day`.

## Steps

### Step 1: Extract or test the date helper

Prefer exporting a small pure helper from `PortalDashboard.tsx`, e.g.
`isDueSoonDate(dateStr: string | null, today = new Date())`, only if that is
consistent with the repo's test style. Keep the component behavior unchanged.

Add tests covering:

- Due today returns true.
- Due seven calendar days from today returns true.
- Due eight days from today returns false.
- Null due date returns false.
- Past date returns false.

Use fake timers or pass an explicit `today` parameter; avoid tests that depend on the real current date.

**Verify**: focused test fails before implementation for the due-today case.

### Step 2: Compare calendar days, not milliseconds from now

Implement the helper by normalizing both dates to a calendar-day boundary before comparison. Do not add a date dependency.

Accept date-only strings and timestamp strings. If parsing is invalid, return false.

**Verify**: `npm test -- src/pages/__tests__/PortalDashboard.test.tsx` passes.

### Step 3: Run full gates

**Verify**:
- `npm test` -> all non-skipped tests pass.
- `npm run lint` -> exit 0.
- `npm run build` -> exit 0.

## Test plan

- New focused tests for due-soon helper.
- Existing full suite covers import/build integration.

## Done criteria

- [ ] Invoices due today are included in due-soon alerts.
- [ ] Boundary at seven calendar days is covered by tests.
- [ ] No new date library is added.
- [ ] Full gates pass.
- [ ] `plans/README.md` row 005 updated.

## STOP conditions

- Product owner clarifies that "vence nos proximos 7 dias" intentionally excludes today.
- Existing SQL already supplies a canonical due-soon flag and the frontend should use that instead.

## Maintenance notes

If timezone-sensitive billing rules are added later, move date classification into a shared finance/date helper and cover it with service-level tests.
