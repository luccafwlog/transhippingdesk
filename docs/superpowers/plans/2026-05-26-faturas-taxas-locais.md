# Faturas Taxas Locais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `InvoiceDocumentLocal.tsx` to mirror the demurrage invoice visually (logo, grouped items for consolidated invoices, PIX section) and fix `pix_payload` generation in `billing.ts` so all taxas locais invoices get a QR Code.

**Architecture:** Two independent changes — (1) pure UI rewrite of the invoice component, (2) service-layer PIX generation added to `createInvoiceFromBls`, `createInvoiceFromGraniteBls`, and lazy backfill in `listInvoiceDetails`. No DB migrations needed.

**Tech Stack:** React 19, TypeScript, `qrcode.react` (QRCodeSVG), Supabase JS client, `src/lib/pix.ts` (buildTransshippingPixPayload)

---

## File Map

| File | Change |
|---|---|
| `src/components/billing/InvoiceDocumentLocal.tsx` | Full rewrite |
| `src/services/billing.ts` | Add PIX generation in 3 functions |

---

### Task 1: Rewrite InvoiceDocumentLocal.tsx

**Files:**
- Modify: `src/components/billing/InvoiceDocumentLocal.tsx`

The new component must:
- Use logo `/branding/transhipping-logo-cropped.png` (height 52px), `onError` hides it
- Show `Nº {invoice_number}` top-right in `#1A2744`
- Title: `FATURA DE TAXAS LOCAIS` (1 BL) or `FATURA CONSOLIDADA DE TAXAS LOCAIS` (2+ BLs), uppercase bold centered
- `<hr>` 2px solid `#111`
- Metadata table using `labelCell` style (width 130, fontWeight 700): Cliente (name + CNPJ), B/Ls (comma-joined, color `#1A2744`), Navio/Voy. (distinct vessel+voyage pairs), Emissão — **no Vencimento**
- Items table:
  - 1 BL: flat rows, zebra, cols: Descrição | Qtd | Unit. BRL | Total BRL
  - 2+ BLs: grouped by `bl_id` — header row (`colspan=4`, `#e8edf5`, `#1A2744` bold) with `B/L {bl_id} — {pol} → {pod}`, items indented (`paddingLeft: 16`), subtotal row per group (`colspan=3` right-aligned, `#f0f4fa`, `#1A2744`)
  - TOTAL row: `colspan=3`, `#F59E0B`, fontWeight 700
- No bank details section, no vencimento row, no payments history
- PIX section (only if `invoice.pix_payload` truthy): QRCodeSVG size 90, title "PAGAMENTO VIA PIX", "Valor da fatura: {total_brl}", "PIX COPIA E COLA" label, monospace payload block
- Footer: `Vitória, {longDate()}` right-aligned, 12px `#555`

- [ ] **Step 1: Replace InvoiceDocumentLocal.tsx with the new implementation**

