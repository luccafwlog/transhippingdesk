# Financeiro — Aba Validação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover o pipeline operacional de taxas locais (calcular → revisar → faturar) da aba "Operação" de Taxas Locais para uma nova aba "Validação" em Faturamento, simplificando o modelo de status visível para `review_required`, `ready_for_billing` e `exempt`.

**Architecture:** Extrai o conteúdo da aba `pendencias` de `TaxasLocais.tsx` para um componente isolado `ValidacaoTab`. Esse componente é inserido como primeira aba em `Faturamento.tsx`. `TaxasLocais.tsx` fica apenas com as abas `Tabelas` e `Overrides`. O cálculo automático já existe em ambos os importadores (CNTR e BB) — nenhuma mudança nos services de importação é necessária.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, Tailwind CSS v4

---

## Mapa de arquivos

| Arquivo | Operação | O que muda |
|---|---|---|
| `src/components/billing/ValidacaoTab.tsx` | **Criar** | Novo componente com todo o estado e JSX operacional extraído de TaxasLocais |
| `src/pages/Faturamento.tsx` | **Modificar** | Adiciona aba "Validação" como primeira aba; importa e renderiza `ValidacaoTab` |
| `src/pages/TaxasLocais.tsx` | **Modificar** | Remove aba "Operação" (estado, hooks, handlers, JSX) e imports desnecessários |

---

## Task 1: Criar `ValidacaoTab` com o conteúdo da aba Operação

**Files:**
- Create: `src/components/billing/ValidacaoTab.tsx`

O componente recebe apenas `userId: string | null` como prop — todo o estado é interno.

- [ ] **Step 1: Criar o arquivo com as importações e tipos**

```tsx
// src/components/billing/ValidacaoTab.tsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CheckSquare, Download, RefreshCw, Square } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { useToast } from '../ui/Toast'
import {
  useBatchCalculateLocalCharges,
  useBatchMarkLocalChargesReady,
  useBatchMarkLocalChargesReviewed,
  useCustomerReconciliationQueue,
  useApproveCustomerReconciliation,
  useRejectCustomerReconciliation,
  useLocalChargeOperations,
} from '../../hooks/useLocalCharges'
import { useVoyageOptions } from '../../hooks/useBls'
import { calculateGraniteBlCharges } from '../../services/graniteCharges'
import { markGraniteBlReady } from '../../services/charges/chargeOperationsService'
import { queryKeys } from '../../services/queryKeys'
import { formatBRL, formatDate } from '../../lib/utils'

type OpsFilters = {
  search: string
  cargoMode: '' | 'container' | 'carga_solta' | 'granito'
  pod: string
  voyageId: string
  chargeStatus: '' | 'review_required' | 'ready_for_billing' | 'exempt'
}

export function ValidacaoTab({ userId }: { userId: string | null }) {
  // ... (implementado nas etapas seguintes)
  return null
}
```

- [ ] **Step 2: Adicionar estado, hooks e computed values**

Substituir o `return null` pelo corpo completo do componente, copiando de `TaxasLocais.tsx` linhas 135–208 e adaptando:

