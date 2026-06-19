# BL detail tabs restructure (3 tabs + demurrage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 5 B/L tabs into 3 (Detalhes do B/L, Faturamento, Histórico), removing cross-tab duplication and consolidating all demurrage into Faturamento with audited writes.

**Architecture:** Decompose by responsibility into reusable section components (`BlClienteSection`, `BlDemurrageSection`), compose them into two container tabs (`BlDetalhesTab`, `BlFaturamentoTab`), and rewire `BlDetalhe.tsx`. Demurrage writes route through the existing audited `save_bl_review` RPC.

**Tech Stack:** React + TypeScript, TanStack Query v5, Supabase JS, Vitest. No DB migration (Plan 3 adds the `bl_timeline` RPC).

This is Plan 2 of 3 (Componentes D–F). Plan 1 (A–C) and Plan 3 (G) are separate.
Follow the conventions in `.claude/skills/react-query-pattern.skill` for hooks/cache keys.

---

## File Structure

- Create: `src/components/bl/BlClienteSection.tsx` — customer card extracted from `BlFinanceiroTab` (Componente E).
- Create: `src/components/bl/BlDemurrageSection.tsx` — consolidated demurrage: B/L-level overrides + per-container return-date/calc table (Componente F).
- Create: `src/components/bl/BlDetalhesTab.tsx` — composes `BlOperacionalTab` (edit form) + the physical-composition part of `BlCargaTab`.
- Create: `src/components/bl/BlFaturamentoTab.tsx` — composes `BlClienteSection` + the local-charges body (from `BlCobrancasTab`) + `BlDemurrageSection` + the active-invoice/financial-status header.
- Modify: `src/components/bl/BlCargaTab.tsx` — drop the BB parties table and the return-date/demurrage columns (those move to `BlDemurrageSection`).
- Modify: `src/components/bl/BlFinanceiroTab.tsx` — delete (its parts move to `BlClienteSection` + `BlDemurrageSection`); remove the "Informações financeiras" card entirely.
- Modify: `src/components/bl/BlCobrancasTab.tsx` — keep the local-charges logic but export it as a section consumed by `BlFaturamentoTab` (rename concept "Cobranças" → "Faturamento").
- Modify: `src/pages/BlDetalhe.tsx` — 3-tab definition, guard, default tab, and rendering.
- Modify: `src/services/demurrage/demurrageContainers.ts` — `updateContainerReturnDate` writes an `audit_logs` row.
- Test: `src/components/bl/__tests__/BlDemurrageSection.test.tsx`, `src/pages/__tests__/blTabs.test.tsx`.

---

## Task 1: Extract the customer card into `BlClienteSection` (Componente E)

**Files:**
- Create: `src/components/bl/BlClienteSection.tsx`
- Reference (source to move): `src/components/bl/BlFinanceiroTab.tsx:53-114, 144-233`

- [ ] **Step 1: Create the section component**

Move the customer logic and JSX verbatim out of `BlFinanceiroTab`: the state/handlers `customerSearch`, `selectedCustomerId`, `savingCustomer`, `creatingManifestCustomer`, `useOverrideCustomers`, `handleLinkCustomer`, `handleCreateManifestCustomer`, and the first `<Card>` (the "Cliente" card, lines 144-233 including the `InfoLine` helper).

```tsx
// src/components/bl/BlClienteSection.tsx
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useOverrideCustomers } from '../../hooks/useLocalCharges'
import { formatBRL } from '../../lib/utils'
import { createCustomer } from '../../services/customers'
import { supabase } from '../../services/supabase'
import { queryKeys } from '../../services/queryKeys'
import { useAuth } from '../../hooks/useAuth'
import type { BLDetail } from '../../types/database'

export function BlClienteSection({ bl }: { bl: BLDetail }) {
  // ...move state + handleLinkCustomer + handleCreateManifestCustomer here,
  // unchanged, but invalidate via queryKeys.bls.detail(bl.id) instead of the
  // literal ['bl-detail', bl.id].
  // Then return the existing "Cliente" <Card> JSX (lines 144-233) plus InfoLine.
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-100">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS (component compiles; not yet wired — that's Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/components/bl/BlClienteSection.tsx
git commit -m "refactor(bl): extract customer card into BlClienteSection"
```

