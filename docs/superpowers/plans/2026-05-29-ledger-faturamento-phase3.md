# Ledger Faturamento Phase 3 Implementation Plan

> Execute task-by-task. Steps use checkbox (`- [ ]`). Execute only the next unmarked block, verify, mark it, commit small. Do not start Phase 4 (payment/reconciliation cutover) without a new plan.

**Goal:** Let operators issue **consolidated** local-charge invoices from the ledger and print them. Adds a dedicated "Nova Consolidada" modal driven by `useConsolidatableReceivables` + `useCreateConsolidatedInvoice`, and renders the consolidated invoice PDF from `invoice_receivable_links`.

**Decisions (confirmed with user):**
1. **Add alongside** — keep the existing individual/multi-BL "Nova Invoice" modal and its `create_invoice_from_bls` flow fully intact. Add a separate button + self-contained modal for consolidated. No changes to the existing modal's behavior.
2. **PDF from `invoice_receivable_links`** — consolidated ledger invoices have no `invoice_items`/`invoice_bls`; the PDF groups by B/L using the links + snapshots. We feed the existing `InvoiceDocumentLocal` an `InvoiceDetail` built from links, so the PDF component itself does not change.

**Architecture:** `create_local_consolidated_invoice` (Phase 2) writes an `invoices` row (`invoice_type='consolidated'`, `bl_id NULL`) plus `invoice_receivable_links`. There are no `invoice_items`, so `list_invoice_details` returns empty `bls`/`items`. We extend the `listInvoiceDetails` **service** (no migration) to enrich consolidated invoices from the links so the existing print/PDF path works unchanged.

**Tech Stack:** React/TypeScript, TanStack Query, existing UI primitives, Vitest.

---

## Scope Boundary

In scope:
- Extend `listInvoiceDetails` to render consolidated ledger invoices.
- New `ConsolidatedInvoiceModal` component + a "Nova Consolidada" button in `Faturamento.tsx`.
- A unit test for the modal's eligibility gating and total.

Out of scope (Phase 4 / explicit):
- **Payment of consolidated invoices.** The existing invoice-list "pay" action still calls the legacy `register_invoice_payment`, which does **not** settle ledger receivables. Consolidated invoices must be paid through the ledger RPC (`register_ledger_invoice_payment`) — that cutover is Phase 4. Until then, operators should not use the legacy pay button on a consolidated invoice. This caveat is documented in the PR.
- Reconciliation cutover, portal/reports balance migration, Demurrage.
- Touching the existing individual-invoice modal or `create_invoice_from_bls`.

## File Structure

- Modify `src/services/billing.ts` — enrich `listInvoiceDetails` for consolidated invoices.
- Create `src/components/billing/ConsolidatedInvoiceModal.tsx` — the new modal.
- Modify `src/pages/Faturamento.tsx` — add the button + mount the modal.
- Create `src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx` — unit test.

---

### Task 1: Render Consolidated Invoices in the PDF Path

**Files:**
- Modify: `src/services/billing.ts`

- [ ] **Step 1: Enrich `listInvoiceDetails` from `invoice_receivable_links` when there are no items**

In `listInvoiceDetails`, after building `result` and before the "Lazy backfill" pix block, insert an enrichment branch. When the invoice has no `invoice_items` but has `invoice_receivable_links`, build `bls` and one synthesized `items` row per linked B/L from the links (and a voyage/vessel lookup for display):

```ts
  // Consolidated ledger invoices have no invoice_items/invoice_bls; render them
  // from invoice_receivable_links so the existing PDF/print path works unchanged.
  if (result.invoice && result.items.length === 0) {
    const { data: links, error: linksError } = await supabase
      .from('invoice_receivable_links')
      .select('id, bl_id, subtotal_brl, bl_snapshot')
      .eq('invoice_id', invoiceId)

    if (!linksError && links && links.length > 0) {
      const voyageIds = Array.from(
        new Set(
          links
            .map((l) => {
              const snap = (l.bl_snapshot ?? {}) as { voyage_id?: number | null }
              return snap.voyage_id == null ? null : Number(snap.voyage_id)
            })
            .filter((v): v is number => v != null),
        ),
      )

      const voyageMap = new Map<number, { voyage_number: string | null; vessel_name: string | null }>()
      if (voyageIds.length > 0) {
        const { data: voyages } = await supabase
          .from('voyages')
          .select('id, voyage_number, vessel:vessels(name)')
          .in('id', voyageIds)
        for (const v of (voyages ?? []) as unknown as Array<{ id: number; voyage_number: string | null; vessel: { name: string | null } | null }>) {
          voyageMap.set(Number(v.id), { voyage_number: v.voyage_number ?? null, vessel_name: v.vessel?.name ?? null })
        }
      }

      result.bls = links.map((l) => {
        const snap = (l.bl_snapshot ?? {}) as { voyage_id?: number | null; pol?: string | null; pod?: string | null }
        const voy = snap.voyage_id == null ? undefined : voyageMap.get(Number(snap.voyage_id))
        return {
          id: Number(l.id),
          invoice_id: invoiceId,
          bl_id: l.bl_id,
          charge_status_snapshot: null,
          financial_status_snapshot: null,
          subtotal_brl: Number(l.subtotal_brl ?? 0),
          subtotal_usd: 0,
          created_at: null,
          pol: snap.pol ?? null,
          pod: snap.pod ?? null,
          voyage_number: voy?.voyage_number ?? null,
          vessel_name: voy?.vessel_name ?? null,
        }
      })

      result.items = links.map((l) => ({
        id: Number(l.id),
        invoice_id: invoiceId,
        charge_calculation_id: null,
        description: `BL ${l.bl_id} - Taxas locais`,
        quantity: 1,
        unit_value_brl: Number(l.subtotal_brl ?? 0),
        total_value_brl: Number(l.subtotal_brl ?? 0),
        bl_id: l.bl_id,
        manifest_id: null,
        charge_table_id: null,
        charge_item_id: null,
        source: 'ledger',
        currency: 'BRL',
        unit_value_usd: null,
        total_value_usd: null,
        pricing_rule_version_id: null,
        billing_run_id: null,
        calculation_key: null,
        snapshot_payload: null,
      }))
    }
  }
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/services/billing.ts
git commit -m "Render consolidated invoices from receivable links"
```

