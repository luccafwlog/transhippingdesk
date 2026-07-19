# Task 5 Report

Date: 2026-07-16
Branch: `claude/review-388-068i9n` (PR #390)

## Scope delivered

- Added nullable `atd` to `VoyagePolSchedule` and `makeEmptyPolSchedule`.
- Updated `listVoyagePolSchedules` to hydrate the most recent `audit_logs.field_name='atd'` row for each POL entity without changing existing `etd` / `escala_number` behavior.
- Updated `saveVoyagePolSchedule` to accept optional `atd?: string | null`, preserving old callers that omit the field.
- Added the exact audit justification `Atualizacao manual de ATD por POL` for manual POL ATD writes.
- Updated living documentation in `docs/modules/viagens.md` so the POL schedule contract reflects ETD + ATD.

## TDD evidence

### RED

Command:

```powershell
npm test -- src/services/__tests__/voyageRouteSchedules.test.ts
```

Observed failure before implementation:

- `hidrata o ATD mais recente ao listar schedules de POL`
- `grava audit row de ATD por POL sem quebrar callers antigos`

### GREEN

Command:

```powershell
npm test -- src/services/__tests__/voyageRouteSchedules.test.ts
```

Result: PASS (5 tests)

## Related verification

Focused related suite:

```powershell
npm test -- src/services/__tests__/voyageFromSchedule.attach.test.ts
```

Result: PASS (5 tests)

Broad verification:

```powershell
npm run docs:check
npm run lint
npm test
npm run build
```

Results:

- `docs:check` passed
- `lint` passed
- `npm test` passed (`253` files passed, `1` skipped; `1078` tests passed, `9` skipped)
- `build` passed

## Self-review

- Kept the change limited to Task 5 files plus the required living-doc update.
- Preserved old `saveVoyagePolSchedule` callers by making `atd` optional and treating `undefined` as "do not write ATD".
- Did not implement Task 6.

## Follow-up: review fixes on PR 390

### Scope

- Extended `PolScheduleModal` state/payload to handle `atd` alongside `etd`, following the existing ETD flow.
- Updated the POL modal title/action affordance in the UI path used by `VoyageManifestosTab`.
- Passed `atd` from `src/pages/Viagens.tsx` to `saveVoyagePolSchedule`.
- Kept old non-modal callers compatible by preserving `saveVoyagePolSchedule({ atd?: ... })` as optional.
- Extended manifest-route view-model/types so `EditingPolPayload` can carry `atd` end-to-end.
- Added behavioral modal coverage for `atd` preserved value and empty-to-`null` normalization.

### TDD evidence

#### RED

Reconstructed pre-fix production state locally while keeping the new modal test in place.

Command:

```powershell
npm test -- src/components/shared/__tests__/VoyageScheduleModals.test.tsx
```

Observed failure before restoring the fix:

- `pre-preenche ETD/ATD e envia o payload correto`
- `envia etd/atd null quando os campos sao limpos`
- `edita CE Master por rota mesmo sem batch de manifesto (#322)`

Representative failure output:

```text
TestingLibraryElementError: Unable to find a label with the text of: ATD
```

#### GREEN

Commands:

```powershell
npm test -- src/components/shared/__tests__/VoyageScheduleModals.test.tsx
npm test -- src/services/__tests__/voyageRouteSchedules.test.ts
```

Results:

- `VoyageScheduleModals.test.tsx`: PASS (`11` tests)
- `voyageRouteSchedules.test.ts`: PASS (`5` tests)

### Verification

Commands:

```powershell
npm run docs:check
npm run lint
npm run build
git diff --check
```

Results:

- `docs:check` passed (`143 Markdown files, 40 routes, and ADR index coverage verified`)
- `lint` passed
- `build` passed
- `git diff --check` passed

### Notes

- `docs/modules/viagens.md` was restored after an intermediate encoding mishap during editing; the final verification run passed `docs:check`.
- No Task 7 green-state rendering was implemented.
