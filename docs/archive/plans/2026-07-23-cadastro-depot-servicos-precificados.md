# Cadastro de Depot — Serviços Precificados por Tipo de Cálculo (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remodelar o Cadastro de Depot para o padrão `/taxas-locais` — depot pai + uma lista de serviços precificados por *tipo de cálculo* — tirar a página do menu (acesso por botão), e rewirar import/cálculo/ADR conforme a [ADR 0032](../adr/0032-cadastro-depot-servicos-precificados-por-tipo-de-calculo.md).

**Architecture:** SPA React (páginas → hooks → services → Supabase RPC/RLS), migrations SQL numeradas sequencialmente. O ambiente **não possui dados legados de vazios/depots** (confirmado na migration 231), então as migrations podem recriar estruturas sem conversão de dados complexa.

**Tech Stack:** React + TypeScript, TanStack React Query, Supabase (Postgres + RLS + RPC), Vitest, Tailwind.

---

## Decisão de design a confirmar no kickoff (bloqueia Fase 1)

A ADR registrou "cada depot cobra overtime sobre **handling e/ou transporte**". Como os serviços agora são **genéricos** (linhas livres com nome + tipo de cálculo), não existe mais um serviço "handling" ou "transporte" fixo que o overtime possa referenciar por nome. Este plano operacionaliza isso com uma **flag por serviço** `subject_to_overtime` em `depot_services`: o overtime do container incide sobre a soma dos serviços `fixo_por_container` marcados. Isso é equivalente e mais geral que dois booleanos no depot.

**Ação:** confirme esta escolha antes da Fase 1. Se preferir os dois booleanos no depot, ajuste a Task 1.1 e a Task 3.3 (a lógica de cálculo muda de "serviços marcados" para "depot.overtime_on_handling/transport"). Todo o resto do plano é idêntico.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/234_depot_servicos_tipo_calculo.sql` | Novo schema: serviços por tipo de cálculo, atributos do depot, coluna OT por container, remoção do modelo antigo | Criar |
| `src/types/database.ts` | Tipos gerados do banco | Regenerar (protegido — ver Task 2.1) |
| `src/services/depots.ts` | CRUD de depots e serviços precificados | Reescrever tarifas→serviços |
| `src/services/vaziosCusto.ts` | Motor de cálculo por container/operação | Reescrever |
| `src/services/vaziosExportOperations.ts` | Operação da escala, qty de serviços | Remover reorg/overtime antigos, add qty por serviço |
| `src/services/vaziosImport.ts` | Parser da planilha | Coluna OT única, remover flags |
| `src/pages/VaziosReorgRates.tsx` → `src/pages/DepotCadastro.tsx` | Página do cadastro no padrão taxas-locais | Reescrever + renomear |
| `src/pages/EmbarqueVazios.tsx` | Botão de acesso, aba Custos rewirada, remoção de flags | Modificar |
| `src/pages/Granite.tsx` | Botão de acesso à Tabela de Taxas | Modificar |
| `src/components/layout/appLayoutNav.ts` | Remover itens de menu | Modificar |
| `src/App.tsx` | Rota `/embarquevazios/depots` | Modificar |
| `docs/RASTREABILIDADE.md`, `docs/ARCHITECTURE.md` | Documentação viva | Modificar |

---

## Fase 0 — Menu, rota e botões (sem schema, shippable isolado)

### Task 0.1: Renomear rota e tirar do menu

**Files:**
- Modify: `src/App.tsx:125`
- Modify: `src/components/layout/appLayoutNav.ts:40-45`

- [ ] **Step 1: Renomear a rota**

Em `src/App.tsx`, trocar a linha 125:

```tsx
<Route path="/embarquevazios/depots" element={withSuspense(<VaziosReorgRates />)} />
```

(Sem redirect da rota antiga — decisão do grilling.)

- [ ] **Step 2: Remover os dois itens do menu de exportação**

Em `src/components/layout/appLayoutNav.ts`, o `exportNavItems` fica:

```ts
export const exportNavItems: NavItem[] = [
  { to: '/granito', label: 'Granito', icon: Mountain },
  { to: '/embarquevazios', label: 'Vazios EXP', icon: Package },
]
```

(Remove `/granito/taxas` e `/embarquevazios/taxas`.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erro (imports `Mountain`/`Package` ainda usados).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/layout/appLayoutNav.ts
git commit -m "feat(vazios): rota /embarquevazios/depots e remove taxas do menu"
```

### Task 0.2: Botão de acesso no Vazios EXP

