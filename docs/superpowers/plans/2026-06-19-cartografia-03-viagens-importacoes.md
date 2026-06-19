# Voyages and Import Pipelines Cartography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document every developer-relevant action in voyages, manifests, B/L details, containers, vehicles, Baplie, breakbulk, and empty-container flows.

**Architecture:** `viagens.md` owns the voyage master-detail and schedule/timeline behavior. `manifesto-edi.md` owns all ingestion and reconciliation surfaces, including the B/L detail tabs that expose imported data and downstream actions.

**Tech Stack:** React, TanStack Query, Supabase transactional RPCs, XLSX/EDIFACT parsers, Markdown, Mermaid, Vitest.

---

## Files

- Modify: `docs/modules/viagens.md`
- Modify: `docs/modules/manifesto-edi.md`

Do not modify product code, fixtures, or migrations.

### Task 1: Expand the Voyage Master-Detail Cartography

**Files:**

- Modify: `docs/modules/viagens.md`
- Read: `src/pages/Viagens.tsx`
- Read: `src/pages/viagensHelpers.ts`
- Read: `src/components/voyages/VoyageCard.tsx`
- Read: `src/components/voyages/VoyageRail.tsx`
- Read: `src/components/voyages/VoyageFilters.tsx`
- Read: `src/components/shared/VoyageCreateModal.tsx`
- Read: `src/components/shared/VoyageScheduleModals.tsx`
- Read: `src/components/shared/VoyageSectionCards.tsx`
- Read: `src/hooks/useViagemSchedulesAndStats.ts`
- Read: `src/hooks/useVoyageTimeline.ts`
- Read: `src/hooks/useVoyageReconciliation.ts`
- Read: `src/services/voyages.ts`
- Read: `src/services/voyageForm.ts`
- Read: `src/services/voyageRouteSchedules.ts`
- Read: `src/services/voyageExportSchedules.ts`
- Read: `src/services/voyageTimeline.ts`
- Test: `src/pages/__tests__/viagensHelpers.test.ts`
- Test: `src/lib/__tests__/viagensFilters.test.ts`
- Test: `src/components/shared/__tests__/VoyageScheduleModals.test.tsx`
- Test: `src/components/shared/__tests__/VoyageSectionCards.test.tsx`

- [ ] **Step 1: Apply the shared module headings**

Use all seven required top-level headings. Under `Anatomia das telas`, separate `/viagens` from `/viagens/:voyageId`.

- [ ] **Step 2: Catalog voyage actions**

Include:

- search/filter/sort the rail;
- select voyage and synchronize route;
- handle invalid/deleted voyage ID;
- create voyage;
- delete voyage;
- edit POL schedule;
- edit POD schedule fields;
- delete schedule snapshot;
- edit export schedule;
- edit CE Master;
- load timeline;
- load reconciliation summary;
- navigate to manifests, breakbulk, Granite, empties, and Baplie with voyage context.

- [ ] **Step 3: Document state and cache**

Include exact families:

```text
queryKeys.voyages.all()
queryKeys.voyages.billingStatus(voyageIds)
queryKeys.voyages.polSchedules(entityIds)
queryKeys.voyages.podSchedules(voyageIds)
queryKeys.voyages.exportSchedules(voyageIds)
['voyage-timeline', voyageId]
['baplie-reconciliation', voyageId]
```

Explain the split between audit-log reconstructed POL/POD state and physical `voyage_export_schedules`.

- [ ] **Step 4: Run focused tests**

```powershell
npx vitest run src/pages/__tests__/viagensHelpers.test.ts src/lib/__tests__/viagensFilters.test.ts src/components/shared/__tests__/VoyageScheduleModals.test.tsx src/components/shared/__tests__/VoyageSectionCards.test.tsx
```

Expected: exit `0`.

### Task 2: Map Manifest and B/L Surfaces

**Files:**

- Modify: `docs/modules/manifesto-edi.md`
- Read: `src/pages/Manifestos.tsx`
- Read: `src/pages/BlDetalhe.tsx`
- Read: `src/pages/blDetalheHelpers.ts`
- Read: `src/components/bl/BlCargaTab.tsx`
- Read: `src/components/bl/BlCobrancasTab.tsx`
- Read: `src/components/bl/BlFinanceiroTab.tsx`
- Read: `src/components/bl/BlOperacionalTab.tsx`
- Read: `src/hooks/useBls.ts`
- Read: `src/hooks/useBlEditForm.ts`
- Read: `src/hooks/useLocalCharges.ts`
- Read: `src/services/manifestParser.ts`
- Read: `src/services/manifestImport.ts`
- Read: `src/services/ceMercanteEdiParser.ts`
- Read: `src/services/ceMercanteImport.ts`
- Read: `src/services/bls.ts`
- Read: `src/services/containers.ts`
- Test: `src/services/__tests__/manifestParser.test.ts`
- Test: `src/services/__tests__/manifestImport.test.ts`
- Test: `src/services/__tests__/manifestFixtures.real.test.ts`
- Test: `src/services/__tests__/ceMercanteEdiParser.test.ts`
- Test: `src/services/__tests__/ceMercanteImport.test.ts`
- Test: `src/pages/__tests__/blDetalheHelpers.test.ts`
- Test: `src/hooks/__tests__/useBls.test.ts`

- [ ] **Step 1: Apply the shared headings to `manifesto-edi.md`**

Under `Anatomia das telas`, create route subsections for all routes owned by the file:

```markdown
### `/manifestos`
### `/manifestos/:blId`
### `/carga-solta`
### `/containers`
### `/veiculos`
### `/baplie`
### `/vazios-importacao`
### `/embarquevazios`
```

