# BL Operacional core (NCM + Notify Party + removals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Place of Delivery and Incoterm from the B/L form, show a derived read-only NCM list, and populate Notify Party from the container manifest parser (forward only).

**Architecture:** Frontend form/field changes in `useBlEditForm` + `BlOperacionalTab`; a new shared `src/lib/ncm.ts` helper reused by the breakbulk importer (DRY); and Notify Party extraction threaded through `manifestParser` → `manifestImport` into `bls.notify_party`.

**Tech Stack:** React + TypeScript, Vitest, Supabase JS client. No DB migration in this plan.

This is Plan 1 of 3 (Componentes A–C of `docs/superpowers/specs/2026-06-19-bl-detail-screen-redesign.md`). Plans 2 (tab restructure) and 3 (`bl_timeline`) follow.

---

## File Structure

- Create: `src/lib/ncm.ts` — pure NCM extraction/format helpers (no I/O).
- Create: `src/lib/__tests__/ncm.test.ts` — unit tests for the helpers.
- Modify: `src/services/breakbulkImport.ts:958-963` — delete local `extractNcmCodes`, import from `../lib/ncm`.
- Modify: `src/hooks/useBlEditForm.ts` — drop `place_of_delivery` and `incoterm` from the editable field union, the array, and `makeForm`.
- Modify: `src/components/bl/BlOperacionalTab.tsx` — remove the Place of Delivery and Incoterm `<Field>`s; add a read-only NCM chips field.
- Modify: `src/services/manifestParser.ts` — add `notify_party` to `ParsedBL`, extract it in `parseManifestParty`, populate it in both parse paths, add a `notify_party` header alias.
- Modify: `src/services/manifestImport.ts:65-84` — carry `notify_party` into `blPayload`.
- Test: `src/services/__tests__/manifestParser.notify.test.ts` — Notify Party extraction for both manifest models.

---

## Task 1: NCM helper (`src/lib/ncm.ts`)

**Files:**
- Create: `src/lib/ncm.ts`
- Test: `src/lib/__tests__/ncm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ncm.test.ts
import { describe, expect, it } from 'vitest'
import { extractNcmCodes, formatNcm, listBlNcms } from '../ncm'

describe('extractNcmCodes', () => {
  it('extracts a full 8-digit NCM (Modelo Vitória)', () => {
    expect(extractNcmCodes('NCM : 8703.80.00')).toEqual(['87038000'])
  })

  it('extracts a 4-digit NCM NUMBER (Modelo Salvador)', () => {
    expect(extractNcmCodes('NCM NUMBER:2923')).toEqual(['2923'])
  })

  it('excludes UN dangerous-goods numbers written as "UN NCM."', () => {
    expect(extractNcmCodes('NCM : 8703.80.00\nUN NCM.:3556')).toEqual(['87038000'])
  })

  it('returns empty for blank or NCM-less text', () => {
    expect(extractNcmCodes('')).toEqual([])
    expect(extractNcmCodes('WOODEN PACKAGE: NOT APPLICABLE')).toEqual([])
  })
})

describe('formatNcm', () => {
  it('dots 8-digit codes', () => expect(formatNcm('87038000')).toBe('8703.80.00'))
  it('dots 6-digit codes', () => expect(formatNcm('870380')).toBe('8703.80'))
  it('leaves 4-digit codes as-is', () => expect(formatNcm('2923')).toBe('2923'))
})

describe('listBlNcms', () => {
  it('dedupes and formats NCMs from a description, UN excluded', () => {
    const desc = 'BYD DOLPHIN\nNCM : 8703.80.00\nUN NCM.: 3556\nNCM : 8703.80.00'
    expect(listBlNcms(desc)).toEqual(['8703.80.00'])
  })

  it('returns empty list for null', () => {
    expect(listBlNcms(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/ncm.test.ts`
Expected: FAIL — cannot resolve `../ncm`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ncm.ts
// Extração de NCM a partir de texto livre (descrição da carga do manifesto).
// Fonte da verdade do NCM é a descrição; este helper é reaproveitado pelo
// importador breakbulk e pela tela do B/L (evita divergência de regex).

