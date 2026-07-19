# Ficha do Cliente — Hub de Consulta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestruturar `/clientes/:cnpj` em um hub de consulta com 5 abas (Visão Geral · Cadastro & Contatos · Operacional · Financeiro · Histórico) que revela tudo que o sistema conecta ao cliente, com deep links para agir onde os fluxos já existem, e remover os campos comerciais mortos (`payment_terms_days`, `discount_pct`, `commercial_notes`) de código e banco.

**Architecture:** A página `ClienteFicha.tsx` (485 linhas, arquivo único) vira um shell fino de abas via `?tab=` (useSearchParams), com cada aba extraída para `src/components/clientes/`. Um novo serviço `customerFicha.ts` concentra as consultas por cliente (demurrage, recebíveis, pagamentos, tarifas, pendências, timeline), consumido por hooks em `useCustomerFicha.ts`. Nenhum CRUD novo: ações continuam onde vivem hoje (Taxas Locais, aba Cobranças do B/L, Faturamento, Demurrage, fila do Portal) — a Ficha lê e linka. A única escrita nova é a migration que dropa as colunas mortas e recria a RPC `update_customer_with_audit` sem elas.

**Tech Stack:** React 18 + TypeScript, React Router (useSearchParams), TanStack Query v5, Supabase JS, Tailwind (tokens do design system existente), Vitest + Testing Library (padrão `*.behavior.test.tsx` com mocks hoisted).

**Decisões da sessão de design (2026-07-18, confirmadas pelo usuário):**

- Reestruturar em abas + extrair componentes; navegação por `?tab=` mantendo rota única.
- 5 abas: Visão Geral (padrão) · Cadastro & Contatos (Portal fundido aqui) · Operacional · Financeiro · Histórico. **Granito fora.**
- Ficha é hub de consulta + deep links; não duplica CRUDs. Reconciliação resolve-se no B/L (deep link). Exceção pré-existente mantida: painel do Portal embutido.
- Saldo Pendente consolidado (local + demurrage) com decomposição — vira termo do glossário.
- Financeiro mostra: invoices locais + demurrage (com disputas), recebíveis/ledger, pagamentos de todos os métodos, tarifas em leitura (overrides gerais + B/Ls com cobrança manual).
- Visão Geral: identidade + saldo consolidado + pendências (reconciliação, portal não ativo, invoices vencidas, disputas abertas, demurrage correndo) + atividade recente.
- Histórico: timeline completa (auditoria do cadastro, eventos de portal, contatos, eventos financeiros) — montada só de fontes já existentes, sem schema novo.
- Campos comerciais mortos: remover do código **e** migration de drop. Sem ADR (migration comentada + CHANGELOG bastam).
- Glossário ganha "Ficha do Cliente" e "Saldo Pendente do Cliente".
- Perfil primário: Documentação. Financeiro segue o RBAC atual (`invoices_access_denied` pattern).

**Arquivos protegidos:** `src/types/database.ts` será editado (remoção dos 3 campos de `Customer`) e uma migration nova será criada. Ambos autorizados explicitamente pelo usuário na sessão de design. O hook de guarda pode pedir confirmação — isso é esperado; não contornar sem ela.

---

## File Structure

```
supabase/migrations/
  207_drop_customer_commercial_fields.sql   (create) drop das 3 colunas + recria RPC

src/types/database.ts                       (modify) remove 3 campos de Customer
src/services/customers.ts                   (modify) CustomerEditableFields sem os 3 campos
src/services/customerFicha.ts               (create) consultas por cliente da Ficha
src/services/queryKeys.ts                   (modify) namespace customerFicha
src/hooks/useCustomerFicha.ts               (create) hooks TanStack das consultas novas
src/pages/ClienteFicha.tsx                  (modify) vira shell de abas (~120 linhas)
src/components/clientes/FichaTabs.tsx       (create) barra de abas + helper de tab ativa
src/components/clientes/VisaoGeralTab.tsx   (create)
src/components/clientes/CadastroContatosTab.tsx (create) cadastro+contatos+portal (movidos)
src/components/clientes/OperacionalTab.tsx  (create) B/Ls + pendências de reconciliação
src/components/clientes/FinanceiroTab.tsx   (create) invoices, demurrage, recebíveis, pagamentos, tarifas
src/components/clientes/HistoricoTab.tsx    (create) timeline
src/pages/TaxasLocais.tsx                   (modify) aceita ?tab=overrides&cliente=
src/components/taxasLocais/ChargeOverridesTab.tsx (modify) prop initialCustomerSearch

src/pages/__tests__/ClienteFicha.behavior.test.tsx (modify) fixture + navegação de abas
src/services/__tests__/customerFicha.test.ts       (create) montagem de saldo/timeline (puro)

CONTEXT.md                                  (modify) 2 termos novos
docs/ARCHITECTURE.md                        (modify) descrição da ficha em abas
docs/RASTREABILIDADE.md                     (modify) linhas da rota /clientes/:cnpj
docs/CHANGELOG.md                           (modify) entrada da entrega
docs/plans/README.md                        (modify) linha deste plano
```

Convenções a seguir: componentes de card/tabela copiam o estilo dos existentes na própria `ClienteFicha.tsx` (Card, app-table, MetricCard); testes seguem o padrão de mocks hoisted de `ClienteFicha.behavior.test.tsx`; query keys entram em `queryKeys.ts` como namespace novo.

---

### Task 1: Migration — drop dos campos comerciais mortos

Os campos `payment_terms_days`, `discount_pct`, `commercial_notes` de `customers` nunca tiveram UI (confirmado na sessão: mortos por decisão). A RPC `update_customer_with_audit` (migration `134`) os referencia no whitelist e no UPDATE — precisa ser recriada sem eles ANTES do drop das colunas.

Número `207`: as migrations `205` e `206` estão reservadas pelo plano
`2026-07-18-bl-cockpit-360.md` (campos documentais do B/L e
`portal_notifications.bl_id`). Se aquele plano for cancelado ou renumerado,
este número pode ser revisto na execução — vale sempre o primeiro livre em
`supabase/migrations/` no momento de criar o arquivo.

**Files:**
- Create: `supabase/migrations/207_drop_customer_commercial_fields.sql`

- [ ] **Step 1: Escrever a migration**

Ler `supabase/migrations/134_atomic_customer_update_audit.sql` inteira primeiro e copiar o corpo da função, removendo dos três pontos: whitelist de `jsonb_object_keys`, os três `CASE WHEN` do UPDATE e qualquer menção nas linhas de auditoria. Estrutura da migration:

```sql
-- Remove os campos comerciais mortos de customers. Nunca tiveram UI de edição
-- (payment_terms_days/discount_pct/commercial_notes eram gravados sempre com o
-- valor antigo pela Ficha) e a sessão de design de 2026-07-18 os declarou
-- mortos por decisão. A RPC update_customer_with_audit é recriada sem eles
-- antes do drop para a função nunca referenciar coluna inexistente.

CREATE OR REPLACE FUNCTION public.update_customer_with_audit(
  p_customer_id BIGINT,
  p_updates JSONB,
  p_changed_by UUID,
  p_justification TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
-- (copiar o corpo INTEIRO da 134 aqui, com as três remoções:)
--  1. whitelist: manter somente 'name','trade_name','address','city','state','zip','notes'
--  2. UPDATE ... SET: remover os CASE de payment_terms_days, discount_pct, commercial_notes
--  3. bloco de audit rows: remover os campos das comparações v_before/v_after
$$;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS payment_terms_days,
  DROP COLUMN IF EXISTS discount_pct,
  DROP COLUMN IF EXISTS commercial_notes;
```

