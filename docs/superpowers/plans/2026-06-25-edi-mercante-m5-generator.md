# EDI Mercante M5 Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate EDI Mercante M5 (Longo Curso Importação) files from manifest data for submission to Receita Federal's Mercante/Siscomex Carga system.

**Architecture:** Pure TypeScript generator service that takes manifest data and produces the EDI text. Download via browser blob URL. Modal UI with pre-fillable fields for both /viagens and /manifestos entry points. No new database tables or RPCs needed.

**Tech Stack:** TypeScript, Vitest, React (TanStack Query)

---

## Decisions from Grill Session (2026-06-25)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Only Mercante M5 — skip COSCO, IFTMCS, etc. | First contact with Mercante system; expand later |
| D2 | Terminology: "EDI Mercante" (not "manifesto") | Manifesto already means "import batch" in this domain |
| D3 | Fixed-position format (positions from spec PDF) | Parser already splits on whitespace; space-delimiter risks parsing issues |
| D4 | Modal with pre-fillable fields for all entry points | Resolves missing mandatory data (Empresa, Agência, Terminal) |
| D5 | M5 grouped by POL→POD pair | Voyage with 3 POLs × 2 PODs = up to 6 distinct M5 manifests |
| D6 | B/Ls filtered at BL-level by POL/POD | B/Ls with different POL/POD excluded from that route's M5 |
| D7 | Empresa/Agência/Terminal optional and modal-fillable | Data not in DB yet; defaults from carrier.scac when omitted |
| D8 | MVP with available data | Addresses (consignatário/shipper) and total packages empty until parser updated |
| D9 | C5/I5 with space-delimited fields (4 spaces) | Consistent with parser's `split(/\s{2,}/)`; may need fixed positions if Mercante rejects it |
| D10 | Modal in both /viagens and /manifestos | Two entry points, same UI |

---

## File Structure

- **Create:** `src/services/mercanteEdiGenerator.ts` — types + generator (M5, C5, I5)
- **Create:** `src/services/__tests__/mercanteEdiGenerator.test.ts` — unit tests
- **Create:** `src/services/mercanteEdiDownload.ts` — browser download helper
- **Create:** `src/services/__tests__/mercanteEdiDownload.test.ts` — unit tests
- **Create:** `src/components/shared/MercanteEdiModal.tsx` — modal with pre-fillable fields
- **Modify:** `src/components/voyages/VoyageManifestosTab.tsx` — download button per manifest row
- **Modify:** `src/pages/Manifestos.tsx` — bulk "Gerar EDI Mercante" action
- **Modify:** `src/hooks/useBls.ts` — expanded bl_containers query fields

---

## Task 1: Create EDI Mercante M5 generator service

**Files:**
- Create: `src/services/mercanteEdiGenerator.ts`
- Create: `src/services/__tests__/mercanteEdiGenerator.test.ts`

- [x] Define types (`MercanteManifestData`, `MercanteBlData`, `MercanteContainerData`)
- [x] Implement formatting helpers (`fmtAlfa`, `fmtNum`, `fmtDate`)
- [x] Implement `generateM5Record()`, `generateC5Record()`, `generateI5Record()`
- [x] Implement `generateEdiMercante()`, `buildManifestData()`, `blToMercanteBlData()`
- [x] Write and pass tests (5/5)
- [x] Commit

---

## Task 2: Create download helper for EDI files

**Files:**
- Create: `src/services/mercanteEdiDownload.ts`
- Create: `src/services/__tests__/mercanteEdiDownload.test.ts`

- [x] Implement `downloadEdiMercante()` via blob URL
- [x] Write and pass tests (2/2)
- [x] Commit

---

## Task 2b: Create MercanteEdiModal component

**Files:**
- Create: `src/components/shared/MercanteEdiModal.tsx`

- [x] Modal with all mandatory fields (Empresa, Agência, Terminal, dates, etc.)
- [x] Pre-fill from voyage data when available
- [x] Generate and download EDI on confirm
- [x] Pass TypeScript check
- [x] Commit

---

## Task 3: Add EDI download button to Voyage Manifestos Tab

**Files:**
- Modify: `src/components/voyages/VoyageManifestosTab.tsx`
- Modify: `src/hooks/useBls.ts` — expanded bl_containers query

- [x] Expand bl_containers query to include seal_number, tare_weight_kg, gross_weight_kg, imo_class, un_number
- [x] Add download button per manifest row (opens modal)
- [x] Wire modal with voyage and filtered B/Ls by POL→POD
- [x] Pass TypeScript check
- [x] Commit

---

## Task 4: Add bulk EDI generation to Manifestos page

**Files:**
- Modify: `src/pages/Manifestos.tsx`

- [x] Add "Gerar EDI Mercante" button (enabled when B/Ls selected)
- [x] Group selected B/Ls by POL→POD
- [x] Open modal for first group, toast if multiple groups
- [x] Pass TypeScript check
- [x] Commit

---

## Self-Review

**1. Spec coverage:**
- Task 1: Core generator ✓
- Task 2: Download helper ✓
- Task 2b: Modal component ✓
- Task 3: UI in voyage manifests tab ✓
- Task 4: UI in manifestos page ✓

**2. Placeholder scan:**
- No TBD/TODO/filler code

**3. Type consistency:**
- `MercanteManifestData` → `generateEdiMercante` → `buildManifestData` ✓
- Modal types compatible with both Voyage and B/L row data ✓

**Known gaps (ponytail):**
- Exact C5/I5 format needs validation against Mercante system (space-delimited vs fixed positions)
- Addresses (consignatário/shipper) and total packages empty until parser updated
- Empty container count hardcoded as 0
- Agency CNPJ same as shipping company — add separate field when available