const NCM_PATTERN = /\bNCM(?:\s*(?:NO\.?|NUMBER|CODE))?\s*[:.]?\s*([0-9][0-9.,\s/-]{2,30})/gi
const CODE_PATTERN = /\d{4}(?:[.,]?\d{2})?(?:[.,]?\d{2})?/g

// Retorna os códigos NCM (somente dígitos) encontrados no texto, em ordem.
// Exclui números UN de carga perigosa, que aparecem como "UN NCM.:3556".
export function extractNcmCodes(value: string): string[] {
  if (!value) return []
  const codes: string[] = []
  for (const match of value.matchAll(NCM_PATTERN)) {
    const start = match.index ?? 0
    const preceding = value.slice(Math.max(0, start - 4), start)
    if (/\bUN\s$/i.test(preceding)) continue // "UN NCM." → número UN, não NCM
    for (const codeMatch of match[1].matchAll(CODE_PATTERN)) {
      const digits = codeMatch[0].replace(/\D/g, '')
      if (digits.length >= 4) codes.push(digits)
    }
  }
  return codes
}

// Formata um código NCM (somente dígitos) para exibição: 8703.80.00 / 8703.80 / 2923.
export function formatNcm(code: string): string {
  if (code.length >= 8) return `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6, 8)}`
  if (code.length >= 6) return `${code.slice(0, 4)}.${code.slice(4, 6)}`
  return code
}