**Files:**
- Modify: `src/pages/EmbarqueVazios.tsx:392-410` (PageHeader action)
- Modify: `src/pages/EmbarqueVazios.tsx:628` (link "Sem tarifa" → novo slug)

- [ ] **Step 1: Adicionar botão no PageHeader**

Dentro do `action={<div className="flex flex-wrap gap-2"> ... </div>}` do `PageHeader`, adicionar como primeiro filho:

```tsx
<Link
  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
  to="/embarquevazios/depots"
>
  <Package size={16} />
  Tabela de Depots
</Link>
```

`Link` e `Package` já estão importados no arquivo.

- [ ] **Step 2: Atualizar o link contextual "Sem tarifa"**

Linha 628, trocar `to="/embarquevazios/taxas"` por `to="/embarquevazios/depots"`.

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "feat(vazios): botao Tabela de Depots no cabecalho do Vazios EXP"
```

### Task 0.3: Botão de acesso no Granito

**Files:**
- Modify: `src/pages/Granite.tsx:172-180` (PageHeader action)

- [ ] **Step 1: Import do Link (se ausente)**

Confirmar no topo de `src/pages/Granite.tsx` que `Link` de `react-router-dom` está importado; se não, adicionar `import { Link } from 'react-router-dom'`.

- [ ] **Step 2: Adicionar botão no PageHeader do Granito**

Trocar o `action={canWrite ? (<Button ...>) : null}` por um wrapper com os dois:

```tsx
action={
  <div className="flex flex-wrap gap-2">
    <Link
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
      to="/granito/taxas"
    >
      <Mountain size={16} />
      Tabela de Taxas — Granito
    </Link>
    {canWrite ? (
      <Button onClick={() => setUploadOpen(true)}>
        <Upload size={16} />
        Importar Planilha
      </Button>
    ) : null}
  </div>
}
```

Adicionar `Mountain` ao import de `lucide-react` no arquivo.

- [ ] **Step 3: Verificar e commit**

Run: `npm run build`
Expected: PASS.

```bash
git add src/pages/Granite.tsx
git commit -m "feat(granito): botao Tabela de Taxas no cabecalho do Granito"
```

---

## Fase 1 — Migração de schema

### Task 1.1: Migration 234 — novo modelo de serviços

**Files:**
- Create: `supabase/migrations/234_depot_servicos_tipo_calculo.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Cadastro de Depot: servicos precificados por tipo de calculo (ADR 0032).
-- Ambiente sem dados legados de vazios/depots (ver migration 231) — recriacao direta.

-- 1. Atributos do depot: free time e (opcional) overtime.
ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS free_time_days INTEGER NOT NULL DEFAULT 0 CHECK (free_time_days >= 0);

-- 2. depot_services: substitui charge_basis por calc_type e adiciona subject_to_overtime.
ALTER TABLE public.depot_services
  DROP CONSTRAINT IF EXISTS depot_services_charge_basis_check;
ALTER TABLE public.depot_services
  ADD COLUMN IF NOT EXISTS calc_type TEXT,
  ADD COLUMN IF NOT EXISTS subject_to_overtime BOOLEAN NOT NULL DEFAULT FALSE;
-- Sem dados legados: default seguro e depois NOT NULL + CHECK.
UPDATE public.depot_services SET calc_type = 'quantidade' WHERE calc_type IS NULL;
ALTER TABLE public.depot_services
  ALTER COLUMN calc_type SET NOT NULL,
  ADD CONSTRAINT depot_services_calc_type_check
    CHECK (calc_type IN ('fixo_por_container', 'storage_por_dias', 'quantidade'));
ALTER TABLE public.depot_services DROP COLUMN IF EXISTS charge_basis;

-- 3. Aposenta as tarifas estruturadas (free time migrou para depots).
DROP TABLE IF EXISTS public.depot_tariffs CASCADE;

-- 4. vazios_bookings: coluna unica de overtime por container; remove flags antigas.
ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS overtime_pct NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (overtime_pct >= 0);
ALTER TABLE public.vazios_bookings
  DROP COLUMN IF EXISTS bundle,
  DROP COLUMN IF EXISTS transporte,
  DROP COLUMN IF EXISTS visual_check,
  DROP COLUMN IF EXISTS overtime_handling,
  DROP COLUMN IF EXISTS overtime_transport,
  DROP COLUMN IF EXISTS overtime_handling_pct,
  DROP COLUMN IF EXISTS overtime_transport_pct;

