# Task 2 — Frente D report

## Outcome

The Viagens rail now carries the ETB of the next POD and sorts items by
`ETA -> ETB -> vessel -> voyage`, with a missing ETB ordered last among items
with the same ETA.

## TDD evidence

### RED

Command:

```powershell
npm test -- src/lib/__tests__/viagensFilters.test.ts
```

Result before production changes: exit 1; 12 tests run, 11 passed and 1 failed.
The new test `desempata ETAs pela ETB antes de navio e viagem` expected IDs
`[4, 3]` (ETB 2026-06-21 before 2026-06-22), but received `[3, 4]` because
the pre-change comparator used vessel name immediately after ETA.

### GREEN

Command:

```powershell
npm test -- src/lib/__tests__/viagensFilters.test.ts src/pages/__tests__/viagensHelpers.test.ts
```

Result: exit 0; 2 test files passed and 58 tests passed.

## Changed files

- `src/services/voyageSummaries.ts`
  - Adds `etb` to `VoyageRailItem.proximaEscala`.
  - Returns the selected POD's ETB from `getProximaEscala`.
  - Requires ETB on the internal rail schedule row.
- `src/lib/viagensFilters.ts`
  - Adds ETB as the sort tie-break after ETA, preserving existing vessel/voyage
    behavior afterward and placing `null` ETB last.
- `src/lib/__tests__/viagensFilters.test.ts`
  - Covers differing ETBs on the same ETA and null ETB last.
- `src/pages/__tests__/viagensHelpers.test.ts`
  - Verifies ETB propagation through `getProximaEscala` and
    `buildVoyageRailItems`.

## Verification

Fresh verification command sequence:

```powershell
npm test -- src/lib/__tests__/viagensFilters.test.ts src/pages/__tests__/viagensHelpers.test.ts
npm run typecheck
npm run docs:check
npm run lint
npm test
npm run build
```

All commands exited 0. The full test suite reported 234 passed files and 1
skipped; 1002 passed tests and 9 skipped. Documentation checks passed for 127
Markdown files, 37 routes, and ADR index coverage. The production build
completed successfully.

## Self-review

- Scope is limited to propagating ETB and the requested ordering tie-break.
- Existing ETA-first ordering and vessel/voyage fallback remain unchanged.
- `getProximaEscala` accepts missing ETB from legacy direct callers and
  normalizes it to `null`; the rail's schedule source still requires ETB.
- `git diff --check` completed without whitespace errors.

## Concerns

None. ETB and ETA are ISO date strings in this contract, so lexical ordering
matches chronological ordering and preserves the rail's prior ETA comparison
strategy.

## Review follow-up — vessel and voyage keys

### RED

Command:

```powershell
npm test -- src/lib/__tests__/viagensFilters.test.ts
```

Output: exit 1; 14 tests run, 13 passed and 1 failed. The new prefix-name
regression expected `[7, 8]` (`ALPHA` before `ALPHA A`) but received `[8, 7]`.
This proved that comparing the concatenated `vesselName voyageNumber` string
allowed the first voyage number to change vessel-name order.

### GREEN

Command:

```powershell
npm test -- src/lib/__tests__/viagensFilters.test.ts
```

Exact result summary: exit 0; `Test Files 1 passed (1)` and
`Tests 14 passed (14)`.

### Files

- `src/lib/viagensFilters.ts`: compares vessel names first and voyage numbers
  only when vessel names are equal.
- `src/lib/__tests__/viagensFilters.test.ts`: adds the prefix vessel-name
  regression test.
- `.superpowers/sdd/task-2-report.md`: records this review follow-up.

### Self-review

- The ordering is now explicitly `ETA -> ETB -> vessel -> voyage`; no string
  concatenation remains at the vessel/voyage boundary.
- The focused regression test exercises the prior failure with real filter
  behavior, not a comparator mock.