```tsx
import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '../../services/billing'

function fmtBRL(v: number | null | undefined) {
  const n = Number(v ?? 0)
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function fmtCNPJ(s: string | null | undefined) {
  if (!s) return ''
  const d = s.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s
}

function longDate() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }
const labelCell: React.CSSProperties = { ...cell, fontWeight: 700, width: 130, whiteSpace: 'nowrap' }

type Props = { detail: InvoiceDetail }

export function InvoiceDocumentLocal({ detail }: Props) {
  const { invoice, bls, items } = detail
  if (!invoice) return null

  const isConsolidated = bls.length >= 2
  const title = isConsolidated ? 'FATURA CONSOLIDADA DE TAXAS LOCAIS' : 'FATURA DE TAXAS LOCAIS'

  const blIds = bls.map((b) => b.bl_id).join(', ') || '—'

  const vesselVoyages = Array.from(
    new Set(
      bls
        .filter((b) => b.vessel_name || b.voyage_number)
        .map((b) => `${b.vessel_name ?? ''} ${b.voyage_number ?? ''}`.trim()),
    ),
  ).join(', ') || '—'

  // Group items by bl_id for consolidated layout
  const itemsByBl: Record<string, typeof items> = {}
  for (const item of items) {
    const key = (item as { bl_id?: string | null }).bl_id ?? '__single__'
    if (!itemsByBl[key]) itemsByBl[key] = []
    itemsByBl[key].push(item)
  }

  const blOrder = isConsolidated ? bls.map((b) => b.bl_id) : ['__single__']

  let zebraIndex = 0

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111', background: 'white' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <img
          src="/branding/transhipping-logo-cropped.png"
          alt="Transhipping"
          style={{ height: 52 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A2744' }}>
          Nº {invoice.invoice_number ?? `INV-${invoice.id}`}
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: 'center', fontSize: '16px', fontWeight: 700, textTransform: 'uppercase', margin: '12px 0 6px' }}>
        {title}
      </div>
      <hr style={{ border: 'none', borderTop: '2px solid #111', margin: '0 0 16px' }} />

      {/* Metadata */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={labelCell}>Cliente:</td>
            <td style={cell}>
              {invoice.customer_name ?? '—'}
              {invoice.customer_cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(invoice.customer_cnpj_cpf)}</> : ''}
            </td>
          </tr>
          <tr>
            <td style={labelCell}>B/Ls:</td>
            <td style={{ ...cell, color: '#1A2744', fontWeight: 600 }}>{blIds}</td>
          </tr>
          <tr>
            <td style={labelCell}>Navio/Voy.:</td>
            <td style={cell}>{vesselVoyages}</td>
          </tr>
          <tr>
            <td style={labelCell}>Emissão:</td>
            <td style={cell}>{fmtDate(invoice.issued_at)}</td>
          </tr>
        </tbody>
      </table>

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#1A2744', color: 'white' }}>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'left' }}>Descrição</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'center' }}>Qtd</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'right' }}>Unit. BRL</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'right' }}>Total BRL</th>
          </tr>
        </thead>
        <tbody>
          {isConsolidated
            ? blOrder.map((blId) => {
                const blMeta = bls.find((b) => b.bl_id === blId)
                const blItems = itemsByBl[blId] ?? []
                const subtotal = blItems.reduce((s, i) => s + Number(i.total_value_brl ?? 0), 0)
                const route = blMeta ? `${blMeta.pol ?? ''} → ${blMeta.pod ?? ''}` : ''
                return (
                  <React.Fragment key={blId}>
                    <tr style={{ background: '#e8edf5' }}>
                      <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: '#1A2744', fontSize: '11px' }}>
                        B/L {blId}{route ? ` — ${route}` : ''}
                      </td>
                    </tr>
                    {blItems.map((item) => {
                      const bg = zebraIndex++ % 2 === 0 ? '#f9fafb' : 'white'
                      return (
                        <tr key={item.id} style={{ background: bg, borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px 8px 8px 16px' }}>{item.description}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: '#f0f4fa', borderBottom: '2px solid #c8d4e8' }}>
                      <td colSpan={3} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1A2744' }}>
                        Subtotal {blId}:
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1A2744' }}>
                        {fmtBRL(subtotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })
            : items.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? '#f9fafb' : 'white', borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 7px' }}>{item.description}</td>
                  <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
                  <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
                  <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
                </tr>
              ))}
          <tr style={{ background: '#F59E0B' }}>
            <td colSpan={3} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>TOTAL:</td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(invoice.total_brl)}</td>
          </tr>
        </tbody>
      </table>

      {/* PIX */}
      {invoice.pix_payload && (
        <div style={{ display: 'flex', gap: 18, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <QRCodeSVG value={invoice.pix_payload} size={90} level="M" />
          </div>
          <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>PAGAMENTO VIA PIX</div>
            <div>Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.</div>
            <div style={{ marginTop: 4 }}>Valor da fatura:</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{fmtBRL(invoice.total_brl)}</div>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 3 }}>PIX COPIA E COLA</div>
            <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '8px', background: '#f3f4f6', padding: '5px 8px', borderRadius: 3, wordBreak: 'break-all', color: '#374151' }}>
              {invoice.pix_payload}
            </span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 24, textAlign: 'right', fontSize: '12px', color: '#555' }}>
        Vitória, {longDate()}
      </div>
    </div>
  )
}
```

Note: `items` in `InvoiceDetail` comes from `InvoiceItem[]` (from `src/types/database.ts`). The `bl_id` field on `InvoiceItem` may need to be checked. If `InvoiceItem` doesn't have `bl_id`, the consolidated grouping falls back to `__single__` key. Check `src/types/database.ts` for the `InvoiceItem` type. If `bl_id` is missing, you can still use the flat layout for all cases and just do the grouping based on `bls` order — see step 2 for the fallback.

- [ ] **Step 2: Check InvoiceItem type has bl_id field**

Open `src/types/database.ts` and search for `InvoiceItem`. If it has a `bl_id` column, the implementation above works as-is. If not, the consolidated grouping needs to use a different approach — items would need to be grouped by matching against the `bls` array using a separate field, or you can store bl order in `itemsByBl` based on insertion order from the RPC response.

Run: `grep -n "InvoiceItem" src/types/database.ts`

If `bl_id` is present on `InvoiceItem`, proceed to step 3. If absent, update the `itemsByBl` logic in the component to use `(item as any).bl_id` or check what field the RPC returns that links items to BLs.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If there are errors about `React` not being in scope (used in `React.Fragment`), add `import React from 'react'` at the top of the file or replace `React.Fragment` with `<>...</>` tags.

- [ ] **Step 4: Commit**

```bash
git add src/components/billing/InvoiceDocumentLocal.tsx
git commit -m "feat: redesign InvoiceDocumentLocal to match demurrage invoice visual"
```

---

### Task 2: Add PIX generation to billing.ts

**Files:**
- Modify: `src/services/billing.ts`

Pattern to follow (from `src/services/demurrage/demurrageInvoices.ts:179`):
```typescript
import { buildTransshippingPixPayload } from '../lib/pix'
// after RPC returns invoice_id:
const { data: inv } = await supabase
  .from('invoices')
  .select('invoice_number, total_brl')
  .eq('id', invoiceId)
  .single()
if (inv?.invoice_number && inv.total_brl) {
  const pix_payload = buildTransshippingPixPayload(
    parseFloat(Number(inv.total_brl).toFixed(2)),
    inv.invoice_number,
  )
  await supabase.from('invoices').update({ pix_payload }).eq('id', invoiceId)
}
```