-- 5. Quantidade dos servicos tipo 'quantidade', lancada na operacao (viagem, porto).
CREATE TABLE IF NOT EXISTS public.vazios_operation_service_qty (
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  depot_service_id UUID NOT NULL REFERENCES public.depot_services(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (operation_id, depot_service_id)
);
ALTER TABLE public.vazios_operation_service_qty ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_operation_service_qty TO authenticated;

-- 6. Aposenta reorg global e overtime por operacao (substituidos pelo modelo por depot).
DROP TABLE IF EXISTS public.vazios_reorg_services CASCADE;
DROP TABLE IF EXISTS public.vazios_reorg_rates CASCADE;
DROP TABLE IF EXISTS public.vazios_export_overtime_depots CASCADE;
```

- [ ] **Step 2: Rodar checagem de portabilidade PG local (padrão do repo)**

Run: `npm test -- pgPortability`
Expected: PASS (sem sintaxe não suportada). Se o repo não tiver esse teste, pular.

- [ ] **Step 3: Aplicar a migration**

Aplicar via fluxo do `WORKFLOW.md` (Supabase CLI/branch). Confirmar que roda sem erro.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/234_depot_servicos_tipo_calculo.sql
git commit -m "feat(depot): migration 234 servicos por tipo de calculo"
```

### Task 1.2: RLS/policies para `vazios_operation_service_qty`

**Files:**
- Modify: `supabase/migrations/234_depot_servicos_tipo_calculo.sql` (append)

- [ ] **Step 1: Espelhar as policies das tabelas irmãs**

Verificar como `vazios_reorg_services` tinha RLS (migration 229/230) e replicar o mesmo padrão de policy (`depots_edit`/Equipamentos+Administrativo para escrita, leitura autenticada) para `vazios_operation_service_qty`. Anexar as `CREATE POLICY` correspondentes ao final da migration 234.

- [ ] **Step 2: Aplicar e commit**

```bash
git add supabase/migrations/234_depot_servicos_tipo_calculo.sql
git commit -m "feat(depot): RLS de vazios_operation_service_qty"
```

---

## Fase 2 — Tipos do banco

### Task 2.1: Regenerar `database.ts`

**Files:**
- Modify: `src/types/database.ts` (arquivo **protegido** por hook)

- [ ] **Step 1: Regenerar tipos**

Rodar o gerador do projeto (mesma ferramenta usada nas migrations anteriores; ver `WORKFLOW.md`). Os tipos devem refletir: `depots.free_time_days`; `depot_services.calc_type`/`subject_to_overtime` (sem `charge_basis`); ausência de `depot_tariffs`; `vazios_bookings.overtime_pct` (sem as flags); nova `vazios_operation_service_qty`; ausência de `vazios_reorg_rates`/`vazios_reorg_services`/`vazios_export_overtime_depots`.

- [ ] **Step 2: Autorizar o hook do arquivo protegido**

O arquivo é guardado por hook — a regeneração é a razão autorizada. Confirmar com o usuário/fluxo antes de commitar.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "chore(types): regenera database.ts para modelo de servicos por tipo de calculo"
```

---

## Fase 3 — Camada de serviços (lógica pura, TDD)

### Task 3.1: `depots.ts` — serviços substituem tarifas

**Files:**
- Modify: `src/services/depots.ts`

- [ ] **Step 1: Atualizar o tipo e o upsert de depot (free time)**

Adicionar `free_time_days` ao payload de `upsertDepot`:

```ts
export async function upsertDepot(input: Omit<Depot, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<void> {
  const payload = {
    code: input.code.trim(),
    name: input.name?.trim() || null,
    pol_port: input.pol_port?.trim() || null,
    active: input.active,
    free_time_days: input.free_time_days ?? 0,
    updated_at: new Date().toISOString(),
  }
  const query = input.id
    ? supabase.from('depots').update(payload).eq('id', input.id)
    : supabase.from('depots').insert(payload)
  const { error } = await query
  if (error) throw error
}
```

- [ ] **Step 2: Remover as funções de `depot_tariffs`**

Excluir `listDepotTariffs`, `upsertDepotTariff`, `resolveCurrentDepotTariff` (a tabela não existe mais). O `import type { DepotTariff }` sai também.

- [ ] **Step 3: Ajustar `upsertDepotService` ao novo shape**

```ts
export async function upsertDepotService(input: Omit<DepotService, 'id' | 'created_at'> & { id?: string }): Promise<void> {
  if (input.valid_to && input.valid_to < input.valid_from) throw new Error('Vigência final anterior à inicial.')
  const query = input.id
    ? supabase.from('depot_services').update(input).eq('id', input.id)
    : supabase.from('depot_services').insert(input)
  const { error } = await query
  if (error) throw error
}
```

`listDepotServices`, `listCurrentDepotServices`, `deleteDepotService` permanecem (já filtram por depot/vigência).

- [ ] **Step 4: Verificar tipos**

Run: `npm run build`
Expected: erros apenas nos consumidores de `depot_tariffs` (serão corrigidos nas Tasks 3.2/6.x). Registrar os arquivos apontados.

- [ ] **Step 5: Commit**

```bash
git add src/services/depots.ts
git commit -m "refactor(depots): remove tarifas estruturadas; free time no depot"
```

### Task 3.2: `vaziosCusto.ts` — novo motor de cálculo (TDD)

**Files:**
- Modify: `src/services/vaziosCusto.ts`
- Test: `src/services/__tests__/vaziosCusto.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Substituir o conteúdo de `src/services/__tests__/vaziosCusto.test.ts` por:

```ts
import { describe, expect, it } from 'vitest'
import { computeContainerCost, computeOperationTotals, type PricedService, type CostDepot, type CostContainer } from '../vaziosCusto'

const depot: CostDepot = { id: 'd1', free_time_days: 2 }
const services: PricedService[] = [
  { id: 's1', depot_id: 'd1', name: 'Handling', calc_type: 'fixo_por_container', rate_brl: 100, subject_to_overtime: true },
  { id: 's2', depot_id: 'd1', name: 'Transporte', calc_type: 'fixo_por_container', rate_brl: 50, subject_to_overtime: false },
  { id: 's3', depot_id: 'd1', name: 'Storage', calc_type: 'storage_por_dias', rate_brl: 10, subject_to_overtime: false },
  { id: 's4', depot_id: 'd1', name: 'Reorganização', calc_type: 'quantidade', rate_brl: 30, subject_to_overtime: false },
]

describe('computeContainerCost', () => {
  it('soma fixos, storage por dias além do free time, e overtime só sobre serviços marcados', () => {
    const container: CostContainer = { container_number: 'ABCD1234567', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-06', overtime_pct: 10 }
    const cost = computeContainerCost(container, depot, services)
    // fixos = 100 + 50 = 150; storage = (5 - 2) * 10 = 30; overtime = 10% de 100 (só Handling) = 10
    expect(cost.fixed).toBe(150)
    expect(cost.storage).toBe(30)
    expect(cost.overtime).toBe(10)
    expect(cost.total).toBe(190)
  })

  it('sem depot resolve zero', () => {
    const cost = computeContainerCost({ container_number: 'X', depot_id: null }, depot, services)
    expect(cost.total).toBe(0)
  })

  it('storage nunca negativo dentro do free time', () => {
    const container: CostContainer = { container_number: 'C', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-02', overtime_pct: 0 }
    expect(computeContainerCost(container, depot, services).storage).toBe(0)
  })
})

describe('computeOperationTotals', () => {
  it('inclui serviços tipo quantidade por operação (qty × valor)', () => {
    const container: CostContainer = { container_number: 'C', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-04', overtime_pct: 0 }
    const totals = computeOperationTotals([container], new Map([['d1', depot]]), services, new Map([['s4', 2]]))
    // container: fixos 150 + storage (3-2)*10=10 = 160; qty: 2 * 30 = 60
    expect(totals.qtyTotal).toBe(60)
    expect(totals.total).toBe(220)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- vaziosCusto`
Expected: FAIL (símbolos `PricedService`/`CostDepot`/campos `fixed`/`qtyTotal` inexistentes).

- [ ] **Step 3: Reescrever `vaziosCusto.ts`**

```ts
export type ServiceCalcType = 'fixo_por_container' | 'storage_por_dias' | 'quantidade'

export type PricedService = {
  id: string
  depot_id: string
  name: string
  calc_type: ServiceCalcType
  rate_brl: number
  subject_to_overtime: boolean
}

export type CostDepot = { id: string; free_time_days: number }

export type CostContainer = {
  container_number: string
  depot_id?: string | null
  hand_in_date?: string | null
  hand_out_date?: string | null
  overtime_pct?: number | null
}

export type ContainerCost = {
  container_number: string
  fixed: number
  storage: number
  overtime: number
  total: number
  breakdown: Array<{ label: string; amount: number }>
}

const daysBetween = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start || !end) return 0
  const startMs = Date.parse(start); const endMs = Date.parse(end)
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 86_400_000)) : 0
}

export function computeContainerCost(container: CostContainer, depot: CostDepot | null, services: PricedService[] = []): ContainerCost {
  const zero: ContainerCost = { container_number: container.container_number, fixed: 0, storage: 0, overtime: 0, total: 0, breakdown: [] }
  if (!depot || !container.depot_id) return zero
  const own = services.filter((service) => service.depot_id === container.depot_id)
  const fixed = own.filter((s) => s.calc_type === 'fixo_por_container').reduce((sum, s) => sum + Number(s.rate_brl), 0)
  const storageRate = own.filter((s) => s.calc_type === 'storage_por_dias').reduce((sum, s) => sum + Number(s.rate_brl), 0)
  const storageDays = Math.max(0, daysBetween(container.hand_in_date, container.hand_out_date) - Number(depot.free_time_days))
  const storage = storageDays * storageRate
  const overtimeBase = own.filter((s) => s.calc_type === 'fixo_por_container' && s.subject_to_overtime).reduce((sum, s) => sum + Number(s.rate_brl), 0)
  const overtime = overtimeBase * (Number(container.overtime_pct ?? 0) / 100)
  const breakdown = [
    { label: 'Fixos por container', amount: fixed },
    { label: 'Storage', amount: storage },
    { label: 'Overtime', amount: overtime },
  ].filter((line) => line.amount !== 0)
  return { container_number: container.container_number, fixed, storage, overtime, total: fixed + storage + overtime, breakdown }
}

export function computeOperationTotals(
  containers: CostContainer[],
  depots: Map<string, CostDepot>,
  services: PricedService[],
  qtyByServiceId: Map<string, number>,
) {
  const rows = containers.map((container) =>
    computeContainerCost(container, container.depot_id ? depots.get(container.depot_id) ?? null : null, services),
  )
  const qtyTotal = services
    .filter((s) => s.calc_type === 'quantidade')
    .reduce((sum, s) => sum + (qtyByServiceId.get(s.id) ?? 0) * Number(s.rate_brl), 0)
  return { rows, qtyTotal, total: rows.reduce((sum, row) => sum + row.total, 0) + qtyTotal }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- vaziosCusto`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add src/services/vaziosCusto.ts src/services/__tests__/vaziosCusto.test.ts
git commit -m "feat(vazios): motor de custo por tipo de calculo (fixo/storage/quantidade)"
```

### Task 3.3: `vaziosExportOperations.ts` — qty por serviço, remove reorg/overtime antigos

**Files:**
- Modify: `src/services/vaziosExportOperations.ts`

- [ ] **Step 1: Remover funções mortas**

Excluir `upsertOvertimeDepot`, `upsertReorgService`, `listActiveReorgRates`, `listVaziosReorgRates`, `upsertVaziosReorgRate`, `deleteVaziosReorgRate` e os imports de tipos correspondentes (`VaziosExportOvertimeDepot`, `VaziosReorgRate`, `VaziosReorgService`, `VaziosReorgServiceType`).

- [ ] **Step 2: Ajustar `getVaziosExportOperation`**

Trocar o `select` para carregar as quantidades por serviço em vez de reorg/overtime:

```ts
export async function getVaziosExportOperation(voyageId: number, embarkPort: string) {
  const { data, error } = await supabase
    .from('vazios_export_operations')
    .select('*, service_qty:vazios_operation_service_qty(depot_service_id, qty)')
    .eq('voyage_id', voyageId)
    .eq('embark_port', embarkPort)
    .maybeSingle()
  if (error) throw error
  return data as (VaziosExportOperation & { service_qty: Array<{ depot_service_id: string; qty: number }> }) | null
}
```

- [ ] **Step 3: Adicionar upsert de quantidade por serviço**

```ts
export async function upsertOperationServiceQty(input: { operationId: string; depotServiceId: string; qty: number }) {
  const { error } = await supabase
    .from('vazios_operation_service_qty')
    .upsert(
      { operation_id: input.operationId, depot_service_id: input.depotServiceId, qty: input.qty },
      { onConflict: 'operation_id,depot_service_id' },
    )
  if (error) throw error
}
```

- [ ] **Step 4: Atualizar `updateVaziosBooking`**

Remover das chaves permitidas: `bundle`, `transporte`, `overtime_handling`, `overtime_transport`, `overtime_handling_pct`, `overtime_transport_pct`, `visual_check`. Adicionar `overtime_pct`.

- [ ] **Step 5: Verificar tipos**

Run: `npm run build`
Expected: erros apenas nos consumidores UI (Tasks 4/6). Registrar.

- [ ] **Step 6: Commit**

```bash
git add src/services/vaziosExportOperations.ts
git commit -m "refactor(vazios): qty por servico; remove reorg/overtime por operacao"
```

---

## Fase 4 — Página do Cadastro de Depot (padrão taxas-locais)

### Task 4.1: Reescrever a página como Depot (pai) + lista de serviços

**Files:**
- Create: `src/pages/DepotCadastro.tsx`
- Modify: `src/App.tsx` (import lazy → `DepotCadastro`)
- Delete: `src/pages/VaziosReorgRates.tsx`

- [ ] **Step 1: Criar `DepotCadastro.tsx`**

Master-detail mantido (lista de depots à esquerda). O detalhe passa a ter:
1. Card **Identificação** — código, nome, POL, **free time (dias)**, toggle **ativo**.
2. Card **Serviços** — no padrão `ChargeTablesTab`: botão "Novo serviço" que revela um form (nome, **tipo de cálculo** `Select` com as 3 opções, **valor unitário**, **sujeito a overtime** checkbox, vigência inicial/final), e uma lista de serviços com **editar in-place**, **inativar (toggle)**, **excluir** e badge **"vigente"** (via `valid_from ≤ hoje ≤ valid_to || null` e `active`).

Reusar `useDepots`, `listDepotServices`, `upsertDepotService`, `deleteDepotService`, `upsertDepot`, `deleteDepot`. Para o toggle de ativo do serviço, usar `upsertDepotService({ ...service, active: !service.active })`. O `PageHeader` mantém o título **"Tabela de Depots"** e a descrição "Depots e serviços precificados por tipo de cálculo usados pelo fluxo VAZIOS EXP".

Estrutura de referência (esqueleto — preencher os campos conforme os `Field`/`Input`/`Select` já usados em `VaziosReorgRates.tsx` e `ChargeTablesTab.tsx`):

```tsx
const CALC_TYPES = [
  { value: 'fixo_por_container', label: 'Fixo por container' },
  { value: 'storage_por_dias', label: 'Storage por dias' },
  { value: 'quantidade', label: 'Quantidade (lançada no Vazios EXP)' },
] as const

const isVigente = (s: { active: boolean; valid_from: string; valid_to: string | null }) => {
  const today = new Date().toISOString().slice(0, 10)
  return s.active && s.valid_from <= today && (!s.valid_to || s.valid_to >= today)
}
```

O form de serviço, ao salvar, chama `upsertDepotService({ id?, depot_id: selected.id, name, calc_type, rate_brl, subject_to_overtime, valid_from, valid_to: valid_to || null, active })` e dá `services.refetch()`.

- [ ] **Step 2: Trocar o import lazy em `App.tsx`**

Onde hoje importa `VaziosReorgRates`, passar a importar `DepotCadastro` e usá-lo na rota `/embarquevazios/depots`. Remover a exportação-alias `VaziosReorgRates`.

- [ ] **Step 3: Apagar o arquivo antigo**

```bash
git rm src/pages/VaziosReorgRates.tsx
```

- [ ] **Step 4: Verificar**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DepotCadastro.tsx src/App.tsx
git commit -m "feat(depot): pagina Tabela de Depots com servicos por tipo de calculo"
```

---

## Fase 5 — Import da planilha

### Task 5.1: Parser — coluna OT única, remover flags

**Files:**
- Modify: `src/services/vaziosImport.ts`
- Test: `src/services/__tests__/vaziosImport.test.ts` (criar se não existir)

- [ ] **Step 1: Escrever teste do parser**

Criar `src/services/__tests__/vaziosImport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseVaziosManifestBuffer } from '../vaziosImport'
import * as XLSX from 'xlsx'

function xlsxBuffer(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('parseVaziosManifestBuffer', () => {
  it('lê overtime % de coluna única por container', async () => {
    const buffer = xlsxBuffer([{ Container: 'ABCD1234567', Overtime: '15%' }])
    const result = await parseVaziosManifestBuffer(buffer)
    expect(result.bookings[0].overtime_pct).toBe(15)
  })

  it('vazio = 0', async () => {
    const buffer = xlsxBuffer([{ Container: 'ABCD1234567', Overtime: '' }])
    const result = await parseVaziosManifestBuffer(buffer)
    expect(result.bookings[0].overtime_pct).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- vaziosImport`
Expected: FAIL (`overtime_pct` não existe no tipo parseado).

- [ ] **Step 3: Ajustar o `HEADER_MAP`**

Remover as entradas `bundle`, `transporte`, `ot handling`, `overtime handling`, `ot transporte`, `overtime transporte`, `ot handling %`, `ot transporte %`. Adicionar:

```ts
overtime: 'overtime_pct', 'ot': 'overtime_pct', 'overtime %': 'overtime_pct', 'ot %': 'overtime_pct',
```

Manter `visual check` mapeando? Não — visual check agora é serviço tipo quantidade; remover `'visual check'` e `'visual check...'` do map.

- [ ] **Step 4: Ajustar `ParsedVaziosBooking` e o push**

Remover os campos `bundle`, `transporte`, `overtime_handling`, `overtime_transport`, `visual_check`, `overtime_handling_pct`, `overtime_transport_pct`. Adicionar `overtime_pct: number`. No `bookings.push`, remover as linhas correspondentes e adicionar:

```ts
overtime_pct: parsePercent(mapped.overtime_pct, undefined),
```

Ajustar `parsePercent` para tratar `flag === undefined` (retorna 0 quando não numérico):

```ts
function parsePercent(value: unknown, flag: unknown): number {
  const parsed = Number(String(value ?? '').replace(',', '.').replace('%', '').trim())
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return flag !== undefined && parseBool(flag) ? 100 : 0
}
```

`material`/`condition` permanecem.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- vaziosImport`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/vaziosImport.ts src/services/__tests__/vaziosImport.test.ts
git commit -m "feat(import-vazios): coluna unica de overtime por container; remove flags"
```

### Task 5.2: RPC de import — persistir novo shape

**Files:**
- Create: `supabase/migrations/235_import_vazios_overtime_pct.sql`

- [ ] **Step 1: Reescrever a RPC**

Localizar a definição atual de `import_vazios_bookings_transactional` (migration 232) e recriá-la (`CREATE OR REPLACE FUNCTION`) trocando o conjunto de colunas persistidas: remover `bundle`, `transporte`, `overtime_handling`, `overtime_transport`, `visual_check`, `overtime_handling_pct`, `overtime_transport_pct`; adicionar `overtime_pct`. Manter o upsert por `(voyage_id, container_number)` já introduzido pela 231/232. Colocar o SQL completo do corpo da função nesta migration.

- [ ] **Step 2: Aplicar e testar**

Rodar o teste de migração de import se existir (`npm test -- vaziosExportOperationsMigration`), senão validar manualmente um import pequeno.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/235_import_vazios_overtime_pct.sql
git commit -m "feat(import-vazios): RPC persiste overtime_pct e descarta flags removidas"
```

---

## Fase 6 — Consumo no Vazios EXP

### Task 6.1: Aba Custos usa o novo motor

**Files:**
- Modify: `src/pages/EmbarqueVazios.tsx`

- [ ] **Step 1: Trocar o catálogo de custos**

No `costCatalog` (hoje monta `tariffs` via `resolveCurrentDepotTariff` + `services`), passar a carregar apenas `listCurrentDepotServices` por depot e o mapa de depots (`useDepots`) para obter `free_time_days`. Montar `PricedService[]` e `Map<string, CostDepot>`.

- [ ] **Step 2: Trocar a chamada de `computeOperationTotals`**

Substituir a assinatura antiga (`tariffs, services, { bundle, desova }`) pela nova (`depots, services, qtyByServiceId`). Onde hoje há os inputs `operationQuantities.bundle/desova`, passar a renderizar **um input por serviço tipo `quantidade`** do(s) depot(s) do porto, gravando em `vazios_operation_service_qty` via `upsertOperationServiceQty`. As quantidades vêm de `operationData.service_qty`.

- [ ] **Step 3: Atualizar as colunas da tabela de custos**

Trocar `Handling/Storage/Transporte/Overtime/Serviços` por `Fixos/Storage/Overtime` (o breakdown do novo `ContainerCost`). O total da operação passa a exibir `total` incluindo `qtyTotal`.

- [ ] **Step 4: Remover a UI de reorg antiga**

Excluir a seção "Serviços de reorganização" que usava `REORG_SERVICES`/`reorgRates`/`saveReorgQty`/`reorgDrafts` e as queries `listActiveReorgRates`. Remover a constante `REORG_SERVICES`, `parseReorgServiceType`, `reorgDraftKey` e estados órfãos (`reorgDrafts`, `operationQuantities`).

- [ ] **Step 5: Ajustar o link "Sem tarifa"**

O link contextual passa a apontar para `/embarquevazios/depots` (já feito na Task 0.2) e a condição de "sem tarifa" passa a ser "sem serviço vigente no depot".

- [ ] **Step 6: Remover flags do booking na UI**

Na tabela e no painel ADR expandido, remover badges/checkboxes de `bundle`, `transporte`, `overtime_handling`, `overtime_transport`, `visual_check`. Manter `material`. Adicionar um campo de leitura/edição para `overtime_pct` (% por container).

- [ ] **Step 7: Verificar**

Run: `npm run build && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "feat(vazios): aba Custos usa servicos por tipo de calculo; remove reorg/flags"
```

### Task 6.2: ADR (Operação de Pátio) reflete o novo cálculo

**Files:**
- Modify: `src/components/voyages/VoyageAgencyReportTab.tsx` (e/ou o serviço `agencyDepartureReport.ts`)

- [ ] **Step 1: Localizar onde a Operação de Pátio lê tarifas/reorg**

Grep por `resolveCurrentDepotTariff`, `vazios_reorg`, `overtime_handling` no diretório `src/` para achar todos os pontos que ainda consomem o modelo antigo.

Run: `rg -n "resolveCurrentDepotTariff|vazios_reorg|overtime_handling|overtime_transport|charge_basis|depot_tariffs" src`
Expected: nenhum resultado fora dos já tratados; corrigir os remanescentes para o novo motor/campos.

- [ ] **Step 2: Ajustar o cálculo exibido**

Trocar para `computeContainerCost`/`computeOperationTotals` com o novo shape (mesmos dados da aba Custos). O ADR continua **exibição derivada** — sem entrada de dados.

- [ ] **Step 3: Verificar e commit**

Run: `npm test && npm run build`
Expected: PASS.

```bash
git add -A
git commit -m "feat(adr): Operacao de Patio usa motor de custo por tipo de calculo"
```

---

## Fase 7 — Documentação viva e fechamento

### Task 7.1: Atualizar RASTREABILIDADE e ARCHITECTURE

**Files:**
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Atualizar rotas e rastreabilidade**

Trocar `/embarquevazios/taxas` → `/embarquevazios/depots` (título "Tabela de Depots") e refletir: sem entrada de menu, acesso por botão; Granito idem. Atualizar a linha de rastreabilidade do Vazios EXP para o novo motor de custo, o parser com `overtime_pct` e a tabela `vazios_operation_service_qty`.

- [ ] **Step 2: `docs:check`**

Run: `npm run docs:check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/RASTREABILIDADE.md docs/ARCHITECTURE.md
git commit -m "docs: rota depots, motor de custo e import de overtime"
```

### Task 7.2: Mover este plano para o arquivo ao concluir

- [ ] **Step 1:** Ao terminar a Fase 6, mover este arquivo para `docs/archive/plans/2026-07-23-cadastro-depot-servicos-precificados.md` e remover a linha de `docs/plans/README.md` (regra do CLAUDE.md §6).

- [ ] **Step 2: Verificação final completa**

Run: `npm run docs:check && npm run lint && npm test && npm run build`
Expected: tudo PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: arquiva plano de cadastro de depot por tipo de calculo"
```

---

## Cobertura vs. ADR 0032 (self-review)

- Página no padrão taxas-locais, fora do menu, botão de acesso → Fase 0, Task 4.1 ✅
- Granito fora do menu + botão, slug mantido → Task 0.1/0.3 ✅
- Uma lista de serviços com tipo de cálculo, valor, vigência, editar/inativar/excluir/histórico → Task 4.1 ✅
- Fixo por container aplica a todos; storage por dias; quantidade → Task 3.2 ✅
- free_time atributo do depot → Task 1.1, 3.1, 4.1 ✅
- Overtime % por container do import; incidência (via `subject_to_overtime`) → Task 1.1, 3.2, 5.1 ✅ (mecanismo a confirmar no kickoff)
- Remover flags bundle/visual_check/transporte/overtime do booking → Task 1.1, 5.1, 6.1 ✅
- Aposentar depot_tariffs, vazios_reorg_rates, overtime por operação → Task 1.1, 3.3 ✅
- qty lançada no Vazios EXP (ADR derivado) → Task 3.3, 6.1, 6.2 ✅
- RBAC inalterado (Administrativo + Equipamentos) → sem mudança (Task 1.2 espelha policies) ✅
