# Task 7 Report - WS1

Date: 2026-07-16
PR branch: `claude/review-388-068i9n` (PR #390)

## Scope delivered

- Added pure helper `formatPolDeparture(etd, atd)` in `src/components/voyages/voyageCardHelpers.tsx`.
- Updated the POL departure cell rendered in `src/components/voyages/VoyageManifestosTab.tsx` to:
  - keep the column title as `ETD`
  - show `ATD` when available
  - apply `text-green-600 font-medium` when the displayed value is actual
- Preserved null safety and existing callers by falling back to `ETD` and allowing `null`.
- Did not change `Painel`, `Line-Up TV`, or WS2 files.
- `src/pages/Viagens.tsx` did not require changes because the relevant cell is rendered inside `VoyageManifestosTab` under `VoyageCard`.

## TDD evidence

RED:

- Added failing tests in `src/components/voyages/__tests__/voyageCardHelpers.test.tsx` for:
  - helper behavior with `ATD`, without `ATD`, and with nulls
  - relevant render behavior in `VoyageManifestosTab`
- Verified failure with:
  - `npx vitest run src/components/voyages/__tests__/voyageCardHelpers.test.tsx`

GREEN:

- Implemented the helper and minimal UI change.
- Verified pass with:
  - `npx vitest run src/components/voyages/__tests__/voyageCardHelpers.test.tsx; exit $LASTEXITCODE`

## Full verification

- `npm run docs:check`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

All commands passed on 2026-07-16.

## Self-review

- Confirmed only Task 7 files were changed.
- Confirmed the visible label stays `ETD`.
- Confirmed `ATD` wins only when present.
- Confirmed null inputs do not throw and preserve fallback behavior.