A 134 tem ~130 linhas; a parte de auditoria compara `v_before`/`v_after` campo a campo — conferir cada ocorrência dos três nomes com `grep -n 'payment_terms\|discount_pct\|commercial_notes' supabase/migrations/134_atomic_customer_update_audit.sql` e remover todas.

- [ ] **Step 2: Aplicar no banco**

Seguir `WORKFLOW.md` para aplicação de migrations (via MCP Supabase `apply_migration` com o mesmo nome do arquivo). Verificar com `list_migrations` que `207` consta.

- [ ] **Step 3: Verificar que a RPC recusa os campos removidos**

Via `execute_sql` (somente leitura de comportamento, rollback implícito por erro esperado):

```sql
SELECT public.update_customer_with_audit(1, '{"payment_terms_days": 30}'::jsonb, auth.uid(), 'teste');
```

Esperado: erro `Campo de cliente nao editavel: payment_terms_days.` (Se o ambiente de execução não tiver sessão auth, o erro de credenciais `42501` também confirma que a função existe e roda.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/207_drop_customer_commercial_fields.sql
git commit -m "feat(db): drop campos comerciais mortos de customers e recria RPC de auditoria"
```

---

### Task 2: Remover os campos mortos do código

**Files:**
- Modify: `src/types/database.ts:30-33` (campos em `Customer`) — **arquivo protegido, edição autorizada**
- Modify: `src/services/customers.ts:7-11` (`CustomerEditableFields`)
- Modify: `src/pages/ClienteFicha.tsx:99-127` (`handleSaveCustomer` original/values)
- Modify: `src/pages/__tests__/ClienteFicha.behavior.test.tsx:60-62` (fixture)
- Modify: `src/services/__tests__/customerUpdateAuditAtomic.test.ts` e `src/hooks/__tests__/useCustomersFilters.test.ts` (referências nos fixtures — localizar com grep)

- [ ] **Step 1: Remover de `Customer` em `src/types/database.ts`**

Remover as três linhas do type:

```ts
  payment_terms_days: number | null
  discount_pct: number | null
  commercial_notes: string | null
```

- [ ] **Step 2: Remover de `CustomerEditableFields` em `src/services/customers.ts`**

```ts
type CustomerEditableFields = Pick<
  Customer,
  'name' | 'trade_name' | 'address' | 'city' | 'state' | 'zip' | 'notes'
>
```

- [ ] **Step 3: Remover do `handleSaveCustomer` em `ClienteFicha.tsx`**

Nos objetos `original` e `values` da chamada `updateCustomerWithAudit`, apagar as três linhas `payment_terms_days: data.payment_terms_days,` / `discount_pct: data.discount_pct,` / `commercial_notes: data.commercial_notes,` (em ambos).

- [ ] **Step 4: Limpar fixtures de teste**

`grep -rn 'payment_terms_days\|discount_pct\|commercial_notes' src` e remover cada ocorrência restante (fixtures de `ClienteFicha.behavior.test.tsx`, `customerUpdateAuditAtomic.test.ts`, `useCustomersFilters.test.ts`). Nenhuma asserção depende dos valores — só objetos de fixture.

- [ ] **Step 5: Verificar**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm test`
Expected: compila sem erro; suíte verde. Qualquer erro de compilação restante aponta exatamente uma referência esquecida — remover e repetir.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove campos comerciais mortos do fluxo de clientes"
```

---

### Task 3: Serviço `customerFicha.ts` — consultas do hub

Concentra todas as consultas novas da Ficha. Funções puras de montagem (saldo consolidado, timeline) separadas das funções de fetch para teste sem mock de rede.

**Files:**
- Create: `src/services/customerFicha.ts`
- Modify: `src/services/queryKeys.ts` (namespace novo)
- Test: `src/services/__tests__/customerFicha.test.ts`

- [ ] **Step 1: Escrever testes das funções puras (falhando)**

```ts
import { describe, expect, it } from 'vitest'
import { buildConsolidatedBalance, buildCustomerTimeline } from '../customerFicha'

describe('buildConsolidatedBalance', () => {
  it('soma local emitido + demurrage não pago com decomposição', () => {
    const result = buildConsolidatedBalance(
      [
        { status: 'issued', balance_brl: 100 },
        { status: 'paid', balance_brl: 999 },
      ],
      [
        { status: 'issued', current_total_brl: 50 },
        { status: 'overdue', current_total_brl: 25 },
        { status: 'paid', current_total_brl: 999 },
        { status: 'cancelled', current_total_brl: 999 },
      ],
    )
    expect(result).toEqual({ localBrl: 100, demurrageBrl: 75, totalBrl: 175 })
  })
})

describe('buildCustomerTimeline', () => {
  it('mescla fontes e ordena do mais recente para o mais antigo', () => {
    const events = buildCustomerTimeline({
      auditLogs: [{ id: 1, field_name: 'name', old_value: 'A', new_value: 'B', changed_at: '2026-07-02T10:00:00Z', justification: 'ajuste', changed_by: null }],
      portalEvents: [{ id: 2, new_decision: 'authorized', new_situation: null, reason: null, created_at: '2026-07-03T10:00:00Z' }],
      contacts: [{ id: 3, name: 'Contato', created_at: '2026-07-01T10:00:00Z' }],
      localInvoices: [{ id: 4, invoice_number: 'INV-1', issued_at: '2026-07-04T10:00:00Z', status: 'issued' }],
      demurrageInvoices: [{ id: 5, doc_number: 'DEM-1', billed_at: '2026-07-05T10:00:00Z', paid_at: null, status: 'issued' }],
      bls: [{ id: 'BL1', created_at: '2026-06-30T10:00:00Z' }],
    })
    expect(events.map((event) => event.kind)).toEqual([
      'demurrage_invoice_issued', 'local_invoice_issued', 'portal_event', 'cadastro_audit', 'contact_created', 'bl_created',
    ])
    expect(events[0].at).toBe('2026-07-05T10:00:00Z')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/services/__tests__/customerFicha.test.ts`
Expected: FAIL — módulo `../customerFicha` não existe.

- [ ] **Step 3: Implementar `src/services/customerFicha.ts`**

```ts
import { supabase } from './supabase'
import type { CustomerContact, CustomerRateOverride, DemurrageInvoice } from '../types/database'

// ── Tipos das linhas consumidas pela Ficha ──────────────────────────────────

export type FichaLocalInvoiceRow = {
  id: number
  invoice_number: string | null
  issued_at: string | null
  due_date: string | null
  total_brl: number | null
  balance_brl: number | null
  status: string | null
}

export type FichaDemurrageInvoiceRow = Pick<
  DemurrageInvoice,
  'id' | 'doc_number' | 'bl_id' | 'due_date' | 'billed_at' | 'paid_at' | 'total_usd' |
  'current_total_brl' | 'status' | 'dispute_open' | 'dispute_status' | 'dispute_subject'
>

export type FichaReceivableRow = {
  id: number
  bl_id: string
  original_amount_brl: number
  settled_amount_brl: number
  balance_brl: number
  status: string
}

export type FichaPaymentRow = {
  id: number
  amount_brl: number
  payment_method: string | null
  paid_at: string | null
  notes: string | null
  invoice: { id: number; invoice_number: string | null } | null
}

export type FichaOverrideRow = Pick<
  CustomerRateOverride,
  'id' | 'override_value' | 'valid_from' | 'valid_to' | 'notes'
> & {
  charge_item: {
    id: number
    name: string | null
    currency: string | null
    charge_table: { id: number; name: string | null; pod: string | null; cargo_mode: string | null } | null
  } | null
}

export type FichaManualChargeBlRow = { bl_id: string; manual_count: number }

export type FichaPendingReconciliationRow = {
  id: string
  consignee: string | null
  customer_reconciliation_status: string | null
}

export type FichaRunningDemurrageRow = {
  container_id: number
  container_number: string | null
  bl_id: string
  discharge_date: string
}

// ── Funções puras (testáveis sem rede) ──────────────────────────────────────

export type ConsolidatedBalance = { localBrl: number; demurrageBrl: number; totalBrl: number }

const UNPAID_DEMURRAGE_STATUSES = new Set(['issued', 'overdue'])

export function buildConsolidatedBalance(
  localInvoices: Array<{ status: string | null; balance_brl: number | null }>,
  demurrageInvoices: Array<{ status: string | null; current_total_brl: number | null }>,
): ConsolidatedBalance {
  const localBrl = localInvoices
    .filter((invoice) => invoice.status === 'issued')
    .reduce((sum, invoice) => sum + Number(invoice.balance_brl ?? 0), 0)
  const demurrageBrl = demurrageInvoices
    .filter((invoice) => UNPAID_DEMURRAGE_STATUSES.has(invoice.status ?? ''))
    .reduce((sum, invoice) => sum + Number(invoice.current_total_brl ?? 0), 0)
  return { localBrl, demurrageBrl, totalBrl: localBrl + demurrageBrl }
}

export type CustomerTimelineEvent = {
  kind:
    | 'cadastro_audit'
    | 'portal_event'
    | 'contact_created'
    | 'local_invoice_issued'
    | 'demurrage_invoice_issued'
    | 'demurrage_invoice_paid'
    | 'bl_created'
  at: string
  label: string
  detail: string | null
  link: string | null
}

export function buildCustomerTimeline(sources: {
  auditLogs: Array<{ id: number; field_name: string; old_value: string | null; new_value: string | null; changed_at: string | null; justification: string | null; changed_by: string | null }>
  portalEvents: Array<{ id: number; new_decision: string | null; new_situation: string | null; reason: string | null; created_at: string }>
  contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>
  localInvoices: Array<{ id: number; invoice_number: string | null; issued_at: string | null; status: string | null }>
  demurrageInvoices: Array<{ id: number; doc_number: string; billed_at: string | null; paid_at: string | null; status: string | null }>
  bls: Array<{ id: string; created_at: string | null }>
}): CustomerTimelineEvent[] {
  const events: CustomerTimelineEvent[] = []

  for (const log of sources.auditLogs) {
    if (!log.changed_at) continue
    events.push({
      kind: 'cadastro_audit',
      at: log.changed_at,
      label: `Cadastro alterado: ${log.field_name}`,
      detail: `${log.old_value ?? '—'} → ${log.new_value ?? '—'}${log.justification ? ` · ${log.justification}` : ''}`,
      link: null,
    })
  }
  for (const event of sources.portalEvents) {
    events.push({
      kind: 'portal_event',
      at: event.created_at,
      label: `Portal: ${event.new_decision ?? event.new_situation ?? 'evento'}`,
      detail: event.reason,
      link: null,
    })
  }
  for (const contact of sources.contacts) {
    if (!contact.created_at) continue
    events.push({ kind: 'contact_created', at: contact.created_at, label: `Contato criado: ${contact.name ?? '—'}`, detail: null, link: null })
  }
  for (const invoice of sources.localInvoices) {
    if (!invoice.issued_at) continue
    events.push({
      kind: 'local_invoice_issued',
      at: invoice.issued_at,
      label: `Invoice emitida: ${invoice.invoice_number ?? `INV-${invoice.id}`}`,
      detail: null,
      link: `/faturamento?invoice=${invoice.id}`,
    })
  }
  for (const invoice of sources.demurrageInvoices) {
    if (invoice.billed_at) {
      events.push({ kind: 'demurrage_invoice_issued', at: invoice.billed_at, label: `Demurrage emitida: ${invoice.doc_number}`, detail: null, link: '/demurrage' })
    }
    if (invoice.paid_at) {
      events.push({ kind: 'demurrage_invoice_paid', at: invoice.paid_at, label: `Demurrage paga: ${invoice.doc_number}`, detail: null, link: '/demurrage' })
    }
  }
  for (const bl of sources.bls) {
    if (!bl.created_at) continue
    events.push({ kind: 'bl_created', at: bl.created_at, label: `B/L vinculado: ${bl.id}`, detail: null, link: `/manifestos/${bl.id}` })
  }

  return events.sort((a, b) => b.at.localeCompare(a.at))
}

// ── Fetches (uma função por bloco da Ficha) ─────────────────────────────────

const PERMISSION_CODES = new Set(['42501'])

function isPermissionError(error: { code?: string | null; message?: string | null }) {
  return PERMISSION_CODES.has(error.code ?? '') || String(error.message ?? '').toLowerCase().includes('permission denied')
}

/** Blocos financeiros retornam `denied: true` quando o RLS nega, sem lançar. */
export type Restrictable<T> = { rows: T[]; denied: boolean }

async function restrictable<T>(promise: PromiseLike<{ data: T[] | null; error: { code?: string | null; message?: string | null } | null }>): Promise<Restrictable<T>> {
  const { data, error } = await promise
  if (error) {
    if (isPermissionError(error)) return { rows: [], denied: true }
    throw error
  }
  return { rows: data ?? [], denied: false }
}

export function fetchCustomerDemurrageInvoices(customerId: number) {
  return restrictable<FichaDemurrageInvoiceRow>(
    supabase
      .from('demurrage_invoices')
      .select('id, doc_number, bl_id, due_date, billed_at, paid_at, total_usd, current_total_brl, status, dispute_open, dispute_status, dispute_subject')
      .eq('customer_id', customerId)
      .order('billed_at', { ascending: false })
      .range(0, 199),
  )
}

export function fetchCustomerReceivables(customerId: number) {
  return restrictable<FichaReceivableRow>(
    supabase
      .from('bl_receivables')
      .select('id, bl_id, original_amount_brl, settled_amount_brl, balance_brl, status')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
      .range(0, 199),
  )
}

export function fetchCustomerPayments(customerId: number) {
  return restrictable<FichaPaymentRow>(
    supabase
      .from('payments')
      .select('id, amount_brl, payment_method, paid_at, notes, invoice:invoices!inner(id, invoice_number, customer_id)')
      .eq('invoice.customer_id', customerId)
      .order('paid_at', { ascending: false })
      .range(0, 199)
      .overrideTypes<FichaPaymentRow[], { merge: false }>(),
  )
}

export async function fetchCustomerRateOverrides(customerId: number): Promise<FichaOverrideRow[]> {
  const { data, error } = await supabase
    .from('customer_rate_overrides')
    .select(`
      id, override_value, valid_from, valid_to, notes,
      charge_item:charge_table_items(
        id, name, currency,
        charge_table:charge_tables(id, name, pod, cargo_mode)
      )
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .overrideTypes<FichaOverrideRow[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

/** B/Ls do cliente que possuem cobrança manual (tarifa diferenciada por B/L). */
export async function fetchCustomerManualChargeBls(customerId: number): Promise<FichaManualChargeBlRow[]> {
  const { data, error } = await supabase
    .from('charge_calculations')
    .select('bl_id, bl:bls!inner(customer_id)')
    .eq('source', 'manual')
    .eq('bl.customer_id', customerId)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ bl_id: string | null }>) {
    if (!row.bl_id) continue
    counts.set(row.bl_id, (counts.get(row.bl_id) ?? 0) + 1)
  }
  return Array.from(counts, ([bl_id, manual_count]) => ({ bl_id, manual_count }))
}

/** B/Ls do cliente com reconciliação ainda não confirmada (match pendente). */
export async function fetchCustomerPendingReconciliation(customerId: number): Promise<FichaPendingReconciliationRow[]> {
  const { data, error } = await supabase
    .from('bls')
    .select('id, consignee, customer_reconciliation_status')
    .eq('customer_id', customerId)
    .in('customer_reconciliation_status', ['pending', 'matched_document', 'matched_name'])
  if (error) throw error
  return (data ?? []) as FichaPendingReconciliationRow[]
}

/** Containers do cliente descarregados e ainda não devolvidos (demurrage correndo). */
export async function fetchCustomerRunningDemurrage(customerId: number): Promise<FichaRunningDemurrageRow[]> {
  const { data, error } = await supabase
    .from('bl_containers')
    .select('id, container_number, bl_id, discharge_date, return_date, bl:bls!inner(customer_id)')
    .eq('bl.customer_id', customerId)
    .not('discharge_date', 'is', null)
    .is('return_date', null)
  if (error) throw error
  return ((data ?? []) as Array<{ id: number; container_number: string | null; bl_id: string; discharge_date: string }>).map(
    (row) => ({ container_id: row.id, container_number: row.container_number, bl_id: row.bl_id, discharge_date: row.discharge_date }),
  )
}

export async function fetchCustomerTimelineSources(customerId: number, contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>, bls: Array<{ id: string; created_at: string | null }>) {
  const [auditLogs, portalEvents, localInvoices, demurrage] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('id, field_name, old_value, new_value, changed_at, justification, changed_by')
      .eq('entity_type', 'customer')
      .eq('entity_id', String(customerId))
      .order('changed_at', { ascending: false })
      .range(0, 99),
    supabase
      .from('portal_provisioning_events')
      .select('id, new_decision, new_situation, reason, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(0, 99),
    supabase
      .from('invoices')
      .select('id, invoice_number, issued_at, status')
      .eq('customer_id', customerId)
      .order('issued_at', { ascending: false })
      .range(0, 99),
    supabase
      .from('demurrage_invoices')
      .select('id, doc_number, billed_at, paid_at, status')
      .eq('customer_id', customerId)
      .order('billed_at', { ascending: false })
      .range(0, 99),
  ])

  for (const result of [auditLogs, portalEvents]) {
    if (result.error) throw result.error
  }
  // Blocos financeiros da timeline degradam silenciosamente sob RLS restrito.
  const localRows = localInvoices.error ? [] : (localInvoices.data ?? [])
  const demurrageRows = demurrage.error ? [] : (demurrage.data ?? [])
  if (localInvoices.error && !isPermissionError(localInvoices.error)) throw localInvoices.error
  if (demurrage.error && !isPermissionError(demurrage.error)) throw demurrage.error

  return buildCustomerTimeline({
    auditLogs: auditLogs.data ?? [],
    portalEvents: portalEvents.data ?? [],
    contacts,
    localInvoices: localRows,
    demurrageInvoices: demurrageRows,
    bls,
  })
}
```

- [ ] **Step 4: Rodar os testes das funções puras**

Run: `npx vitest run src/services/__tests__/customerFicha.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Adicionar namespace em `queryKeys.ts`**

Dentro do objeto `queryKeys` (seguir o padrão dos namespaces existentes):

```ts
  customerFicha: {
    demurrageInvoices: (customerId: number) => ['customer-ficha', 'demurrage-invoices', customerId] as const,
    receivables: (customerId: number) => ['customer-ficha', 'receivables', customerId] as const,
    payments: (customerId: number) => ['customer-ficha', 'payments', customerId] as const,
    rateOverrides: (customerId: number) => ['customer-ficha', 'rate-overrides', customerId] as const,
    manualChargeBls: (customerId: number) => ['customer-ficha', 'manual-charge-bls', customerId] as const,
    pendingReconciliation: (customerId: number) => ['customer-ficha', 'pending-reconciliation', customerId] as const,
    runningDemurrage: (customerId: number) => ['customer-ficha', 'running-demurrage', customerId] as const,
    timeline: (customerId: number) => ['customer-ficha', 'timeline', customerId] as const,
  },
```

- [ ] **Step 6: Verificar compilação e commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: sem erros.

```bash
git add src/services/customerFicha.ts src/services/queryKeys.ts src/services/__tests__/customerFicha.test.ts
git commit -m "feat: serviço de consultas da Ficha do Cliente (saldo consolidado e timeline)"
```

---

### Task 4: Hooks `useCustomerFicha.ts`

**Files:**
- Create: `src/hooks/useCustomerFicha.ts`

- [ ] **Step 1: Implementar os hooks**

```ts
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  fetchCustomerDemurrageInvoices,
  fetchCustomerManualChargeBls,
  fetchCustomerPayments,
  fetchCustomerPendingReconciliation,
  fetchCustomerRateOverrides,
  fetchCustomerReceivables,
  fetchCustomerRunningDemurrage,
  fetchCustomerTimelineSources,
} from '../services/customerFicha'
import type { CustomerContact } from '../types/database'

export function useCustomerDemurrageInvoices(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.demurrageInvoices(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerDemurrageInvoices(customerId!),
  })
}

export function useCustomerReceivables(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.receivables(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerReceivables(customerId!),
  })
}

export function useCustomerPayments(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.payments(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerPayments(customerId!),
  })
}

export function useCustomerRateOverrides(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.rateOverrides(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerRateOverrides(customerId!),
  })
}

export function useCustomerManualChargeBls(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.manualChargeBls(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerManualChargeBls(customerId!),
  })
}

export function useCustomerPendingReconciliation(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.pendingReconciliation(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerPendingReconciliation(customerId!),
  })
}