```tsx
export function ValidacaoTab({ userId }: { userId: string | null }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  const [opsFilters, setOpsFilters] = useState<OpsFilters>({
    search: '',
    cargoMode: '',
    pod: '',
    voyageId: '',
    chargeStatus: '',
  })
  const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
  const [reconciliationFilter, setReconciliationFilter] = useState(false)
  const [exportingOps, setExportingOps] = useState(false)
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)

  const { data: voyageOptions } = useVoyageOptions()
  const {
    data: operationsRows,
    isLoading: operationsLoading,
    error: operationsError,
  } = useLocalChargeOperations({
    search: opsFilters.search,
    cargoMode: opsFilters.cargoMode,
    pod: opsFilters.pod,
    voyageId: opsFilters.voyageId ? Number(opsFilters.voyageId) : null,
    chargeStatus: opsFilters.chargeStatus || undefined,
    limit: 1200,
  })
  const batchCalculateMutation = useBatchCalculateLocalCharges()
  const batchReviewedMutation = useBatchMarkLocalChargesReviewed()
  const batchReadyMutation = useBatchMarkLocalChargesReady()
  const { data: reconciliationQueue } = useCustomerReconciliationQueue('pending', 50)
  const approveReconciliationMutation = useApproveCustomerReconciliation()
  const rejectReconciliationMutation = useRejectCustomerReconciliation()

  const operationsSummary = useMemo(() => {
    const rows = operationsRows ?? []
    return {
      total: rows.length,
      reviewRequired: rows.filter((row) => row.charge_status === 'review_required').length,
      ready: rows.filter((row) => row.charge_status === 'ready_for_billing').length,
      reconciliationPending: rows.filter(
        (row) => !['matched_document', 'reconciled'].includes(row.customer_reconciliation_status ?? ''),
      ).length,
      blocked: rows.filter((row) => Boolean(row.billing_hold_reason)).length,
      totalBrl: rows.reduce((sum, row) => sum + Number(row.totals.total_brl ?? 0), 0),
      totalUsd: rows.reduce((sum, row) => sum + Number(row.totals.total_usd ?? 0), 0),
    }
  }, [operationsRows])

  const displayedRows = useMemo(() => {
    const rows = operationsRows ?? []
    if (reconciliationFilter) {
      return rows.filter(
        (row) => !['matched_document', 'reconciled'].includes(row.customer_reconciliation_status ?? ''),
      )
    }
    return rows
  }, [operationsRows, reconciliationFilter])

  const pipelineBottleneck = useMemo(() => {
    if (operationsSummary.reconciliationPending > 0) return 'reconciliation'
    if (operationsSummary.reviewRequired > 0) return 'review_required'
    if (operationsSummary.ready > 0) return 'ready_for_billing'
    return null
  }, [operationsSummary])

  const areAllOpsRowsSelected = useMemo(() => {
    if (displayedRows.length === 0) return false
    return displayedRows.every((row) => selectedOpsRows.includes(row.id))
  }, [displayedRows, selectedOpsRows])
```

- [ ] **Step 3: Adicionar handlers**

Copiar de `TaxasLocais.tsx` linhas 232–416, adaptando referências a `user?.id` para `userId`:

```tsx
  function updateOpsFilter<K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) {
    setOpsFilters((current) => ({ ...current, [field]: value }))
    setSelectedOpsRows([])
    setReconciliationFilter(false)
  }

  function handlePipelineStep(step: 'reconciliation' | 'review_required' | 'ready_for_billing') {
    if (step === 'reconciliation') {
      setReconciliationFilter(true)
      setOpsFilters((f) => ({ ...f, chargeStatus: '' }))
    } else {
      setReconciliationFilter(false)
      setOpsFilters((f) => ({ ...f, chargeStatus: step }))
    }
    setSelectedOpsRows([])
    setExpandedBlId(null)
  }

  function toggleOpsRow(blId: string) {
    setSelectedOpsRows((current) =>
      current.includes(blId) ? current.filter((id) => id !== blId) : [...current, blId],
    )
  }

  function toggleAllOpsRows() {
    if (!displayedRows.length) { setSelectedOpsRows([]); return }
    if (areAllOpsRowsSelected) { setSelectedOpsRows([]); return }
    setSelectedOpsRows(displayedRows.map((row) => row.id))
  }

  async function handleExportOperations() {
    const rows = operationsRows ?? []
    if (!rows.length) { showToast('Não há dados para exportar com os filtros atuais.', 'info'); return }
    setExportingOps(true)
    try {
      const { exportLocalChargeOperationsWorkbook } = await import('../../services/exports')
      await exportLocalChargeOperationsWorkbook(rows)
      showToast(`Exportacao concluida com ${rows.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar operação de taxas locais.', 'error')
    } finally {
      setExportingOps(false)
    }
  }

  async function runBatchOperation(action: 'recalculate' | 'review' | 'ready') {
    const allIds = selectedOpsRows
    if (allIds.length === 0) {
      showToast('Selecione ao menos um B/L para executar acao em lote.', 'error')
      return
    }
    const cargoModeById = new Map((operationsRows ?? []).map((row) => [row.id, row.cargo_mode] as const))
    const localIds = allIds.filter((id) => cargoModeById.get(id) !== 'granito')
    const graniteIds = allIds.filter((id) => cargoModeById.get(id) === 'granito')
    try {
      const actorId = userId
      const emptyResult = { total: 0, successCount: 0, errorCount: 0, errors: [] as Array<{ blId: string; message: string }> }
      let localResult = emptyResult
      if (localIds.length > 0) {
        localResult =
          action === 'recalculate'
            ? await batchCalculateMutation.mutateAsync({ blIds: localIds, actorId, recalculate: true })
            : action === 'review'
              ? await batchReviewedMutation.mutateAsync({ blIds: localIds, actorId })
              : await batchReadyMutation.mutateAsync({ blIds: localIds, actorId })
      }
      const graniteResult = graniteIds.length > 0 ? await runGraniteBatch(graniteIds, action) : emptyResult
      const total = localResult.total + graniteResult.total
      const successCount = localResult.successCount + graniteResult.successCount
      const errorCount = localResult.errorCount + graniteResult.errorCount
      const firstError = [...localResult.errors, ...graniteResult.errors][0]
      if (errorCount > 0 && firstError) {
        showToast(`Processamento parcial: ${successCount}/${total}. Primeiro erro em ${firstError.blId}: ${firstError.message}`, 'info')
      } else if (total > 0) {
        showToast(`Processamento concluido para ${successCount} B/L(s).`, 'success')
      }
      if (graniteResult.successCount > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() })
      }
      setSelectedOpsRows([])
    } catch {
      showToast('Falha ao executar processamento em lote.', 'error')
    }
  }

  async function runGraniteBatch(
    ids: string[],
    action: 'recalculate' | 'review' | 'ready',
  ): Promise<{ total: number; successCount: number; errorCount: number; errors: Array<{ blId: string; message: string }> }> {
    if (action === 'review') return { total: ids.length, successCount: ids.length, errorCount: 0, errors: [] }
    const worker = action === 'ready' ? markGraniteBlReady : calculateGraniteBlCharges
    const errors: Array<{ blId: string; message: string }> = []
    let ok = 0
    for (const id of ids) {
      try { await worker(id); ok++ }
      catch (e) { errors.push({ blId: id, message: e instanceof Error ? e.message : 'Erro inesperado no processamento Granito.' }) }
    }
    return { total: ids.length, successCount: ok, errorCount: errors.length, errors }
  }

  async function handleApproveQueueItem(queueId: number, customerId?: number | null) {
    if (!customerId) { showToast('Não há cliente vinculado para aprovação automática. Revise o cadastro antes.', 'error'); return }
    try {
      await approveReconciliationMutation.mutateAsync({ queueId, customerId, actorId: userId })
      showToast('Reconciliação aprovada.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao aprovar reconciliação.', 'error')
    }
  }

  async function handleRejectQueueItem(queueId: number) {
    try {
      await rejectReconciliationMutation.mutateAsync({ queueId, actorId: userId })
      showToast('Reconciliação rejeitada.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao rejeitar reconciliação.', 'error')
    }
  }
```

- [ ] **Step 4: Adicionar o JSX do return**

Copiar de `TaxasLocais.tsx` linhas 1143–1605 (bloco `tab === 'pendencias'`), envolvê-lo em um fragment `<>...</>` e fazer os ajustes do modelo simplificado:

**Ajustes obrigatórios no JSX:**

a) No filtro de "Status taxas" (`<Select>` de `chargeStatus`), remover as options `not_calculated`, `calculated` e `reviewed`:
```tsx
<Select
  value={opsFilters.chargeStatus}
  onChange={(event) =>
    updateOpsFilter('chargeStatus', event.target.value as OpsFilters['chargeStatus'])
  }