---

## Task 2: Audit container return-date writes

**Files:**
- Modify: `src/services/demurrage/demurrageContainers.ts` (`updateContainerReturnDate`)

- [ ] **Step 1: Write the failing test**

```ts
// src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const calls: { table: string; payload: unknown }[] = []
vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => ({ eq: () => { calls.push({ table, payload }); return Promise.resolve({ error: null }) } }),
      insert: (payload: unknown) => { calls.push({ table, payload }); return Promise.resolve({ error: null }) },
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { bl_id: 'BL1' }, error: null }) }) }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))

import { updateContainerReturnDate } from '../demurrageContainers'

describe('updateContainerReturnDate', () => {
  beforeEach(() => { calls.length = 0 })
  it('writes an audit_logs row for the return-date change', async () => {
    await updateContainerReturnDate(42, '2026-03-01')
    const audit = calls.find((c) => c.table === 'audit_logs')
    expect(audit).toBeTruthy()
    expect(audit?.payload).toMatchObject({ entity_type: 'bl_container', entity_id: '42', field_name: 'return_date' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts`
Expected: FAIL — no `audit_logs` insert today.

- [ ] **Step 3: Add the audit write**

In `updateContainerReturnDate`, after the successful `bl_containers` update, read the prior value and insert an audit row:

```ts
// inside updateContainerReturnDate, after the update succeeds:
const { data: userData } = await supabase.auth.getUser()
await supabase.from('audit_logs').insert({
  entity_type: 'bl_container',
  entity_id: String(containerId),
  field_name: 'return_date',
  old_value: null,
  new_value: returnDate ?? null,
  changed_by: userData?.user?.id ?? null,
  justification: 'Data de devolução atualizada na seção Demurrage.',
})
```