- [ ] **Step 2: Catalog `/manifestos` and B/L detail actions**

Include:

- filter/list/select manifest B/Ls;
- import manifest files and preview;
- detect duplicate file/batch;
- edit CE Master;
- import CE Mercante by row and by manifest;
- delete eligible B/Ls;
- navigate to B/L detail;
- edit operational review fields;
- update cargo/container data;
- calculate/review/ready local charges;
- issue invoice from the B/L;
- save financial review/customer match.

- [ ] **Step 3: Trace atomicity and post-processing**

Add a Mermaid sequence:

```text
file guard
→ parser
→ preview
→ import_manifest_with_postprocess_transactional
→ import batch + B/Ls + containers + errors
→ review gate for imported IDs
→ charge/billing post-processing
→ audit/cache invalidation
```

Document the difference between code-level parser tests and database transaction guarantees.

### Task 3: Map Breakbulk, Containers, Vehicles, Baplie, and Empties

**Files:**

- Modify: `docs/modules/manifesto-edi.md`
- Read: `src/pages/CargaSolta.tsx`
- Read: `src/pages/Containers.tsx`
- Read: `src/pages/Veiculos.tsx`
- Read: `src/pages/Baplie.tsx`
- Read: `src/pages/VaziosImportacao.tsx`
- Read: `src/pages/EmbarqueVazios.tsx`
- Read: `src/components/shared/FileImportModal.tsx`
- Read: `src/components/shared/CeMercanteImportModal.tsx`
- Read: `src/components/shared/ContainerDatesImportModal.tsx`
- Read: `src/components/shared/VoyageImportActions.tsx`
- Read: `src/services/breakbulkImport.ts`
- Read: `src/services/containerDatesImport.ts`
- Read: `src/services/containerFlagsImport.ts`
- Read: `src/services/vehicleImport.ts`
- Read: `src/services/vehicles.ts`
- Read: `src/services/baplieParser.ts`
- Read: `src/services/baplieImport.ts`
- Read: `src/services/baplieReconciliation.ts`
- Read: `src/services/vaziosImport.ts`
- Read: `src/services/vaziosImportacaoImport.ts`
- Read: `src/services/importCore.ts`
- Read: `src/lib/fileGuard.ts`
- Test: `src/services/__tests__/breakbulkImport.test.ts`
- Test: `src/services/__tests__/breakbulkFixtures.real.test.ts`
- Test: `src/services/__tests__/containerDatesImport.test.ts`
- Test: `src/services/__tests__/vehicleImport.test.ts`
- Test: `src/services/__tests__/baplieReconciliation.test.ts`
- Test: `src/services/__tests__/vaziosImportacaoImport.test.ts`
- Test: `src/services/__tests__/uploadLimits.test.ts`
- Test: `src/components/shared/__tests__/VoyageImportActions.test.ts`

- [ ] **Step 1: Catalog every ingestion action**

Include:

```text
/carga-solta
- parse, preview, import, duplicate/cargo-mode rejection

/containers
- filter/list
- import dates
- import IMO/OOG flags
- controlled delete

/veiculos
- filter/list/stats
- parse/preview/import
- controlled delete
- invoice cancellation and charge recalculation side effects

/baplie
- select voyage
- import/replace staging
- load reconciliation
- apply Baplie attribute
- keep manifest attribute
- import/remove empty-container manifest

/vazios-importacao
- import spreadsheet
- import from Baplie
- delete/reimport manifest

/embarquevazios
- import booking spreadsheet
- filter/list
```

- [ ] **Step 2: Record cache invalidations**

Document the literal cache keys invalidated by `VoyageImportActions`, page mutations, and import modals. Do not normalize them into `queryKeys` if the code uses raw arrays.

- [ ] **Step 3: Record protected and mutable fields**

Explicitly distinguish:

- Baplie physical attributes that may update manifest containers;
- commercial/financial fields that Baplie must not overwrite;
- vehicle import effects on active invoices;
- container date effects on demurrage;
- idempotent/replacement boundaries by voyage or batch.

- [ ] **Step 4: Run focused import tests**

```powershell
npx vitest run src/services/__tests__/breakbulkImport.test.ts src/services/__tests__/breakbulkFixtures.real.test.ts src/services/__tests__/containerDatesImport.test.ts src/services/__tests__/vehicleImport.test.ts src/services/__tests__/baplieReconciliation.test.ts src/services/__tests__/vaziosImportacaoImport.test.ts src/services/__tests__/uploadLimits.test.ts src/components/shared/__tests__/VoyageImportActions.test.ts
```

Expected: exit `0`.

### Task 4: Verify and Commit

**Files:**

- Modify: `docs/modules/viagens.md`
- Modify: `docs/modules/manifesto-edi.md`

- [ ] **Step 1: Check section and route coverage**

```powershell
rg -n "^## (Propósito e escopo|Anatomia das telas|Catálogo de ações|Estado e dados|Fluxos e invariantes|Testes e validação|Notas e divergências)$" docs/modules/viagens.md docs/modules/manifesto-edi.md
rg -n '### `/((viagens|manifestos|carga-solta|containers|veiculos|baplie|vazios-importacao|embarquevazios)[^`]*)`' docs/modules/viagens.md docs/modules/manifesto-edi.md
```

Expected: seven headings in each file and all owned route subsections present.

- [ ] **Step 2: Run docs/whitespace checks**

```powershell
npm run docs:check
git diff --check
```

Expected: no cartography-heading failures for these two files.

- [ ] **Step 3: Commit**

```powershell
git add -- docs/modules/viagens.md docs/modules/manifesto-edi.md
git commit -m "docs: map voyages and import pipelines"
```