export function useCustomerRunningDemurrage(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.runningDemurrage(customerId ?? 0),
    enabled: customerId != null,
    queryFn: () => fetchCustomerRunningDemurrage(customerId!),
  })
}

export function useCustomerTimeline(
  customerId: number | null,
  contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>> | undefined,
  bls: Array<{ id: string; created_at: string | null }> | undefined,
) {
  return useQuery({
    queryKey: queryKeys.customerFicha.timeline(customerId ?? 0),
    enabled: customerId != null && contacts !== undefined && bls !== undefined,
    queryFn: () => fetchCustomerTimelineSources(customerId!, contacts ?? [], bls ?? []),
  })
}
```

- [ ] **Step 2: Verificar e commitar**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: sem erros.

```bash
git add src/hooks/useCustomerFicha.ts
git commit -m "feat: hooks de consulta da Ficha do Cliente"
```

---

### Task 5: Shell de abas + extração de Cadastro & Contatos

Refatoração sem mudança de comportamento: o conteúdo atual (cadastro, contatos, portal) migra intacto para `CadastroContatosTab`; `ClienteFicha.tsx` vira shell. As abas novas entram vazias e ganham conteúdo nas Tasks 6–8.

**Files:**
- Create: `src/components/clientes/FichaTabs.tsx`
- Create: `src/components/clientes/CadastroContatosTab.tsx`
- Modify: `src/pages/ClienteFicha.tsx`
- Modify: `src/pages/__tests__/ClienteFicha.behavior.test.tsx`

- [ ] **Step 1: Criar `FichaTabs.tsx`**

```tsx
export const FICHA_TABS = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'cadastro', label: 'Cadastro & Contatos' },
  { id: 'operacional', label: 'Operacional' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'historico', label: 'Histórico' },
] as const