The RPC `create_invoice_from_bls` returns JSON like `{ invoice_id: number, ... }`. Same for `create_invoice_from_granite_bls`.

- [ ] **Step 1: Add import for buildTransshippingPixPayload at top of billing.ts**

At line 1 of `src/services/billing.ts`, after the existing imports, add:

```typescript
import { buildTransshippingPixPayload } from '../lib/pix'
```

- [ ] **Step 2: Add PIX generation helper function inside billing.ts**

After the existing imports and before `listInvoices`, add:

```typescript
async function persistPixPayload(invoiceId: number): Promise<void> {
  const { data: inv } = await supabase
    .from('invoices')
    .select('invoice_number, total_brl')
    .eq('id', invoiceId)
    .single()
  if (inv?.invoice_number && inv.total_brl && Number(inv.total_brl) > 0) {
    const pix_payload = buildTransshippingPixPayload(
      parseFloat(Number(inv.total_brl).toFixed(2)),
      inv.invoice_number,
    )
    await supabase.from('invoices').update({ pix_payload }).eq('id', invoiceId)
  }
}
```

- [ ] **Step 3: Call persistPixPayload in createInvoiceFromBls**

In `createInvoiceFromBls` (currently lines 241-260), after `if (error) throw error`, extract the `invoice_id` and call `persistPixPayload`:

```typescript
export async function createInvoiceFromBls(input: {
  blIds: string[]
  customerId?: number | null
  dueDate?: string | null
  notes?: string | null
  issueNow?: boolean
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('create_invoice_from_bls', {
    p_bl_ids: input.blIds,
    p_customer_id: input.customerId ?? null,
    p_due_date: input.dueDate ?? null,
    p_notes: input.notes ?? null,
    p_issue_now: input.issueNow ?? true,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error

  const result = (data ?? {}) as Json
  const invoiceId = (result as { invoice_id?: number }).invoice_id
  if (invoiceId) {
    await persistPixPayload(invoiceId)
  }

  return result
}
```

- [ ] **Step 4: Call persistPixPayload in createInvoiceFromGraniteBls**

Same pattern in `createInvoiceFromGraniteBls` (currently lines 222-239):

```typescript
export async function createInvoiceFromGraniteBls(input: {
  graniteBlIds: string[]
  customerId?: number | null
  dueDate?: string | null
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('create_invoice_from_granite_bls', {
    p_granite_bl_ids: input.graniteBlIds,
    p_customer_id: input.customerId ?? null,
    p_due_date: input.dueDate ?? null,
    p_notes: input.notes ?? null,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error

  const result = (data ?? {}) as Json
  const invoiceId = (result as { invoice_id?: number }).invoice_id
  if (invoiceId) {
    await persistPixPayload(invoiceId)
  }

  return result
}
```

- [ ] **Step 5: Add lazy backfill in listInvoiceDetails**

In `listInvoiceDetails` (currently lines 135-155), after building the return object, add the backfill before returning:

```typescript
export async function listInvoiceDetails(invoiceId: number) {
  const { data, error } = await supabase.rpc('list_invoice_details', {
    p_invoice_id: invoiceId,
  })

  if (error) throw error

  const payload = (data ?? {}) as {
    invoice?: InvoiceDetail['invoice']
    bls?: InvoiceDetail['bls']
    items?: InvoiceDetail['items']
    payments?: InvoiceDetail['payments']
  }

  const result: InvoiceDetail = {
    invoice: payload.invoice ?? null,
    bls: payload.bls ?? [],
    items: payload.items ?? [],
    payments: payload.payments ?? [],
  }

  // Lazy backfill: generate pix_payload for existing invoices that don't have one
  const inv = result.invoice
  const activeStatuses = ['issued', 'partially_paid', 'overdue', 'paid']
  if (
    inv &&
    !inv.pix_payload &&
    inv.invoice_number &&
    inv.total_brl &&
    Number(inv.total_brl) > 0 &&
    activeStatuses.includes(inv.status ?? '')
  ) {
    const pix_payload = buildTransshippingPixPayload(
      parseFloat(Number(inv.total_brl).toFixed(2)),
      inv.invoice_number,
    )
    await supabase.from('invoices').update({ pix_payload }).eq('id', invoiceId)
    // Update the in-memory object so the caller sees the payload immediately
    result.invoice = { ...inv, pix_payload }
  }

  return result
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Common issues: `Json` type from `database.ts` may need narrowing when reading `invoice_id` — the cast `(result as { invoice_id?: number }).invoice_id` handles that. If `InvoiceSummary` (the type of `result.invoice`) doesn't include `pix_payload`, the spread `{ ...inv, pix_payload }` may have a type error — in that case cast: `result.invoice = { ...inv, pix_payload } as typeof inv`.

- [ ] **Step 7: Commit**

```bash
git add src/services/billing.ts
git commit -m "feat: generate and persist pix_payload for taxas locais invoices"
```