>
  <option value="">Todos</option>
  <option value="review_required">Revisao</option>
  <option value="ready_for_billing">Pronto faturar</option>
  <option value="exempt">Isento</option>
</Select>
```

b) Remover o botão "Calcular selecionados" (action `'calculate'`). Manter apenas "Recalcular", "Aprovar revisão" e "Marcar pronto faturar":
```tsx
<Button
  variant="secondary"
  onClick={() => runBatchOperation('recalculate')}
  loading={batchCalculateMutation.isPending}
  disabled={batchReviewedMutation.isPending || batchReadyMutation.isPending}
>
  <RefreshCw size={15} />
  Recalcular selecionados
</Button>
<Button
  variant="secondary"
  onClick={() => runBatchOperation('review')}
  loading={batchReviewedMutation.isPending}
  disabled={batchCalculateMutation.isPending || batchReadyMutation.isPending}
>
  <CheckSquare size={15} />
  Aprovar revisao
</Button>
<Button
  onClick={() => runBatchOperation('ready')}
  loading={batchReadyMutation.isPending}
  disabled={batchCalculateMutation.isPending || batchReviewedMutation.isPending}
>
  <CheckSquare size={15} />
  Marcar pronto faturar
</Button>
<Button variant="secondary" onClick={handleExportOperations} loading={exportingOps}>
  <Download size={15} />
  Exportar visao
</Button>
```

c) No `PipelineStep` da "Fila de prioridades", remover os steps de `not_calculated` e `reviewed`. Manter apenas `reconciliation`, `review_required` e `ready_for_billing`:
```tsx
<PipelineStep
  number={1}
  label="Revisao pendente"
  count={operationsSummary.reviewRequired}
  isBottleneck={pipelineBottleneck === 'review_required'}
  active={reconciliationFilter === false && opsFilters.chargeStatus === 'review_required'}
  onClick={() => handlePipelineStep('review_required')}
/>
<PipelineStep
  number={2}
  label="Pronto p/ faturar"
  count={operationsSummary.ready}
  isBottleneck={pipelineBottleneck === 'ready_for_billing'}
  active={reconciliationFilter === false && opsFilters.chargeStatus === 'ready_for_billing'}
  onClick={() => handlePipelineStep('ready_for_billing')}
/>
```

d) Mover as funções auxiliares `PipelineStep`, `renderChargeStatus`, `renderReconciliationStatus`, `renderDetectionType` e `formatUSD` para **dentro do arquivo** (após o componente, antes do export).

`renderChargeStatus` simplificado (remover `reviewed` e `calculated`):
```tsx
function renderChargeStatus(status: string | null) {
  if (status === 'review_required') return <Badge tone="yellow">Revisao</Badge>
  if (status === 'ready_for_billing') return <Badge tone="green">Pronto</Badge>
  if (status === 'exempt') return <Badge tone="slate">Isento</Badge>
  return <Badge tone="slate">Pendente</Badge>
}
```

- [ ] **Step 5: Verificar que o arquivo compila**

```bash
npx tsc --noEmit
```

Esperado: sem erros em `ValidacaoTab.tsx`. Se houver erros de tipos, corrigi-los antes de avançar.

- [ ] **Step 6: Commit**

```bash
git add src/components/billing/ValidacaoTab.tsx
git commit -m "feat: extract ValidacaoTab component from TaxasLocais"
```

---

## Task 2: Adicionar aba Validação ao Faturamento

**Files:**
- Modify: `src/pages/Faturamento.tsx`

- [ ] **Step 1: Atualizar o tipo de `activeTab` e o estado inicial**

Localizar (linha ~82):
```tsx
const [activeTab, setActiveTab] = useState<'invoices' | 'demurrage'>(
  searchParams.get('tab') === 'demurrage' ? 'demurrage' : 'invoices'
)
```

Substituir por:
```tsx
const [activeTab, setActiveTab] = useState<'validacao' | 'invoices' | 'demurrage'>(
  searchParams.get('tab') === 'demurrage'
    ? 'demurrage'
    : searchParams.get('tab') === 'invoices'
      ? 'invoices'
      : 'validacao'
)
```

- [ ] **Step 2: Adicionar import do ValidacaoTab**

No topo do arquivo, após os imports existentes de componentes:
```tsx
import { ValidacaoTab } from '../components/billing/ValidacaoTab'
```

- [ ] **Step 3: Adicionar o botão da aba Validação no JSX**

Localizar o bloco de tab buttons em `Faturamento.tsx` (procurar por `activeTab === 'invoices'` no JSX) e adicionar o botão Validação **antes** do botão Faturas:

```tsx
<TabButton
  active={activeTab === 'validacao'}
  label="Validação"
  onClick={() => setActiveTab('validacao')}