---

### Task 2: Consolidated Invoice Modal

**Files:**
- Create: `src/components/billing/ConsolidatedInvoiceModal.tsx`
- Modify: `src/pages/Faturamento.tsx`

- [ ] **Step 1: Create the `ConsolidatedInvoiceModal` component**

Self-contained modal using existing UI primitives, `useBillingCustomers`, `useConsolidatableReceivables`, and `useCreateConsolidatedInvoice`. Only `eligibility_status === 'eligible'` rows are selectable; non-eligible rows show their `eligibility_reason` and a disabled checkbox. Footer shows selected count + summed balance. Empty states per spec.

```tsx
import { useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useBillingCustomers } from '../../hooks/useBilling'
import { useConsolidatableReceivables, useCreateConsolidatedInvoice } from '../../hooks/useBillingLedger'

function fmtBRL(v: number | null | undefined) {
  return 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = { open: boolean; onClose: () => void }

export function ConsolidatedInvoiceModal({ open, onClose }: Props) {
  const { showToast } = useToast()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const { data: customerOptions } = useBillingCustomers(customerSearch)
  const { data: receivables, isLoading } = useConsolidatableReceivables({
    customerId,
    search: search.trim() || null,
  })
  const createMutation = useCreateConsolidatedInvoice()

  const rows = receivables ?? []
  const selectedRows = rows.filter((r) => selected.includes(r.receivable_id))
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.balance_brl ?? 0), 0)

  const eligibleCount = useMemo(() => rows.filter((r) => r.eligibility_status === 'eligible').length, [rows])

  function reset() {
    setCustomerId(null)
    setCustomerSearch('')
    setSearch('')
    setDueDate('')
    setNotes('')
    setSelected([])
    setError('')
  }

  function close() {
    reset()
    onClose()
  }

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit() {
    setError('')
    if (!customerId) {
      setError('Selecione um cliente.')
      return
    }
    if (selected.length === 0) {
      setError('Selecione ao menos um B/L com saldo aberto.')
      return
    }
    try {
      const result = await createMutation.mutateAsync({
        customerId,
        receivableIds: selected,
        dueDate: dueDate || null,
        notes: notes || null,
      })
      showToast(`Consolidada ${result.invoice_number} emitida (${fmtBRL(result.total_brl)}).`, 'success')
      close()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao emitir consolidada.'
      setError(message)
      showToast(message, 'error')
    }
  }

  const selectedCustomer = customerOptions?.find((c) => c.id === customerId)

  return (
    <Modal open={open} onClose={close} title="Nova Consolidada" className="invoice-create-dialog">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Cliente" required>
          <div style={{ position: 'relative' }}>
            <Input
              placeholder="Buscar cliente..."
              value={selectedCustomer ? `${selectedCustomer.name}` : customerSearch}
              onChange={(e) => {
                setCustomerId(null)
                setSelected([])
                setCustomerSearch(e.target.value)
                setPickerOpen(true)
              }}
              onFocus={() => setPickerOpen(true)}
            />
            {pickerOpen && !customerId && (customerOptions?.length ?? 0) > 0 && (
              <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, background: 'var(--app-surface)', border: '1px solid var(--app-border)', borderRadius: 8, marginTop: 4, maxHeight: 220, overflowY: 'auto' }}>
                {customerOptions!.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id)
                      setCustomerSearch('')
                      setPickerOpen(false)
                      setSelected([])
                    }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{c.cnpj_cpf}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        <Field label="Buscar B/L">
          <Input placeholder="Filtrar por B/L..." value={search} onChange={(e) => setSearch(e.target.value)} disabled={!customerId} />
        </Field>

        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--app-border)', borderRadius: 8 }}>
          {!customerId ? (
            <EmptyState title="Selecione um cliente" description="Selecione um cliente para ver B/Ls com saldo aberto." />
          ) : isLoading ? (
            <EmptyState title="Carregando..." description="Buscando B/Ls com saldo aberto." />
          ) : rows.length === 0 ? (
            <EmptyState title="Sem B/Ls" description="Cliente não possui B/Ls abertos para consolidar." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--app-border)' }}>
                  <th style={{ padding: '8px' }}></th>
                  <th style={{ padding: '8px' }}>B/L</th>
                  <th style={{ padding: '8px' }}>Navio/Viagem</th>
                  <th style={{ padding: '8px' }}>Individual</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Saldo</th>
                  <th style={{ padding: '8px' }}>Elegibilidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const eligible = r.eligibility_status === 'eligible'
                  return (
                    <tr key={r.receivable_id} style={{ borderBottom: '1px solid var(--app-border)', opacity: eligible ? 1 : 0.6 }}>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(r.receivable_id)}
                          disabled={!eligible}
                          onChange={() => toggle(r.receivable_id)}
                        />
                      </td>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{r.bl_id}</td>
                      <td style={{ padding: '8px' }}>{[r.vessel_name, r.voyage_number].filter(Boolean).join(' ') || '—'}</td>
                      <td style={{ padding: '8px' }}>{r.individual_invoice_number ?? '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{fmtBRL(r.balance_brl)}</td>
                      <td style={{ padding: '8px' }}>
                        {eligible ? (
                          <Badge tone="green">Elegível</Badge>
                        ) : (
                          <span style={{ fontSize: 12, opacity: 0.8 }}>{r.eligibility_reason}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Vencimento">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Observações">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>

        {error && <div style={{ color: 'var(--app-danger, #dc2626)', fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--app-border)', paddingTop: 12 }}>
          <div style={{ fontSize: 13 }}>
            {selected.length} de {eligibleCount} elegíveis · <strong>{fmtBRL(selectedTotal)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={close}>Cancelar</Button>
            <Button variant="primary" onClick={submit} loading={createMutation.isPending} disabled={selected.length === 0}>
              Emitir consolidada
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Wire the button and modal into `Faturamento.tsx`**

Add a state flag and import, render a "Nova Consolidada" button next to the existing "Nova Invoice" action, and mount the modal. Keep all existing modal code untouched.

- Import near the other component imports:
```tsx
import { ConsolidatedInvoiceModal } from '../components/billing/ConsolidatedInvoiceModal'
```
- Add state next to `createOpen`:
```tsx
const [consolidatedOpen, setConsolidatedOpen] = useState(false)
```
- In the `PageHeader` action area, add a secondary button before/after the existing "Nova Invoice" button:
```tsx
<Button variant="secondary" onClick={() => setConsolidatedOpen(true)}>Nova Consolidada</Button>
```
- Mount the modal near the other modals (e.g. after the create modal):
```tsx
<ConsolidatedInvoiceModal open={consolidatedOpen} onClose={() => setConsolidatedOpen(false)} />
```

- [ ] **Step 3: Verify build and lint**

```bash
npm run build
npm run lint
```

Expected: pass (lint may emit only pre-existing warnings unrelated to new files).

- [ ] **Step 4: Commit**

```bash
git add src/components/billing/ConsolidatedInvoiceModal.tsx src/pages/Faturamento.tsx
git commit -m "Add consolidated invoice modal"
```

---

### Task 3: Unit Test and Verification

**Files:**
- Create: `src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx`

- [ ] **Step 1: Add a unit test for eligibility gating and total**

Mock the ledger/customer hooks and assert: non-eligible rows show their reason and a disabled checkbox; selecting eligible rows updates the summed balance; submit calls `createConsolidatedInvoice` with the selected receivable ids. Follow the mocking style of `src/pages/__tests__/Faturamento.test.ts`.

- [ ] **Step 2: Run the test suite**

```bash
npm test
```

Expected: all tests pass; integration tests remain skipped.

- [ ] **Step 3: Confirm the existing individual modal is untouched**

```bash
git diff --stat HEAD~3 -- src/pages/Faturamento.tsx
```

Expected: only additive changes (button, state, modal mount, import) — no edits to the existing create-invoice modal logic.

- [ ] **Step 4: Final build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx
git commit -m "Add consolidated invoice modal test"
```

---

## Follow-Up Plans

After Phase 3:
1. Phase 4: route consolidated (and individual) payments through `register_ledger_invoice_payment`, cut PIX reconciliation over to `reconcile_invoice_payment_by_txid` (drop CNPJ+valor fallback), and migrate portal/report balances to receivables.
2. Auto-issue individual invoices + auto-sync receivables when a B/L becomes ready for billing.