export type FichaTabId = (typeof FICHA_TABS)[number]['id']

export function resolveFichaTab(raw: string | null): FichaTabId {
  return FICHA_TABS.some((tab) => tab.id === raw) ? (raw as FichaTabId) : 'visao-geral'
}

export function FichaTabBar({ active, onSelect }: { active: FichaTabId; onSelect: (tab: FichaTabId) => void }) {
  return (
    <div className="mb-5 flex flex-wrap gap-2" role="tablist">
      {FICHA_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          className={
            active === tab.id
              ? 'rounded-lg bg-[#1f6feb] px-3 py-1.5 text-sm font-semibold text-white'
              : 'rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#161b22]'
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

(Antes de escrever, conferir se `TabButton` de `src/pages/TaxasLocais.tsx` é exportável/reutilizável; se for componente compartilhado em `src/components/ui/`, usar o existente em vez deste markup — regra DRY. Se for local da página, criar como acima.)

- [ ] **Step 2: Criar `CadastroContatosTab.tsx` movendo o código existente**

Mover de `ClienteFicha.tsx` para `src/components/clientes/CadastroContatosTab.tsx`, **sem alterar markup nem lógica**: o formulário de cadastro (Card `mb-5 grid gap-4`, linhas 244–278), a seção Portal (linhas 280–301) e o card de Contatos (linhas 303–395), junto com os handlers `handleSaveCustomer`, `handleSaveContact`, `handleDeleteContact`, os estados `form`/`justification`/`saving`/`contactForm`/`contactSaving`/`portalOpen` e os tipos `CustomerForm`/`ContactForm`/`emptyContact`. Props do componente:

```tsx
type CadastroContatosTabProps = {
  data: NonNullable<ReturnType<typeof useCustomerDetail>['data']>
  cnpj: string
}
```

Dentro do componente, obter `queryClient`, `useAuth`, `useToast`, `useConfirm`, `usePortalProvisioningForCustomer` — exatamente os mesmos hooks que a página usa hoje (recortar/colar as chamadas). O padrão "adjusting state when props change" (`prevFormData`) migra junto.

- [ ] **Step 3: Reescrever `ClienteFicha.tsx` como shell**

```tsx
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { useCustomerDetail } from '../hooks/useCustomers'
import { formatCnpjCpf } from '../lib/utils'
import { FichaTabBar, resolveFichaTab } from '../components/clientes/FichaTabs'
import { CadastroContatosTab } from '../components/clientes/CadastroContatosTab'
import { VisaoGeralTab } from '../components/clientes/VisaoGeralTab'
import { OperacionalTab } from '../components/clientes/OperacionalTab'
import { FinanceiroTab } from '../components/clientes/FinanceiroTab'
import { HistoricoTab } from '../components/clientes/HistoricoTab'

export function ClienteFicha() {
  const { cnpj } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveFichaTab(searchParams.get('tab'))
  const { data, isLoading, error } = useCustomerDetail(cnpj)

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Clientes', to: '/clientes' }, { label: 'Carregando...' }]} />
        <SkeletonCard lines={5} />
      </>
    )
  }

  if (error || !data) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const notFound = !cnpj || code === 'PGRST116' || (!error && !data)
    return (
      <Card className="text-red-200">
        {notFound ? 'Cliente não encontrado.' : 'Falha ao consultar o cliente.'}
      </Card>
    )
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Clientes', to: '/clientes' }, { label: data.name }]} />
      <PageHeader
        title={data.name}
        description={`Ficha do cliente ${formatCnpjCpf(data.cnpj_cpf)} — hub de consulta do cadastro, operação e financeiro.`}
        action={
          <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to="/clientes">
            <ArrowLeft className="mr-1 inline" size={16} />
            Voltar para clientes
          </Link>
        }
      />

      <FichaTabBar
        active={activeTab}
        onSelect={(tab) => setSearchParams((params) => { params.set('tab', tab); return params }, { replace: true })}
      />

      {activeTab === 'visao-geral' ? <VisaoGeralTab data={data} onNavigateTab={(tab) => setSearchParams((params) => { params.set('tab', tab); return params }, { replace: true })} /> : null}
      {activeTab === 'cadastro' ? <CadastroContatosTab data={data} cnpj={cnpj!} /> : null}
      {activeTab === 'operacional' ? <OperacionalTab data={data} /> : null}
      {activeTab === 'financeiro' ? <FinanceiroTab data={data} /> : null}
      {activeTab === 'historico' ? <HistoricoTab data={data} /> : null}
    </>
  )
}
```

Nesta task, criar `VisaoGeralTab`/`OperacionalTab`/`FinanceiroTab`/`HistoricoTab` como stubs mínimos que compilam (conteúdo real nas Tasks 6–8):

```tsx
// exemplo do stub — um por arquivo, ajustando o nome
import { Card } from '../ui/Card'
import type { useCustomerDetail } from '../../hooks/useCustomers'

export function OperacionalTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  return <Card>Em construção — {data.bls?.length ?? 0} B/Ls.</Card>
}
```

(`VisaoGeralTab` recebe também `onNavigateTab: (tab: FichaTabId) => void`.)

- [ ] **Step 4: Atualizar o teste de comportamento**

Em `ClienteFicha.behavior.test.tsx`: os testes de contato/portal agora dependem da aba Cadastro ativa. `useParams` já é mockado; `useSearchParams` NÃO é mockado (MemoryRouter real). Ajustar `renderPage` para abrir na aba certa:

```tsx
function renderPage(initialEntry = '/clientes/12345678000195?tab=cadastro') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ClienteFicha />
    </MemoryRouter>,
  )
}
```

Adicionar teste de navegação:

```tsx
it('abre na Visão Geral por padrão e troca de aba via clique', async () => {
  const user = userEvent.setup()
  renderPage('/clientes/12345678000195')

  expect(screen.getByRole('tab', { name: 'Visão Geral' }).getAttribute('aria-selected')).toBe('true')
  await user.click(screen.getByRole('tab', { name: 'Cadastro & Contatos' }))
  expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeTruthy()
})
```

Os mocks existentes de `usePortalProvisioning`/`services/customers` continuam valendo; os stubs das abas novas não fazem fetch (só `VisaoGeralTab` fará na Task 6 — quando chegar lá, mockar `useCustomerFicha`).

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx`
Expected: PASS (testes existentes + navegação).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: ClienteFicha em shell de abas com Cadastro & Contatos extraído"
```

---

### Task 6: Aba Visão Geral

**Files:**
- Create (substituir stub): `src/components/clientes/VisaoGeralTab.tsx`
- Modify: `src/pages/__tests__/ClienteFicha.behavior.test.tsx`

- [ ] **Step 1: Implementar o componente**

```tsx
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { accountSituationLabel } from '../../lib/portalProvisioningViewModel'
import {
  useCustomerDemurrageInvoices,
  useCustomerPendingReconciliation,
  useCustomerRunningDemurrage,
  useCustomerTimeline,
} from '../../hooks/useCustomerFicha'
import { buildConsolidatedBalance } from '../../services/customerFicha'
import { formatBRL, formatCnpjCpf, formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import type { FichaTabId } from './FichaTabs'

type VisaoGeralTabProps = {
  data: NonNullable<ReturnType<typeof useCustomerDetail>['data']>
  onNavigateTab: (tab: FichaTabId) => void
}

export function VisaoGeralTab({ data, onNavigateTab }: VisaoGeralTabProps) {
  const { data: portalRow } = usePortalProvisioningForCustomer(data.id)
  const { data: demurrage } = useCustomerDemurrageInvoices(data.id)
  const { data: pendingReconciliation } = useCustomerPendingReconciliation(data.id)
  const { data: runningDemurrage } = useCustomerRunningDemurrage(data.id)
  const { data: timeline } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  const financialDenied = data.invoices_access_denied || (demurrage?.denied ?? false)
  const balance = buildConsolidatedBalance(data.invoices ?? [], demurrage?.rows ?? [])
  const primaryContact = (data.customer_contacts ?? []).find((contact) => contact.is_primary) ?? (data.customer_contacts ?? [])[0]

  const today = new Date().toISOString().slice(0, 10)
  const overdueLocal = (data.invoices ?? []).filter((invoice) => invoice.status === 'issued' && invoice.due_date && invoice.due_date < today)
  const overdueDemurrage = (demurrage?.rows ?? []).filter((invoice) => invoice.status === 'overdue' || (invoice.status === 'issued' && invoice.due_date && invoice.due_date < today))
  const openDisputes = (demurrage?.rows ?? []).filter((invoice) => invoice.dispute_open || invoice.dispute_status === 'aberto')

  const pendencias: Array<{ key: string; label: string; onClick?: () => void; to?: string }> = []
  if ((pendingReconciliation?.length ?? 0) > 0) {
    pendencias.push({ key: 'reconciliacao', label: `${pendingReconciliation!.length} B/L(s) com reconciliação de cliente pendente`, onClick: () => onNavigateTab('operacional') })
  }
  if (portalRow && portalRow.account_situation !== 'ativa') {
    pendencias.push({ key: 'portal', label: `Portal não ativo: ${accountSituationLabel(portalRow.account_situation)}`, to: `/clientes/portal?cliente=${data.id}` })
  }
  if (!financialDenied && overdueLocal.length + overdueDemurrage.length > 0) {
    pendencias.push({ key: 'vencidas', label: `${overdueLocal.length + overdueDemurrage.length} invoice(s) vencida(s)`, onClick: () => onNavigateTab('financeiro') })
  }
  if (!financialDenied && openDisputes.length > 0) {
    pendencias.push({ key: 'disputas', label: `${openDisputes.length} disputa(s) de demurrage aberta(s)`, onClick: () => onNavigateTab('financeiro') })
  }
  if ((runningDemurrage?.length ?? 0) > 0) {
    pendencias.push({ key: 'correndo', label: `${runningDemurrage!.length} container(s) com demurrage correndo`, to: '/demurrage' })
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Saldo pendente (local + demurrage)"
          value={financialDenied ? 'Restrito' : formatBRL(balance.totalBrl)}
          tone="primary"
        />
        <MetricCard label="Local" value={financialDenied ? '—' : formatBRL(balance.localBrl)} />
        <MetricCard label="Demurrage" value={financialDenied ? '—' : formatBRL(balance.demurrageBrl)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Identidade</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">CNPJ/CPF</dt><dd>{formatCnpjCpf(data.cnpj_cpf)}</dd></div>
            <div><dt className="text-xs text-slate-500">Cidade/UF</dt><dd>{[data.city, data.state].filter(Boolean).join(' / ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Contato principal</dt><dd>{primaryContact ? `${primaryContact.name ?? '—'} · ${primaryContact.email ?? primaryContact.phone ?? '—'}` : 'Nenhum contato'}</dd></div>
            <div><dt className="text-xs text-slate-500">Portal</dt><dd>{portalRow ? accountSituationLabel(portalRow.account_situation) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">B/Ls vinculados</dt><dd>{data.bls?.length ?? 0}</dd></div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Pendências</h2>
          {pendencias.length === 0 ? (
            <div className="text-sm text-slate-400">Nenhuma pendência aberta.</div>
          ) : (
            <ul className="grid gap-2 text-sm">
              {pendencias.map((item) => (
                <li key={item.key} className="rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-amber-100">
                  {item.to ? (
                    <Link className="hover:underline" to={item.to}>{item.label} →</Link>
                  ) : (
                    <button type="button" className="text-left hover:underline" onClick={item.onClick}>{item.label} →</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Atividade recente</h2>
        {(timeline ?? []).length === 0 ? (
          <div className="text-sm text-slate-400">Sem eventos registrados.</div>
        ) : (
          <ul className="grid gap-2 text-sm">
            {(timeline ?? []).slice(0, 5).map((event) => (
              <li key={`${event.kind}-${event.at}-${event.label}`} className="flex items-baseline gap-3">
                <span className="shrink-0 text-xs text-slate-500">{formatDate(event.at)}</span>
                <span>{event.link ? <Link className="hover:underline" to={event.link}>{event.label}</Link> : event.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
```

Nota: conferir o valor real de situação ativa da conta em `src/lib/portalProvisioningViewModel.ts` (`account_situation`) — se o código interno for outro (ex.: `'active'`), usar o valor do view model, não `'ativa'` chutado.

- [ ] **Step 2: Teste de comportamento**

No `ClienteFicha.behavior.test.tsx`, mockar os hooks novos (padrão do arquivo):

```tsx
vi.mock('../../hooks/useCustomerFicha', () => ({
  useCustomerDemurrageInvoices: () => ({ data: { rows: [], denied: false } }),
  useCustomerPendingReconciliation: () => ({ data: [{ id: 'BL1', consignee: 'X', customer_reconciliation_status: 'matched_name' }] }),
  useCustomerRunningDemurrage: () => ({ data: [] }),
  useCustomerTimeline: () => ({ data: [] }),
  useCustomerReceivables: () => ({ data: { rows: [], denied: false } }),
  useCustomerPayments: () => ({ data: { rows: [], denied: false } }),
  useCustomerRateOverrides: () => ({ data: [] }),
  useCustomerManualChargeBls: () => ({ data: [] }),
}))
```

```tsx
it('Visão Geral mostra saldo consolidado e pendência de reconciliação navegável', async () => {
  const user = userEvent.setup()
  renderPage('/clientes/12345678000195')

  expect(screen.getByText('Saldo pendente (local + demurrage)')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /reconciliação de cliente pendente/ }))
  expect(screen.getByRole('tab', { name: 'Operacional' }).getAttribute('aria-selected')).toBe('true')
})
```

- [ ] **Step 3: Rodar e commitar**

Run: `npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx`
Expected: PASS.

```bash
git add -A
git commit -m "feat: aba Visão Geral da Ficha com saldo consolidado e pendências"
```

---

### Task 7: Abas Operacional e Financeiro

**Files:**
- Create (substituir stubs): `src/components/clientes/OperacionalTab.tsx`, `src/components/clientes/FinanceiroTab.tsx`

- [ ] **Step 1: Implementar `OperacionalTab.tsx`**

Mover a tabela "Histórico de B/Ls" existente (`ClienteFicha.tsx` linhas 397–431, com `REVIEW_STATUS_LABELS`/`FINANCIAL_STATUS_LABELS`/`statusLabel`) para cá, intacta, e acrescentar acima dela o card de reconciliação pendente:

```tsx
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { useCustomerPendingReconciliation } from '../../hooks/useCustomerFicha'
import { FINANCIAL_STATUS_LABELS, REVIEW_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import type { useCustomerDetail } from '../../hooks/useCustomers'

const RECONCILIATION_LABELS: Record<string, string> = {
  pending: 'Pendente',
  matched_document: 'Match CNPJ — aguardando confirmação',
  matched_name: 'Match nome — aguardando confirmação',
}

export function OperacionalTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  const { data: pending } = useCustomerPendingReconciliation(data.id)

  return (
    <>
      {(pending?.length ?? 0) > 0 ? (
        <Card className="mb-5">
          <h2 className="mb-2 text-lg font-semibold text-white">Reconciliação de Cliente pendente</h2>
          <p className="mb-3 text-sm text-slate-400">
            Confirme ou rejeite o vínculo no detalhe de cada B/L (seção Cliente).
          </p>
          <ul className="grid gap-2 text-sm">
            {pending!.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2">
                <span>
                  <Link className="app-table__action" to={`/manifestos/${row.id}`}>{row.id}</Link>
                  <span className="ml-2 text-slate-400">{row.consignee ?? '—'}</span>
                </span>
                <span className="text-xs text-amber-200">{RECONCILIATION_LABELS[row.customer_reconciliation_status ?? ''] ?? row.customer_reconciliation_status}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        {/* Tabela "Histórico de B/Ls" movida sem alteração de ClienteFicha.tsx (linhas 397–431) */}
      </Card>
    </>
  )
}
```

(No lugar do comentário, colar a tabela original inteira — thead B/L · Consignatário · Revisão · Financeiro, links para `/manifestos/${bl.id}`, empty state "Nenhum B/L vinculado.")

- [ ] **Step 2: Implementar `FinanceiroTab.tsx`**

Cinco cards empilhados. O card de invoices locais é o existente (linhas 433–480 da `ClienteFicha.tsx` original), movido intacto, incluindo o aviso `invoices_access_denied`. Os demais:

```tsx
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import {
  useCustomerDemurrageInvoices,
  useCustomerManualChargeBls,
  useCustomerPayments,
  useCustomerRateOverrides,
  useCustomerReceivables,
} from '../../hooks/useCustomerFicha'
import { formatBRL, formatDate, formatUSD } from '../../lib/utils'
import { INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import type { useCustomerDetail } from '../../hooks/useCustomers'

const DEMURRAGE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', issued: 'Emitida', paid: 'Paga', overdue: 'Vencida', cancelled: 'Cancelada',
}

export function FinanceiroTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  const { data: demurrage } = useCustomerDemurrageInvoices(data.id)
  const { data: receivables } = useCustomerReceivables(data.id)
  const { data: payments } = useCustomerPayments(data.id)
  const { data: overrides } = useCustomerRateOverrides(data.id)
  const { data: manualBls } = useCustomerManualChargeBls(data.id)

  const restricted = (denied: boolean | undefined) => data.invoices_access_denied || (denied ?? false)

  return (
    <div className="grid gap-5">
      <Card>{/* Invoices locais — card existente movido intacto, com link "Ver no Faturamento" */}</Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Invoices de Demurrage</h2>
          <Link className="app-btn app-btn--secondary" to="/demurrage">Ver no Demurrage</Link>
        </div>
        {restricted(demurrage?.denied) ? (
          <div className="text-sm text-amber-100">Visualização financeira restrita ao perfil autorizado.</div>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[640px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="py-2">Documento</th>
                  <th scope="col" className="py-2">B/L</th>
                  <th scope="col" className="py-2">Emissão</th>
                  <th scope="col" className="py-2">USD</th>
                  <th scope="col" className="py-2">BRL atual</th>
                  <th scope="col" className="py-2">Status</th>
                  <th scope="col" className="py-2">Disputa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {(demurrage?.rows ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="py-4 text-slate-400">Nenhuma invoice de demurrage.</td></tr>
                ) : null}
                {(demurrage?.rows ?? []).map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="py-2">{invoice.doc_number}</td>
                    <td className="py-2"><Link className="app-table__action" to={`/manifestos/${invoice.bl_id}`}>{invoice.bl_id}</Link></td>
                    <td className="py-2">{formatDate(invoice.billed_at)}</td>
                    <td className="py-2">{formatUSD(invoice.total_usd)}</td>
                    <td className="py-2">{formatBRL(invoice.current_total_brl ?? 0)}</td>
                    <td className="py-2">{DEMURRAGE_STATUS_LABELS[invoice.status] ?? invoice.status}</td>
                    <td className="py-2">{invoice.dispute_open || invoice.dispute_status === 'aberto' ? `Aberta${invoice.dispute_subject ? ` · ${invoice.dispute_subject}` : ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Recebíveis (Ledger Local)</h2>
        {restricted(receivables?.denied) ? (
          <div className="text-sm text-amber-100">Visualização financeira restrita ao perfil autorizado.</div>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="py-2">B/L</th>
                  <th scope="col" className="py-2">Original</th>
                  <th scope="col" className="py-2">Liquidado</th>
                  <th scope="col" className="py-2">Saldo</th>
                  <th scope="col" className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {(receivables?.rows ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-slate-400">Nenhum recebível.</td></tr>
                ) : null}
                {(receivables?.rows ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="py-2"><Link className="app-table__action" to={`/manifestos/${row.bl_id}`}>{row.bl_id}</Link></td>
                    <td className="py-2">{formatBRL(row.original_amount_brl)}</td>
                    <td className="py-2">{formatBRL(row.settled_amount_brl)}</td>
                    <td className="py-2">{formatBRL(row.balance_brl)}</td>
                    <td className="py-2">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Pagamentos</h2>
        {restricted(payments?.denied) ? (
          <div className="text-sm text-amber-100">Visualização financeira restrita ao perfil autorizado.</div>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="py-2">Data</th>
                  <th scope="col" className="py-2">Invoice</th>
                  <th scope="col" className="py-2">Valor</th>
                  <th scope="col" className="py-2">Método</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {(payments?.rows ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-slate-400">Nenhum pagamento registrado.</td></tr>
                ) : null}
                {(payments?.rows ?? []).map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-2">{formatDate(payment.paid_at)}</td>
                    <td className="py-2">{payment.invoice ? <Link className="app-table__action" to={`/faturamento?customer=${data.id}&invoice=${payment.invoice.id}`}>{payment.invoice.invoice_number ?? `INV-${payment.invoice.id}`}</Link> : '—'}</td>
                    <td className="py-2">{formatBRL(payment.amount_brl)}</td>
                    <td className="py-2 uppercase">{payment.payment_method ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Tarifas do cliente</h2>
          <Link className="app-btn app-btn--secondary" to={`/taxas-locais?tab=overrides&cliente=${encodeURIComponent(data.name)}`}>
            Gerenciar em Taxas Locais
          </Link>
        </div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Regras gerais (overrides)</h3>
        {(overrides ?? []).length === 0 ? (
          <div className="mb-4 text-sm text-slate-400">Nenhum override cadastrado.</div>
        ) : (
          <ul className="mb-4 grid gap-2 text-sm">
            {(overrides ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2">
                <span className="font-semibold text-white">{row.charge_item?.name ?? '—'}</span>
                <span className="ml-2 text-slate-400">
                  {row.charge_item?.charge_table?.name ?? '—'} · {row.charge_item?.currency === 'USD' ? formatUSD(row.override_value) : formatBRL(row.override_value)}
                  {row.valid_from ? ` · de ${formatDate(row.valid_from)}` : ''}{row.valid_to ? ` até ${formatDate(row.valid_to)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mb-2 text-sm font-semibold text-slate-300">B/Ls com cobrança manual</h3>
        {(manualBls ?? []).length === 0 ? (
          <div className="text-sm text-slate-400">Nenhum B/L com tarifa diferenciada.</div>
        ) : (
          <ul className="grid gap-2 text-sm">
            {(manualBls ?? []).map((row) => (
              <li key={row.bl_id}>
                <Link className="app-table__action" to={`/manifestos/${row.bl_id}`}>{row.bl_id}</Link>
                <span className="ml-2 text-slate-400">{row.manual_count} item(ns) manual(is) — editar na aba Cobranças do B/L</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
```

(No comentário do primeiro Card, colar o card de Invoices locais original inteiro.) Conferir se `formatUSD` existe em `src/lib/utils.ts` — é usado em `ChargeOverridesTab.tsx:17`, então existe.

- [ ] **Step 3: Rodar suíte e commitar**

Run: `npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / sem erros.

```bash
git add -A
git commit -m "feat: abas Operacional e Financeiro da Ficha do Cliente"
```

---

### Task 8: Aba Histórico

**Files:**
- Create (substituir stub): `src/components/clientes/HistoricoTab.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'

export function HistoricoTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  const { data: timeline, isLoading } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-white">Histórico do Cliente</h2>
      {isLoading ? <div className="text-sm text-slate-400">Carregando...</div> : null}
      {!isLoading && (timeline ?? []).length === 0 ? (
        <div className="text-sm text-slate-400">Sem eventos registrados.</div>
      ) : null}
      <ol className="grid gap-3 text-sm">
        {(timeline ?? []).map((event) => (
          <li key={`${event.kind}-${event.at}-${event.label}`} className="flex items-baseline gap-3">
            <span className="w-24 shrink-0 text-xs text-slate-500">{formatDate(event.at)}</span>
            <span>
              {event.link ? <Link className="hover:underline" to={event.link}>{event.label}</Link> : event.label}
              {event.detail ? <span className="ml-2 text-xs text-slate-400">{event.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
```

- [ ] **Step 2: Rodar e commitar**

Run: `npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / sem erros.

```bash
git add -A
git commit -m "feat: aba Histórico da Ficha com timeline do cliente"
```

---

### Task 9: Deep link em Taxas Locais (`?tab=overrides&cliente=`)

**Files:**
- Modify: `src/pages/TaxasLocais.tsx`
- Modify: `src/components/taxasLocais/ChargeOverridesTab.tsx`

- [ ] **Step 1: Ler os searchParams em `TaxasLocais.tsx`**

No componente da página (que hoje usa `useState<LocalChargeTab>('tabelas')`):

```tsx
import { useSearchParams } from 'react-router-dom'
// ...
const [searchParams] = useSearchParams()
const initialCustomerSearch = searchParams.get('cliente') ?? ''
const [tab, setTab] = useState<LocalChargeTab>(searchParams.get('tab') === 'overrides' ? 'overrides' : 'tabelas')
```

E passar `initialCustomerSearch={initialCustomerSearch}` para `<ChargeOverridesTab ... />`.

- [ ] **Step 2: Aceitar a prop em `ChargeOverridesTab.tsx`**

```tsx
export function ChargeOverridesTab({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
  initialCustomerSearch = '',
}: ChargeFilterProps & { initialCustomerSearch?: string }) {
  // trocar a linha existente:
  const [overrideCustomerSearch, setOverrideCustomerSearch] = useState(initialCustomerSearch)
```

- [ ] **Step 3: Verificar manualmente e commitar**

Run: `npx vitest run src/components/taxasLocais && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / sem erros. (O teste existente `TaxasLocais.behavior.test.tsx` não passa a prop — o default `''` preserva o comportamento.)

```bash
git add -A
git commit -m "feat: deep link de cliente para a aba Overrides de Taxas Locais"
```

---

### Task 10: Documentação viva + verificação final

**Files:**
- Modify: `CONTEXT.md` (seção "Revisão e clientes")
- Modify: `docs/ARCHITECTURE.md` (linha da rota `/clientes/:cnpj` e seção de clientes, se houver)
- Modify: `docs/RASTREABILIDADE.md` (linhas de `/clientes/:cnpj`: componentes, hooks, serviços, testes novos)
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/plans/README.md` (status deste plano)

- [ ] **Step 1: Glossário — adicionar em `CONTEXT.md`, seção "Revisão e clientes"**

```markdown
**Ficha do Cliente**
Hub de consulta do Cliente em `/clientes/:cnpj`, organizado em abas (Visão
Geral, Cadastro & Contatos, Operacional, Financeiro, Histórico). Consolida a
visão de cadastro, operação e financeiro com deep links para agir nas telas
onde cada fluxo já existe; não duplica fluxos de ação. As únicas operações
executadas na própria ficha são a edição auditada do cadastro, a gestão de
contatos e o provisionamento embutido do Portal.

**Saldo Pendente do Cliente**
Soma do saldo das invoices locais emitidas e das invoices de Demurrage não
pagas do Cliente, exibida com a decomposição entre as duas origens. É leitura
consolidada para a Ficha do Cliente, não um novo conceito contábil: cada
origem mantém seu ciclo de vida próprio.
```

- [ ] **Step 2: `docs/ARCHITECTURE.md`**

Localizar a linha `| /clientes/:cnpj | Ficha do cliente |` na tabela de rotas e atualizar a descrição para "Ficha do cliente (hub em abas via `?tab=`)". Se houver parágrafo descrevendo a ficha, alinhá-lo às 5 abas.

- [ ] **Step 3: `docs/RASTREABILIDADE.md`**

Localizar as linhas de `/clientes/:cnpj` e acrescentar os artefatos novos: componentes `src/components/clientes/*`, serviço `customerFicha.ts`, hooks `useCustomerFicha.ts`, testes `customerFicha.test.ts` e casos novos do behavior test. Seguir o formato das linhas vizinhas do arquivo.

- [ ] **Step 4: `docs/CHANGELOG.md`**

Entrada nova no topo, seguindo o formato existente do arquivo, cobrindo: ficha em abas, saldo consolidado, novas seções (demurrage, recebíveis, pagamentos, tarifas, histórico), deep link de Taxas Locais e drop dos campos comerciais.

- [ ] **Step 5: `docs/plans/README.md`**

Marcar este plano como IN PROGRESS ao iniciar a execução; ao concluir TUDO, seguir a seção "Ao concluir um plano" do próprio README (mover para `docs/archive/plans/`, remover a linha, CHANGELOG, `npm run docs:check`) — no mesmo change final.

- [ ] **Step 6: Verificação completa**

Run: `npm run docs:check && npm run lint && npm test && npm run build`
Expected: tudo verde. Corrigir qualquer aviso de docs:check (links/formato) antes de seguir.

- [ ] **Step 7: Commit final**

```bash
git add -A
git commit -m "docs: glossário, arquitetura e rastreabilidade da Ficha do Cliente em abas"
```

---

## Self-Review (executada na escrita do plano)

- **Cobertura das decisões:** abas ✓ (Task 5) · saldo consolidado ✓ (Tasks 3/6) · demurrage+disputas ✓ (Task 7) · recebíveis ✓ (Task 7) · pagamentos todos os métodos ✓ (Task 7) · tarifas duas camadas leitura+link ✓ (Tasks 7/9) · reconciliação deep link ✓ (Task 7) · pendências+atividade na Visão Geral ✓ (Task 6) · histórico timeline ✓ (Tasks 3/8) · campos mortos código+banco ✓ (Tasks 1/2) · glossário/docs ✓ (Task 10) · Granito fora ✓ (ausente por decisão).
- **Riscos apontados no próprio plano:** valor de `account_situation` ativa (Task 6, conferir no view model); reutilização de `TabButton` (Task 5, conferir antes de duplicar); nomes de coluna de `bl_containers` (`discharge_date`/`return_date`) — se divergirem, conferir em `src/services/demurrage/demurrageContainers.ts:27` que consulta a mesma tabela.
- **Consistência de tipos:** `Restrictable<T>` usado por demurrage/recebíveis/pagamentos nas Tasks 3→7; `FichaTabId` exportado na Task 5 e consumido na 6; `buildConsolidatedBalance` aceita exatamente os campos selecionados pelos fetches.