/>
<TabButton
  active={activeTab === 'invoices'}
  label="Faturas"
  onClick={() => setActiveTab('invoices')}
/>
<TabButton
  active={activeTab === 'demurrage'}
  label="Demurrage"
  onClick={() => setActiveTab('demurrage')}
/>
```

- [ ] **Step 4: Renderizar `ValidacaoTab` no JSX**

Localizar onde `activeTab === 'invoices'` renderiza conteúdo e adicionar o bloco de Validação antes:

```tsx
{activeTab === 'validacao' ? (
  <ValidacaoTab userId={user?.id ?? null} />
) : null}

{activeTab === 'invoices' ? (
  // ... conteúdo existente de faturas
) : null}
```

- [ ] **Step 5: Verificar que o arquivo compila**

```bash
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Faturamento.tsx
git commit -m "feat: add Validacao tab to Faturamento (first tab)"
```

---

## Task 3: Remover aba Operação de TaxasLocais

**Files:**
- Modify: `src/pages/TaxasLocais.tsx`

- [ ] **Step 1: Remover o tipo `'pendencias'` de `LocalChargeTab`**

Localizar (linha ~37):
```tsx
type LocalChargeTab = 'tabelas' | 'overrides' | 'pendencias'
```

Substituir por:
```tsx
type LocalChargeTab = 'tabelas' | 'overrides'
```

- [ ] **Step 2: Remover todo o estado operacional**

Remover as seguintes linhas de estado (entre linhas ~123–143):
```tsx
const [reconciliationFilter, setReconciliationFilter] = useState(false)
const [opsFilters, setOpsFilters] = useState<LocalChargeOpsFilters>({...})
const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
const [exportingOps, setExportingOps] = useState(false)
```

Também remover `expandedBlId` se for usado exclusivamente pela aba pendências (verificar — se também usado em `tabelas`, manter).

- [ ] **Step 3: Remover hooks exclusivos da aba operacional**

Remover as linhas (entre ~162–180):
```tsx
const { data: voyageOptions } = useVoyageOptions()         // se não usado em tabelas
const { data: operationsRows, isLoading: operationsLoading, error: operationsError } = useLocalChargeOperations({...})
const batchCalculateMutation = useBatchCalculateLocalCharges()
const batchReviewedMutation = useBatchMarkLocalChargesReviewed()
const batchReadyMutation = useBatchMarkLocalChargesReady()
const { data: reconciliationQueue } = useCustomerReconciliationQueue('pending', 50)
const approveReconciliationMutation = useApproveCustomerReconciliation()
const rejectReconciliationMutation = useRejectCustomerReconciliation()
```

> **Atenção:** `useVoyageOptions` também é usado no formulário de tabelas (filtro de viagem). Verificar antes de remover. Se usado em outro lugar, manter.

- [ ] **Step 4: Remover computed values operacionais**

Remover `operationsSummary`, `displayedRows`, `pipelineBottleneck`, `areAllOpsRowsSelected` (linhas ~195–230).

- [ ] **Step 5: Remover handlers operacionais**

Remover as funções (linhas ~232–416):
- `updateOpsFilter`
- `handlePipelineStep`
- `toggleOpsRow`
- `toggleAllOpsRows`
- `handleExportOperations`
- `runBatchOperation`
- `runGraniteBatch`
- `handleApproveQueueItem`
- `handleRejectQueueItem`

- [ ] **Step 6: Remover o tab button "Operacao" do JSX**

Localizar (linha ~655):
```tsx
<TabButton active={tab === 'pendencias'} label="Operacao" onClick={() => setTab('pendencias')} />
```

Remover essa linha.

- [ ] **Step 7: Remover o bloco JSX da aba pendencias**

Remover o bloco inteiro `{tab === 'pendencias' ? (...) : null}` (linhas 1143–fim do bloco, aproximadamente linha 1605).

- [ ] **Step 8: Remover funções auxiliares que migraram**

Remover as funções ao final do arquivo que foram movidas para `ValidacaoTab.tsx`:
- `PipelineStep`
- `renderChargeStatus`
- `renderReconciliationStatus`
- `renderDetectionType`
- `formatUSD`

- [ ] **Step 9: Limpar imports não mais utilizados**

Remover do topo do arquivo quaisquer imports que ficaram órfãos após a remoção:
- `Calculator`, `CheckSquare`, `RefreshCw`, `Download`, `Square` de `lucide-react` (verificar se ainda usados)
- `useBatchCalculateLocalCharges`, `useBatchMarkLocalChargesReady`, `useBatchMarkLocalChargesReviewed`, `useCustomerReconciliationQueue`, `useApproveCustomerReconciliation`, `useRejectCustomerReconciliation`, `useLocalChargeOperations` de `../hooks/useLocalCharges`
- `createInvoiceFromBls` de `../services/billing`
- `calculateGraniteBlCharges` de `../services/graniteCharges`
- `markGraniteBlReady` de `../services/charges/chargeOperationsService`
- `queryKeys` de `../services/queryKeys`

- [ ] **Step 10: Verificar que compila sem erros**

```bash
npx tsc --noEmit
```

Esperado: zero erros. Se algum import de `LocalChargeOpsFilters` ficou solto, remover também.

- [ ] **Step 11: Commit**

```bash
git add src/pages/TaxasLocais.tsx
git commit -m "refactor: remove Operacao tab from TaxasLocais"
```

---

## Task 4: Smoke test manual

- [ ] **Step 1: Iniciar o servidor de desenvolvimento**

```bash
npm run dev
```

- [ ] **Step 2: Verificar Faturamento**

Abrir `/faturamento`. Confirmar:
- Primeira aba visível é "Validação"
- B/Ls aparecem na tabela (com filtros funcionando)
- Botões de ação em lote respondem
- Aba "Faturas" ainda funciona normalmente
- Aba "Demurrage" ainda funciona normalmente

- [ ] **Step 3: Verificar Taxas Locais**

Abrir `/taxaslocais`. Confirmar:
- Apenas abas "Tabelas" e "Overrides" visíveis
- Nenhuma referência à aba "Operação"
- Funcionalidade de tabelas e overrides intacta

- [ ] **Step 4: Verificar filtro de status na aba Validação**

No dropdown "Status taxas", confirmar que aparecem apenas:
- (vazio — Todos)
- Revisao
- Pronto faturar
- Isento

- [ ] **Step 5: Rodar testes unitários**

```bash
npm run test
```

Esperado: todos passando. Se algum teste referenciar `tab === 'pendencias'` ou imports removidos, ajustar.

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "chore: smoke test verified — Validacao tab working"
```