(Best-effort: do not fail the user flow if the audit insert errors — wrap in a try/catch that logs via `reportBestEffortFailure`, mirroring `operationalEvents.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/demurrage/demurrageContainers.ts src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts
git commit -m "feat(demurrage): audit container return-date changes"
```

---

## Task 3: Consolidated `BlDemurrageSection` (Componente F)

**Files:**
- Create: `src/components/bl/BlDemurrageSection.tsx`
- Reference (sources to move): `BlFinanceiroTab.tsx:116-138, 235-275` (overrides) and `BlCargaTab.tsx:124-183` (per-container return-date + calc table)
- Test: `src/components/bl/__tests__/BlDemurrageSection.test.tsx`

- [ ] **Step 1: Write the failing test (override save uses save_bl_review)**

```tsx
// src/components/bl/__tests__/BlDemurrageSection.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlDemurrageSection } from '../BlDemurrageSection'

const rpc = vi.fn().mockResolvedValue({ error: null })
vi.mock('../../../services/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

describe('BlDemurrageSection', () => {
  it('renders free time and P1/P2 override inputs', () => {
    render(<BlDemurrageSection bl={{ id: 'BL1', updated_at: 't', bl_containers: [], free_time_override: null, demurrage_rate_override_p1_usd: null, demurrage_rate_override_p2_usd: null } as never} />)
    expect(screen.getByText(/Free time/i)).toBeInTheDocument()
    expect(screen.getByText(/Taxa P1/i)).toBeInTheDocument()
    expect(screen.getByText(/Taxa P2/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/bl/__tests__/BlDemurrageSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BlDemurrageSection`**

Compose three things in one `<Card>`:
1. Free time override input (moved out of `BlOperacionalTab` — remove the `free_time_override` `<Field>` there in Task 5).
2. P1/P2 override inputs (moved from `BlFinanceiroTab:235-275`).
3. The per-container table with editable return date + `calculateDemurrage` (moved from `BlCargaTab:124-183`), reusing `updateContainerReturnDate`.

All three B/L-level fields save through one handler using the audited RPC (replacing the direct `supabase.update` at `BlFinanceiroTab:126-130`):

```tsx
// save handler inside BlDemurrageSection
async function handleSaveDemurrageConfig() {
  if (!bl || !user) return
  const payload: Record<string, unknown> = {
    free_time_override: freeTime.trim() === '' ? '' : freeTime,
    demurrage_rate_override_p1_usd: p1.trim() === '' ? '' : p1,
    demurrage_rate_override_p2_usd: p2.trim() === '' ? '' : p2,
  }
  const auditRows = [
    { entity_type: 'bl', entity_id: bl.id, field_name: 'free_time_override', old_value: String(bl.free_time_override ?? ''), new_value: freeTime, justification: 'Config de demurrage (Faturamento).' },
    { entity_type: 'bl', entity_id: bl.id, field_name: 'demurrage_rate_override_p1_usd', old_value: String(bl.demurrage_rate_override_p1_usd ?? ''), new_value: p1, justification: 'Config de demurrage (Faturamento).' },
    { entity_type: 'bl', entity_id: bl.id, field_name: 'demurrage_rate_override_p2_usd', old_value: String(bl.demurrage_rate_override_p2_usd ?? ''), new_value: p2, justification: 'Config de demurrage (Faturamento).' },
  ]
  const { error } = await supabase.rpc('save_bl_review', {
    p_bl_id: bl.id,
    p_expected_updated_at: bl.updated_at ?? null,
    p_update_payload: payload,
    p_audit_rows: auditRows,
    p_changed_by: user.id,
  })
  if (error) { showToast('Falha ao salvar config de demurrage.', 'error'); return }
  await queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(bl.id) })
  showToast('Config de demurrage salva.', 'success')
}
```

Handle the `PT409`/`40001` concurrency codes the same way `useBlEditForm.handleSubmit` does (reload + warn), since `save_bl_review` enforces `expected_updated_at`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/bl/__tests__/BlDemurrageSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/bl/BlDemurrageSection.tsx src/components/bl/__tests__/BlDemurrageSection.test.tsx
git commit -m "feat(bl): consolidated, audited BlDemurrageSection"
```

---

## Task 4: `BlFaturamentoTab` — compose Cliente + Cobranças + Demurrage

**Files:**
- Create: `src/components/bl/BlFaturamentoTab.tsx`
- Modify: `src/components/bl/BlCobrancasTab.tsx` (extract its body so it can be embedded without its own `if (!active) return null`)

- [ ] **Step 1: Make the local-charges body embeddable**

In `BlCobrancasTab.tsx`, keep all logic; remove the `active` gating from the embeddable part by splitting into `BlCobrancasSection({ bl })` (the current body, minus `active`) and leave a thin `BlCobrancasTab` wrapper only if still referenced. `BlFaturamentoTab` will import `BlCobrancasSection`.

- [ ] **Step 2: Implement the container tab**

```tsx
// src/components/bl/BlFaturamentoTab.tsx
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { BlClienteSection } from './BlClienteSection'
import { BlCobrancasSection } from './BlCobrancasTab'
import { BlDemurrageSection } from './BlDemurrageSection'
import { useInvoiceLinks } from '../../hooks/useBilling'
import { FINANCIAL_STATUS_LABELS } from '../../lib/statusLabels'
import type { BLDetail } from '../../types/database'

export function BlFaturamentoTab({ active, bl }: { active: boolean; bl: BLDetail }) {
  const { data: invoiceLinksByBl } = useInvoiceLinks([bl.id])
  const latestInvoice = invoiceLinksByBl?.[bl.id]?.[0] ?? null
  if (!active) return null
  return (
    <div className="grid gap-5">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">Financeiro: {FINANCIAL_STATUS_LABELS[bl.financial_status ?? 'pending'] ?? bl.financial_status ?? 'pending'}</Badge>
          {latestInvoice ? (
            <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={`/faturamento?invoice=${latestInvoice.id}`}>
              Fatura ativa: {latestInvoice.invoice_number ?? `INV-${latestInvoice.id}`}
            </Link>
          ) : null}
        </div>
      </Card>
      <BlClienteSection bl={bl} />
      <BlCobrancasSection bl={bl} />
      <BlDemurrageSection bl={bl} />
    </div>
  )
}
```

(The active-invoice link + `financial_status` badge are the ones removed from `BlOperacionalTab`'s header in Task 5.)

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/bl/BlFaturamentoTab.tsx src/components/bl/BlCobrancasTab.tsx
git commit -m "feat(bl): BlFaturamentoTab composing cliente, cobrancas, demurrage"
```

---

## Task 5: `BlDetalhesTab` + trim Operacional/Carga duplication (Componente D)

**Files:**
- Create: `src/components/bl/BlDetalhesTab.tsx`
- Modify: `src/components/bl/BlOperacionalTab.tsx` (remove the invoice/financial header badges + `free_time_override` field)
- Modify: `src/components/bl/BlCargaTab.tsx` (remove BB parties table 208-227; remove return-date/demurrage columns 119-120, 126-170)

- [ ] **Step 1: Remove duplicated/relocated bits from `BlOperacionalTab`**

- Remove the `free_time_override` `<Field>` (lines 179-185).
- Remove the active-invoice `<Link>` and `financial_status` badge from the header (they now live in `BlFaturamentoTab`); keep the Modo/Revisao badges.
- Remove `useInvoiceLinks`/`latestInvoice`/`invoiceDiverges` if now unused (verify with build).

- [ ] **Step 2: Trim `BlCargaTab` to physical composition only**

- Delete the BB parties table (lines 208-227 — Shipper/Consignee/Notify/POL/POD).
- Delete the container table's "Devolucao" and "Demurrage" header cells and their `<td>`s (header 119-120; body 140-170), plus the now-unused `returnDates`/`savingReturnDate` state and `handleSaveReturnDate` (moved to `BlDemurrageSection`). Keep nº/seal/tipo/peso/CBM/OOG/IMO/descarga and the vehicles table.

- [ ] **Step 3: Implement `BlDetalhesTab`**

```tsx
// src/components/bl/BlDetalhesTab.tsx
import type { FormEvent } from 'react'
import { BlOperacionalTab } from './BlOperacionalTab'
import { BlCargaTab } from './BlCargaTab'
import type { BlForm } from '../../hooks/useBlEditForm'
import type { CargoMode } from '../../pages/blDetalheHelpers'
import type { ContainerSummary, BreakbulkSummary } from './BlCargaTab'
import type { BLDetail } from '../../types/database'

export function BlDetalhesTab(props: {
  active: boolean
  bl: BLDetail
  blId?: string
  form: BlForm
  changes: (keyof BlForm)[]
  saving: boolean
  justification: string
  cargoMode: CargoMode
  isContainerMode: boolean
  containerSummary: ContainerSummary
  breakbulkSummary: BreakbulkSummary
  onFieldChange: <K extends keyof BlForm>(field: K, value: BlForm[K] | string) => void
  onJustificationChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  if (!props.active) return null
  return (
    <div className="grid gap-5">
      <BlOperacionalTab active bl={props.bl} form={props.form} changes={props.changes} saving={props.saving} justification={props.justification} cargoMode={props.cargoMode} isContainerMode={props.isContainerMode} onFieldChange={props.onFieldChange} onJustificationChange={props.onJustificationChange} onSubmit={props.onSubmit} />
      <BlCargaTab active bl={props.bl} blId={props.blId} isContainerMode={props.isContainerMode} containerSummary={props.containerSummary} breakbulkSummary={props.breakbulkSummary} />
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/bl/BlDetalhesTab.tsx src/components/bl/BlOperacionalTab.tsx src/components/bl/BlCargaTab.tsx
git commit -m "feat(bl): BlDetalhesTab; trim Operacional/Carga duplication"
```

---

## Task 6: Rewire `BlDetalhe.tsx` to 3 tabs

**Files:**
- Modify: `src/pages/BlDetalhe.tsx`
- Modify: `src/components/bl/BlFinanceiroTab.tsx` (delete file; ensure no imports remain)
- Test: `src/pages/__tests__/blTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/__tests__/blTabs.test.tsx
import { describe, expect, it } from 'vitest'
import { BL_TABS, isBlTab } from '../BlDetalhe'

describe('BL tabs', () => {
  it('exposes exactly the three tabs', () => {
    expect(BL_TABS.map((t) => t.key)).toEqual(['detalhes', 'faturamento', 'historico'])
  })
  it('guards tab keys', () => {
    expect(isBlTab('detalhes')).toBe(true)
    expect(isBlTab('operacional')).toBe(false)
  })
})
```

(Export `BL_TABS` and `isBlTab` from `BlDetalhe.tsx` for the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/blTabs.test.tsx`
Expected: FAIL — current keys are 5 and `operacional` is valid.

- [ ] **Step 3: Update the tab model and rendering**

```tsx
export type BlTab = 'detalhes' | 'faturamento' | 'historico'
export const BL_TABS: { key: BlTab; label: string }[] = [
  { key: 'detalhes', label: 'Detalhes do B/L' },
  { key: 'faturamento', label: 'Faturamento' },
  { key: 'historico', label: 'Histórico' },
]
export function isBlTab(value: string | null): value is BlTab {
  return value === 'detalhes' || value === 'faturamento' || value === 'historico'
}
```

- Default `activeTab` → `'detalhes'`; in the tab `onClick`, delete the `tab` param when `key === 'detalhes'` (was `'operacional'`).
- Replace the four `<Bl*Tab>` renders with `<BlDetalhesTab … />` and `<BlFaturamentoTab active={activeTab === 'faturamento'} bl={bl} />`. Keep the inline Histórico block for now (Plan 3 replaces it).
- Remove imports of `BlOperacionalTab`, `BlCargaTab`, `BlCobrancasTab`, `BlFinanceiroTab` from the page (now nested inside the new tabs); import `BlDetalhesTab` and `BlFaturamentoTab`.
- Delete `src/components/bl/BlFinanceiroTab.tsx`.

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/pages/__tests__/blTabs.test.tsx`
Expected: PASS.
Run: `npm run build`
Expected: PASS (no dangling imports of the deleted file).

- [ ] **Step 5: Update route docs if needed**

The tabs are query params (`?tab=`), not routes, so `src/App.tsx` and `docs/ARCHITECTURE.md` route lists are unaffected. Run `npm run docs:check` to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BlDetalhe.tsx
git rm src/components/bl/BlFinanceiroTab.tsx
git commit -m "feat(bl): collapse detail to 3 tabs (Detalhes do B/L, Faturamento, Historico)"
```

---

## Self-Review

**Spec coverage (Componentes D–F):**
- D (Carga: remove parties table; move demurrage columns out) → Task 5 Step 2. ✓
- E (Cliente section; remove "Informações financeiras" card) → Task 1; the info-financeira card is dropped by deleting `BlFinanceiroTab` and not porting that card (Task 6 Step 3). ✓
- F (rename Cobranças→Faturamento; move invoice/financial header; consolidated audited demurrage) → Tasks 2, 3, 4. ✓

**Placeholder scan:** Move-only steps reference exact source ranges; new-logic steps show complete code. No TBD/TODO.

**Type consistency:** `ContainerSummary`/`BreakbulkSummary` imported from `BlCargaTab` (their current export site). `queryKeys.bls.detail(bl.id)` matches `src/services/queryKeys.ts`. `save_bl_review` arg names match `useBlEditForm` and the migration signature.

**Risk:** demurrage overrides now require `expected_updated_at` → handle `PT409`/`40001` (Task 3 Step 3). Validate manually that saving overrides twice in a row reloads, not silently fails.