// Lista deduplicada e formatada de NCMs de uma descrição de carga (para a UI).
export function listBlNcms(cargoDescription: string | null | undefined): string[] {
  if (!cargoDescription) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const code of extractNcmCodes(cargoDescription)) {
    if (seen.has(code)) continue
    seen.add(code)
    result.push(formatNcm(code))
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/ncm.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ncm.ts src/lib/__tests__/ncm.test.ts
git commit -m "feat(ncm): shared NCM extraction/format helper"
```

---

## Task 2: Reuse the helper in the breakbulk importer (DRY)

**Files:**
- Modify: `src/services/breakbulkImport.ts:958-963` (delete local fn) and its import block (top of file)

- [ ] **Step 1: Add the import at the top of `breakbulkImport.ts`**

Find the existing import group (around `import { asString, normalizeText, onlyDigits, toNumber } from '../lib/utils'`) and add:

```ts
import { extractNcmCodes } from '../lib/ncm'
```

- [ ] **Step 2: Delete the local `extractNcmCodes`**

Remove lines 958-963 entirely:

```ts
function extractNcmCodes(value: string) {
  return Array.from(value.matchAll(/\bNCM(?:\s*(?:NO\.|NUMBER|CODE))?\s*[:.]?\s*([0-9][0-9.,\s/-]{2,30})/gi))
    .flatMap((match) => Array.from(match[1].matchAll(/\d{4}(?:[.,]?\d{2})?(?:[.,]?\d{2})?/g)))
    .map((match) => match[0].replace(/\D/g, ''))
    .filter((code) => code.length >= 4)
}
```

`extractMachineNcmCodes` (line 954) and `countMachineModelIdentifiers` (line 965) keep calling `extractNcmCodes` — now the imported one.

- [ ] **Step 3: Run the existing breakbulk tests to verify no regression**

Run: `npx vitest run src/services/__tests__/breakbulkImport.test.ts`
Expected: PASS. (The UN-exclusion only drops `UN NCM.` matches, which were never valid machine NCMs — the prefix filter already excluded UN number `3556`.)

- [ ] **Step 4: Run the typecheck/lint for the touched file**

Run: `npm run lint -- src/services/breakbulkImport.ts` (or the repo's configured lint command)
Expected: no errors; no unused-symbol warning for the deleted function.

- [ ] **Step 5: Commit**

```bash
git add src/services/breakbulkImport.ts
git commit -m "refactor(breakbulk): use shared extractNcmCodes from lib/ncm"
```

---

## Task 3: Remove Place of Delivery and Incoterm from the edit form state

**Files:**
- Modify: `src/hooks/useBlEditForm.ts` (union at lines 9-29, array at 30-48, `makeForm` at 190-211)

- [ ] **Step 1: Remove from the `editableFields` type union**

Delete these two lines from the `Pick<BL, …>` union (lines 21 and 25):

```ts
  | 'place_of_delivery'
```
```ts
  | 'incoterm'
```

- [ ] **Step 2: Remove from the `editableFields` array**

Delete these two array entries (lines 40 and 44):

```ts
  'place_of_delivery',
```
```ts
  'incoterm',
```

- [ ] **Step 3: Remove from `makeForm`**

Delete these two lines from the returned object (lines 202 and 206):

```ts
    place_of_delivery: bl.place_of_delivery,
```
```ts
    incoterm: bl.incoterm,
```

- [ ] **Step 4: Typecheck**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: PASS. `BlForm` no longer includes the two keys; the UI references are removed in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBlEditForm.ts
git commit -m "refactor(bl-form): drop place_of_delivery and incoterm from editable fields"
```

---

## Task 4: Update the Operacional UI — remove fields, add NCM chips

**Files:**
- Modify: `src/components/bl/BlOperacionalTab.tsx` (imports; remove Fields at 132-137 and 166-168; add NCM chips)

- [ ] **Step 1: Import the NCM helper**

Add near the top of `BlOperacionalTab.tsx` with the other imports:

```ts
import { listBlNcms } from '../../lib/ncm'
```

- [ ] **Step 2: Remove the Place of Delivery field**

Delete this block (lines 132-137):

```tsx
          <Field label="Place of Delivery">
            <Input
              value={form.place_of_delivery ?? ''}
              onChange={(event) => onFieldChange('place_of_delivery', event.target.value)}
            />
          </Field>
```

- [ ] **Step 3: Remove the Incoterm field**

Delete this block (lines 166-168):

```tsx
          <Field label="Incoterm">
            <Input value={form.incoterm ?? ''} onChange={(event) => onFieldChange('incoterm', event.target.value)} />
          </Field>
```

- [ ] **Step 4: Compute the NCM list**

After the existing `useBlLocalChargeLines` hook line (near line 42), add:

```tsx
  const ncms = useMemo(() => listBlNcms(form.cargo_description), [form.cargo_description])
```

- [ ] **Step 5: Render read-only NCM chips**

Inside the cargo description block (`<Field label="Descricao da carga">` group, around lines 193-199), add a sibling field above the description:

```tsx
          <Field label="NCM">
            {ncms.length ? (
              <div className="flex flex-wrap gap-2">
                {ncms.map((ncm) => (
                  <span
                    key={ncm}
                    className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs font-semibold text-slate-200"
                  >
                    {ncm}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-400">Nenhum NCM identificado na descrição.</div>
            )}
          </Field>
```

- [ ] **Step 6: Typecheck + render check**

Run: `npm run build`
Expected: PASS, no references to `form.place_of_delivery` / `form.incoterm` remain.
Run: `npx vitest run src/pages/__tests__/blDetalheHelpers.test.ts`
Expected: PASS (unchanged helpers).

- [ ] **Step 7: Commit**

```bash
git add src/components/bl/BlOperacionalTab.tsx
git commit -m "feat(bl): remove Place of Delivery/Incoterm fields, add read-only NCM chips"
```

---

## Task 5: Notify Party — extract in the container manifest parser (forward only)

**Files:**
- Modify: `src/services/manifestParser.ts` (`ParsedBL` 56-70; `headerMap` 7-23; `parseManifestParty` 390-438; carrier grouped builder 257-291; header-mapped path 200-201)
- Modify: `src/services/manifestImport.ts:65-84`
- Test: `src/services/__tests__/manifestParser.notify.test.ts`

- [ ] **Step 1: Write the failing test (real sample shapes)**

```ts
// src/services/__tests__/manifestParser.notify.test.ts
import { describe, expect, it } from 'vitest'
import { parseManifestParty } from '../manifestParser'

// Modelo 1 (Vitória): marcadores explícitos + "SAME AS CONSIGNEE" no fim.
const VITORIA_BLOCK = [
  'BYD (H.K.) CO.,LIMITED',
  'UNIT 505-510, SCIENCE PARK, HONG KONG, CHINA',
  'COMPANY: COMEXPORT TRADING COMÉRCIO EXTERIOR LTDA.',
  'ADDRESS: RODOVIA GOVERNADOR MARIO COVAS, 3101',
  'CNPJ: 01.135.153/0006-13',
  'NAME: DENISE ALVES FERNANDES',
  'E-MAIL: DENISE.FERNANDES@COMEXPORT.COM.BR',
  'SAME AS CONSIGNEE',
].join('\n')

// Modelo 2 (Salvador): sem marcadores; shipper, consignee, notify, notify2.
const SALVADOR_BLOCK = [
  'SNF (CHINA) FLOCCULANT CO., LTD',
  'NO.6, NORTH BINJIANG ROAD, JIANGSU PROVINCE, CHINA',
  'TEL: 0086-523-80736300',
  'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
  'CNPJ:13.661.609/0001-53',
  'VIA DO MAR S/N - BA 530',
  'CEP 42.816-280 - CAMACARI - BAHIA - BRASIL',
  'JMALULI@SNFBRASIL.COM',
  'TRADICIONAL COMERCIO EXTERIOR EIRELI',
  'CNPJ:13.932.974/0001-55',
  'ATENDIMENTOIMP3@JOSERUBEM.COM.BR',
  'VIABILIDADE SERVICOS DE COMERCIO EXTERIOR LTDA',
  'CNPJ:28.176.854/0001-42',
].join('\n')

describe('parseManifestParty notify_party', () => {
  it('Modelo 1: returns the literal SAME AS CONSIGNEE', () => {
    expect(parseManifestParty(VITORIA_BLOCK).notify_party).toBe('SAME AS CONSIGNEE')
  })

  it('Modelo 2: returns the first notify party only', () => {
    expect(parseManifestParty(SALVADOR_BLOCK).notify_party).toBe(
      'TRADICIONAL COMERCIO EXTERIOR EIRELI',
    )
  })

  it('returns empty string when there is no notify party', () => {
    const block = 'ACME LTD\nCOMPANY: CLIENTE LTDA\nCNPJ: 11.111.111/0001-11'
    expect(parseManifestParty(block).notify_party).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/manifestParser.notify.test.ts`
Expected: FAIL — `notify_party` is `undefined`.

- [ ] **Step 3: Add `notify_party` to the `ParsedBL` type**

In `src/services/manifestParser.ts`, add to `ParsedBL` (after `consignee` at line 59):

```ts
  notify_party: string | null
```

- [ ] **Step 4: Add a company-line heuristic + notify extraction, and return it from `parseManifestParty`**

Add these helpers above `parseManifestParty`:

```ts
const COMPANY_HINT = /(LTDA|EIRELI|S\.?\/?A\b|CO\.,?\s*LTD|COMERCIO|INDUSTRIA|SERVICOS|LOGISTICA|TRANSPORTES|TRADING|IMPORTACAO|EXPORTACAO|QUIMICA)/i
const NON_COMPANY_START = /^(CNPJ|CPF|TEL|PHONE|FAX|MOBILE|CEP|ZIP|E-?MAIL|NAME|ATTN|CONTACT|VIA\b|POLO\b|RUA\b|ROAD\b|ADDRESS|ENDERECO)/i

function looksLikeCompanyName(line: string): boolean {
  const value = line.trim()
  if (!value || NON_COMPANY_START.test(value) || value.includes('@')) return false
  return COMPANY_HINT.test(value)
}

// Notify party: "SAME AS CONSIGNEE" literal (Modelo 1) ou o primeiro bloco de
// empresa após o CNPJ do consignee (Modelo 2). Guarda apenas a 1ª notify party.
function extractNotifyParty(parts: string[], consigneeCnpjIndex: number): string {
  if (parts.some((part) => /SAME AS CONSIGNEE/i.test(part))) return 'SAME AS CONSIGNEE'
  if (consigneeCnpjIndex < 0) return ''
  for (let i = consigneeCnpjIndex + 1; i < parts.length; i++) {
    if (looksLikeCompanyName(parts[i])) return cleanupLabel(parts[i])
  }
  return ''
}
```

Then, in `parseManifestParty`, compute notify before each `return` and include it. Replace the two `return` objects (the `cnpjIndex === -1` early return at lines 406-411 and the final return at 432-437) so each includes:

```ts
    notify_party: extractNotifyParty(parts, cnpjIndex),
```

(For the early-return branch `cnpjIndex` is `-1`, so `extractNotifyParty` falls through to the `SAME AS CONSIGNEE` check or returns `''` — correct.)

- [ ] **Step 5: Run the parser test to verify it passes**

Run: `npx vitest run src/services/__tests__/manifestParser.notify.test.ts`
Expected: PASS. (Salvador: FLOPAM is at/below `cnpjIndex`, so scanning starts after it; the intermediate address/email lines fail `looksLikeCompanyName`; `TRADICIONAL … EIRELI` matches.)

- [ ] **Step 6: Populate notify_party in the carrier parse path**

In `parseCarrierManifest`, the `currentBL` object (lines 257-269) gains a field after `consignee: partyData.consignee,`:

```ts
        notifyParty: partyData.notify_party,
```

Add `notifyParty: string` to the local `currentBL` shape if it is typed inline; otherwise it is a plain object and no type edit is needed. Then in the `grouped.set(...)` object (lines 276-290), after `consignee: currentBL.consignee || null,` add:

```ts
          notify_party: currentBL.notifyParty || null,
```

- [ ] **Step 7: Populate notify_party in the header-mapped path + add the alias**

In `headerMap` (lines 7-23) add an entry after `consignee`:

```ts
  notify_party: ['notify', 'notify party'],
```

In `parseHeaderMappedManifest`, where the grouped `ParsedBL` is built (mirroring `shipper`/`consignee` near line 200), add:

```ts
      notify_party: asString(mapped.notify_party) || null,
```

- [ ] **Step 8: Carry notify_party into the DB payload**

In `src/services/manifestImport.ts`, add to the returned `blPayload` object (after `shipper: bl.shipper,` at line 67):

```ts
      notify_party: bl.notify_party,
```

- [ ] **Step 9: Typecheck + full parser test run**

Run: `npm run build`
Expected: PASS — every `ParsedBL` construction now sets `notify_party`.
Run: `npx vitest run src/services/__tests__/manifestParser.notify.test.ts src/services/__tests__/breakbulkImport.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/services/manifestParser.ts src/services/manifestImport.ts src/services/__tests__/manifestParser.notify.test.ts
git commit -m "feat(manifest): extract Notify Party for container manifests (forward only)"
```

---

## Self-Review

**Spec coverage (Componentes A–C):**
- Componente A (remove Place of Delivery, Incoterm) → Tasks 3, 4. ✓
- Componente B (NCM derived, read-only, UN excluded, shared helper) → Tasks 1, 2, 4. ✓
- Componente C (Notify Party parser, forward only, first notify / SAME AS CONSIGNEE, alias, persistence) → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `extractNcmCodes`/`formatNcm`/`listBlNcms` names match across Tasks 1, 2, 4. `notify_party` (DB/`ParsedBL`) vs `notifyParty` (transient `currentBL` field) are intentionally distinct and mapped in Task 5 Step 6. `parseManifestParty` return includes `notify_party` everywhere it is constructed. ✓

**Out of scope (later plans):** tab restructure, demurrage consolidation, `bl_timeline` — Plans 2 and 3.
