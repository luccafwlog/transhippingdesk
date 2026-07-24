# Correções da PR #424 (Cadastro de Depot por tipo de cálculo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os defeitos introduzidos pela PR #424 (mergeada em `1c3c167`) sem reverter o modelo novo da ADR 0032: reparar o encoding do ADR, restaurar o fluxo operacional de `/embarquevazios`, consertar a edição do Cadastro de Depot, corrigir o backfill de `visual_check` e recuperar a cobertura de testes removida fora de escopo.

**Architecture:** A PR #424 trocou tarifas estruturadas por serviços precificados com `calc_type` (`fixo_por_container`, `storage_por_dias`, `quantidade`), `free_time_days` no depot e overtime como `%` por container vindo do import. **O modelo permanece.** Este plano só conserta a execução: uma migration corretiva (`236`), o motor de custo passando a filtrar vigência, a página `/embarquevazios` restaurada a partir do commit anterior e portada para o modelo novo, e os testes removidos restaurados e adaptados.

**Tech Stack:** React 18 + TypeScript, TanStack React Query, Supabase (Postgres + RLS), Vitest + Testing Library (jsdom), Vite, ESLint.

---

## Leitura obrigatória antes de começar

Leia, nesta ordem (não pule — o plano assume esse vocabulário):

1. [`../../CLAUDE.md`](../../CLAUDE.md) — regras de mudança cirúrgica, contrato de documentação e gates de verificação.
2. [`../adr/0032-cadastro-depot-servicos-precificados-por-tipo-de-calculo.md`](../adr/0032-cadastro-depot-servicos-precificados-por-tipo-de-calculo.md) — a decisão que este plano preserva.
3. [`../../CONTEXT.md`](../../CONTEXT.md) — seções *Cadastro de Depot*, *Overtime (de escala)*, *Booking de Vazio (EXP)*, *Serviço Extra de Reorganização*.
4. [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) — linhas de `/embarquevazios` e `/embarquevazios/depots`.

Glossário mínimo:

- **Depot** — terminal onde o container vazio fica antes do embarque. Container sem depot = *Embarque Direto* e não gera custo de depot.
- **Serviço precificado** — linha de `depot_services`: nome, `calc_type`, `rate_brl`, `subject_to_overtime`, `active`, `valid_from`, `valid_to`.
- **Operação** — linha de `vazios_export_operations`, única por (viagem, porto de embarque). É ela que guarda a OS e a quem as quantidades (`vazios_operation_service_qty`) se penduram.
- **ADR** — *Agency Departure Report*, documento assinado por 3 departamentos. Não confundir com *Architecture Decision Record* (também chamado ADR em `docs/adr/`). Neste plano, "ADR" sem qualificação = o relatório.

## Setup

```bash
cd C:/Users/Lucca/Downloads/transhipping-desk2
npm ci
git checkout main && git pull --ff-only
git checkout -b fix/pr-424-cadastro-depot
```

`npm ci` é obrigatório: o checkout atual está com `node_modules/` vazio e nenhum comando de verificação roda sem ele.

Comandos de verificação usados o tempo todo:

```bash
npx vitest run <caminho-do-teste>
npm run lint
npm run typecheck
npm test
npm run build
npm run docs:check
```

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/components/voyages/VoyageAgencyReportTab.tsx` | Aba do ADR na viagem | Modificar (encoding + rótulo do serviço + remover cast morto) |
| `src/__tests__/encoding.test.ts` | Guarda contra mojibake em `src/` | Criar |
| `supabase/migrations/236_fix_visual_check_calc_type.sql` | Corrige `calc_type` herdado do seed 233 | Criar |
| `src/services/__tests__/visualCheckCalcTypeMigration.test.ts` | Contrato SQL da 236 | Criar |
| `src/services/vaziosCusto.ts` | Motor de custo por container/operação | Modificar (filtro de vigência) |
| `src/services/__tests__/vaziosCusto.test.ts` | Testes do motor | Modificar |
| `src/services/agencyDepartureReport.ts` | Deriva os dados do ADR | Modificar (propagar erro de depots) |
| `src/pages/DepotCadastro.tsx` | Tela "Tabela de Depots" | Modificar (edição, confirmação, erros) |
| `src/pages/__tests__/DepotCadastro.behavior.test.tsx` | Comportamento da tela de depots | Criar (renomeia `VaziosReorgRates.behavior.test.tsx`) |
| `src/pages/EmbarqueVazios.tsx` | Tela Vazios EXP | Restaurar de `1c3c167^` e portar |
| `src/pages/__tests__/EquipmentPermissionGates.test.tsx` | Gates RBAC de Equipamentos | Restaurar de `1c3c167^` e adaptar |
| `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx` | Comportamento do ADR | Restaurar de `1c3c167^` e adaptar |
| `src/services/__tests__/vaziosImportAdrColumns.test.ts` | Parser da planilha | Modificar (restaurar casos removidos) |
| `src/services/vaziosImport.ts` | Parser da planilha | Modificar (limpeza do `parsePercent`) |
| `src/services/vaziosExportOperations.ts` | Serviços da operação | Modificar (limpeza defensiva) |
| `supabase/migrations/237_operation_service_qty_index.sql` | Índice do FK | Criar |
| `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`, `docs/plans/README.md` | Documentação viva | Modificar |

---

## Task 1: Reparar o encoding do ADR

`src/components/voyages/VoyageAgencyReportTab.tsx` foi regravado em cp1252 pela PR #424 e 22 linhas viraram mojibake (`Observação` → `ObservaÃ§Ã£o`), inclusive um `aria-label`. O arquivo está **misto**: linhas adicionadas depois têm acentos corretos, então converter o arquivo inteiro corromperia o que está certo. A correção é substituir as 8 sequências corrompidas, que nunca ocorrem legitimamente em português.

**Files:**
- Create: `src/__tests__/encoding.test.ts`
- Modify: `src/components/voyages/VoyageAgencyReportTab.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/__tests__/encoding.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Sequências que só aparecem quando um arquivo UTF-8 foi lido como cp1252 e regravado.
const MOJIBAKE = /Ã§|Ã£|Ã¡|Ã­|Ã©|Ãª|Ã³|Ãµ|â€"|â€¦|â†'|Â·/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('encoding do código-fonte', () => {
  it('nenhum arquivo de src/ contém mojibake de UTF-8 lido como cp1252', () => {
    const offenders = sourceFiles('src').filter((file) => MOJIBAKE.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
```

Atenção ao copiar: as sequências dentro de `MOJIBAKE` precisam ser exatamente `Ã§`, `Ã£`, `Ã¡`, `Ã­`, `Ã©`, `Ãª`, `Ã³`, `Ãµ`, `â€"` (travessão), `â€¦` (reticências), `â†'` (seta) e `Â·` (bullet). Se o seu editor "consertar" esses caracteres ao salvar, o teste vira um no-op — confirme no Step 2 que ele realmente falha.

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
npx vitest run src/__tests__/encoding.test.ts
```

Esperado: FAIL, listando `src/components/voyages/VoyageAgencyReportTab.tsx` no array de `offenders`.

- [ ] **Step 3: Reparar o arquivo**

Rodar exatamente este script (repara só o arquivo afetado, sequência a sequência):

```bash
node -e "
const fs = require('fs');
const file = 'src/components/voyages/VoyageAgencyReportTab.tsx';
const map = [['â€”','—'],['â€¦','…'],['â†’','→'],['Ã§','ç'],['Ã£','ã'],['Ã¡','á'],['Ã­','í'],['Â·','·']];
let text = fs.readFileSync(file, 'utf8');
for (const [bad, good] of map) text = text.split(bad).join(good);
fs.writeFileSync(file, text, 'utf8');
console.log('reparado');
"
```

- [ ] **Step 4: Verificar**

```bash
npx vitest run src/__tests__/encoding.test.ts
git diff --stat src/components/voyages/VoyageAgencyReportTab.tsx
```

Esperado: PASS, e o `--stat` mostrando ~22 linhas alteradas nesse único arquivo. Confira visualmente que `git diff` mostra `Observação`, `Veículos`, `Cabeçalho`, `Importação`, `Operação de pátio`, `—` e `→` corretos.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/encoding.test.ts src/components/voyages/VoyageAgencyReportTab.tsx
git commit -m "fix(adr): reparar encoding UTF-8 da aba do relatorio de agencia"
```

---

## Task 2: Corrigir o `calc_type` herdado de `visual_check`

A migration `233_depot_service_seed.sql` semeou `visual_check` com `charge_basis = 'per_container_flag'`. A `234` mapeou `per_container_flag → 'fixo_por_container'`, que pela ADR 0032 "aplica a **todos** os containers do depot, sem gate por flag". Antes, visual check só era cobrado nos containers com a flag. Resultado: superfaturamento silencioso. Pela ADR, visual check é serviço tipo **Quantidade**.

**Files:**
- Create: `supabase/migrations/236_fix_visual_check_calc_type.sql`
- Create: `src/services/__tests__/visualCheckCalcTypeMigration.test.ts`

- [ ] **Step 1: Escrever o teste de contrato SQL que falha**

Este repositório testa migrations pelo texto do arquivo (veja `src/services/__tests__/depotCadastroMigration.test.ts` como referência de estilo). Criar `src/services/__tests__/visualCheckCalcTypeMigration.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/236_fix_visual_check_calc_type.sql', 'utf8')

describe('migration 236', () => {
  it('reclassifica visual_check como serviço de quantidade', () => {
    expect(migration).toContain("SET calc_type = 'quantidade'")
    expect(migration).toContain("name = 'visual_check'")
    expect(migration).toContain("calc_type = 'fixo_por_container'")
  })

  it('não marca visual_check como sujeito a overtime', () => {
    expect(migration).toContain('subject_to_overtime = FALSE')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/services/__tests__/visualCheckCalcTypeMigration.test.ts
```

Esperado: FAIL com `ENOENT` em `236_fix_visual_check_calc_type.sql`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/236_fix_visual_check_calc_type.sql`:

```sql
-- Corrige o backfill da 234: o seed 233 gravou visual_check como
-- 'per_container_flag', que a 234 mapeou para 'fixo_por_container'. Fixo por
-- container cobra TODOS os containers do depot, sem gate por flag — antes só
-- os containers marcados eram cobrados. Pela ADR 0032, visual check e' servico
-- de tipo Quantidade.

UPDATE public.depot_services
SET calc_type = 'quantidade',
    subject_to_overtime = FALSE
WHERE name = 'visual_check'
  AND calc_type = 'fixo_por_container';
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/services/__tests__/visualCheckCalcTypeMigration.test.ts
```

Esperado: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/236_fix_visual_check_calc_type.sql src/services/__tests__/visualCheckCalcTypeMigration.test.ts
git commit -m "fix(vazios): reclassificar visual_check como servico de quantidade"
```

---

## Task 3: O motor de custo passa a filtrar vigência e ativação

`computeContainerCost` soma **toda** `PricedService` que receber. Hoje os dois chamadores passam `listCurrentDepotServices` (que já filtra no banco), mas nada impede um chamador futuro passar `listDepotServices` cru e superfaturar. Para um caminho de dinheiro, o filtro pertence ao motor — e é ele que fica coberto por teste.

**Files:**
- Modify: `src/services/vaziosCusto.ts`
- Modify: `src/services/__tests__/vaziosCusto.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `src/services/__tests__/vaziosCusto.test.ts`, substituir a constante `services` e acrescentar dois testes. O arquivo inteiro fica assim:

```ts
import { describe, expect, it } from 'vitest'
import { computeContainerCost, computeOperationTotals, type CostContainer, type CostDepot, type PricedService } from '../vaziosCusto'

const depot: CostDepot = { id: 'd1', free_time_days: 2 }
const services: PricedService[] = [
  { id: 's1', depot_id: 'd1', name: 'Handling', calc_type: 'fixo_por_container', rate_brl: 100, subject_to_overtime: true, active: true, valid_from: '2026-01-01', valid_to: null },
  { id: 's2', depot_id: 'd1', name: 'Transporte', calc_type: 'fixo_por_container', rate_brl: 50, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null },
  { id: 's3', depot_id: 'd1', name: 'Storage', calc_type: 'storage_por_dias', rate_brl: 10, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null },
  { id: 's4', depot_id: 'd1', name: 'Reorganização', calc_type: 'quantidade', rate_brl: 30, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null },
]
const on = '2026-01-10'

describe('computeContainerCost', () => {
  it('soma fixos, storage além do free time e overtime dos serviços marcados', () => {
    const container: CostContainer = { container_number: 'ABCD1234567', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-06', overtime_pct: 10 }
    const cost = computeContainerCost(container, depot, services, on)
    expect(cost.fixed).toBe(150); expect(cost.storage).toBe(30); expect(cost.overtime).toBe(10); expect(cost.total).toBe(190)
  })
  it('sem depot resolve zero', () => expect(computeContainerCost({ container_number: 'X', depot_id: null }, depot, services, on).total).toBe(0))
  it('storage nunca negativo dentro do free time', () => expect(computeContainerCost({ container_number: 'C', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-02', overtime_pct: 0 }, depot, services, on).storage).toBe(0))

  it('ignora serviço inativo', () => {
    const inativo: PricedService[] = [{ ...services[0], active: false }]
    const cost = computeContainerCost({ container_number: 'C', depot_id: 'd1' }, depot, inativo, on)
    expect(cost.fixed).toBe(0)
  })

  it('ignora serviço fora da vigência', () => {
    const futuro: PricedService[] = [{ ...services[0], valid_from: '2026-02-01' }]
    const encerrado: PricedService[] = [{ ...services[0], valid_to: '2026-01-05' }]
    expect(computeContainerCost({ container_number: 'C', depot_id: 'd1' }, depot, futuro, on).fixed).toBe(0)
    expect(computeContainerCost({ container_number: 'C', depot_id: 'd1' }, depot, encerrado, on).fixed).toBe(0)
  })
})

describe('computeOperationTotals', () => {
  it('inclui quantidade por serviço', () => {
    const container: CostContainer = { container_number: 'C', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-04', overtime_pct: 0 }
    const totals = computeOperationTotals([container], new Map([['d1', depot]]), services, new Map([['s4', 2]]), on)
    expect(totals.qtyTotal).toBe(60); expect(totals.total).toBe(220)
  })

  it('não soma quantidade de serviço fora da vigência', () => {
    const encerrado: PricedService[] = [{ ...services[3], valid_to: '2026-01-05' }]
    const totals = computeOperationTotals([], new Map(), encerrado, new Map([['s4', 2]]), on)
    expect(totals.qtyTotal).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/services/__tests__/vaziosCusto.test.ts
```

Esperado: FAIL — erro de tipo/compilação em `active`/`valid_from`/`valid_to` (não existem em `PricedService`) e os dois testes novos retornando `100`/`60` em vez de `0`.

- [ ] **Step 3: Implementar o filtro no motor**

Substituir o conteúdo de `src/services/vaziosCusto.ts` por:

```ts
export type ServiceCalcType = 'fixo_por_container' | 'storage_por_dias' | 'quantidade'

export type PricedService = {
  id: string
  depot_id: string
  name: string
  calc_type?: string
  rate_brl: number
  subject_to_overtime?: boolean
  active?: boolean
  valid_from?: string
  valid_to?: string | null
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

const today = () => new Date().toISOString().slice(0, 10)

const daysBetween = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start || !end) return 0
  const startMs = Date.parse(start); const endMs = Date.parse(end)
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 86_400_000)) : 0
}

// Vigência e ativação vivem no motor, não no chamador: é caminho de dinheiro e
// um chamador que passasse listDepotServices cru superfaturaria em silêncio.
export function isVigente(service: PricedService, on = today()): boolean {
  if (service.active === false) return false
  if (service.valid_from && service.valid_from > on) return false
  if (service.valid_to && service.valid_to < on) return false
  return true
}

export function computeContainerCost(container: CostContainer, depot: CostDepot | null, services: PricedService[] = [], on = today()): ContainerCost {
  const zero: ContainerCost = { container_number: container.container_number, fixed: 0, storage: 0, overtime: 0, total: 0, breakdown: [] }
  if (!depot || !container.depot_id) return zero
  const own = services.filter((service) => service.depot_id === container.depot_id && isVigente(service, on))
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
  depots: Map<string, CostDepot | null>,
  services: PricedService[],
  qtyByServiceId: Map<string, number>,
  on = today(),
) {
  const rows = containers.map((container) => computeContainerCost(container, container.depot_id ? depots.get(container.depot_id) ?? null : null, services, on))
  const qtyTotal = services
    .filter((s) => s.calc_type === 'quantidade' && isVigente(s, on))
    .reduce((sum, s) => sum + (qtyByServiceId.get(s.id) ?? 0) * Number(s.rate_brl), 0)
  return { rows, qtyTotal, total: rows.reduce((sum, row) => sum + row.total, 0) + qtyTotal }
}
```

Note que o `qtyByServiceId instanceof Map ? … : 0` defensivo saiu: o parâmetro é tipado como `Map`, a defesa protegia contra um chamador que não existe.

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/services/__tests__/vaziosCusto.test.ts
npm run typecheck
```

Esperado: PASS (7 testes) e typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/services/vaziosCusto.ts src/services/__tests__/vaziosCusto.test.ts
git commit -m "fix(vazios): motor de custo filtra vigencia e ativacao dos servicos"
```

---

## Task 4: Falha ao carregar depots não pode virar custo zero no ADR

`getAgencyReportDerivedData` engole o erro de `listDepots()` com `catch { allDepots = [] }`. Sem depot, `computeContainerCost` retorna zero em tudo, e o ADR — documento assinado — exibe R$ 0,00 em vez de falhar. Todas as outras buscas do arquivo propagam erro.

**Files:**
- Modify: `src/services/agencyDepartureReport.ts`

- [ ] **Step 1: Localizar o trecho**

```bash
grep -n "allDepots" src/services/agencyDepartureReport.ts
```

Esperado: 3 linhas, entre elas `let allDepots: Awaited<ReturnType<typeof listDepots>> = []`.

- [ ] **Step 2: Substituir por uma chamada que propaga**

Trocar estas três linhas:

```ts
  let allDepots: Awaited<ReturnType<typeof listDepots>> = []
  try { allDepots = await listDepots() } catch { allDepots = [] }
  const depotEntries = depotIds.map((depotId) => [depotId, allDepots.find((depot) => depot.id === depotId) ?? null] as const)
```

por:

```ts
  const allDepots = await listDepots()
  const depotEntries = depotIds.map((depotId) => [depotId, allDepots.find((depot) => depot.id === depotId) ?? null] as const)
```

- [ ] **Step 3: Verificar**

```bash
npm run typecheck
npx vitest run src/services/__tests__
```

Esperado: typecheck limpo; suíte de services passando.

- [ ] **Step 4: Commit**

```bash
git add src/services/agencyDepartureReport.ts
git commit -m "fix(adr): propagar falha ao carregar depots em vez de zerar custos"
```

---

## Task 5: Consertar a edição no Cadastro de Depot

Três defeitos na mesma tela (`src/pages/DepotCadastro.tsx`):

1. `editService()` preenche o formulário mas `saveService()` chama `upsertDepotService` **sem `id`** → `insert`. É exatamente o defeito que a ADR 0032 §Contexto-2 diz corrigir, e com o motor somando serviços vigentes, cada reedição infla o custo.
2. `selected` cai em `depots.data?.[0]` quando nada foi escolhido, mas `depotForm` só é preenchido por `choose()`. Digitar um código sem clicar num depot **sobrescreve o primeiro depot da lista**; "Excluir depot" apaga esse mesmo depot não escolhido.
3. Exclusões sem confirmação e `.then()` sem `.catch()`: falha de RLS não mostra nada ao usuário.

**Files:**
- Create: `src/pages/__tests__/DepotCadastro.behavior.test.tsx`
- Delete: `src/pages/__tests__/VaziosReorgRates.behavior.test.tsx`
- Modify: `src/pages/DepotCadastro.tsx`

- [ ] **Step 1: Escrever os testes que falham**

```bash
git rm src/pages/__tests__/VaziosReorgRates.behavior.test.tsx
```

Criar `src/pages/__tests__/DepotCadastro.behavior.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  upsertDepotService: vi.fn(async () => {}),
  upsertDepot: vi.fn(async () => {}),
  deleteDepot: vi.fn(async () => {}),
  deleteDepotService: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  showToast: vi.fn(),
}

const depot = { id: 'd1', code: 'VBR', name: 'Vila Velha', pol_port: 'BRVIX', free_time_days: 3, active: true }
const service = { id: 's1', depot_id: 'd1', name: 'Handling', calc_type: 'fixo_por_container', rate_brl: 100, subject_to_overtime: true, active: true, valid_from: '2026-01-01', valid_to: null }

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../hooks/useDepots', () => ({ useDepots: () => ({ data: [depot], error: null, refetch: vi.fn(async () => {}) }) }))
vi.mock('../../services/depots', () => ({
  listDepotServices: vi.fn(async () => [service]),
  upsertDepot: (...args: unknown[]) => mocks.upsertDepot(...(args as [])),
  upsertDepotService: (...args: unknown[]) => mocks.upsertDepotService(...(args as [])),
  deleteDepot: (...args: unknown[]) => mocks.deleteDepot(...(args as [])),
  deleteDepotService: (...args: unknown[]) => mocks.deleteDepotService(...(args as [])),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { DepotCadastro } from '../DepotCadastro'

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><DepotCadastro /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Cadastro de Depot', () => {
  beforeEach(() => { for (const fn of Object.values(mocks)) (fn as { mockClear: () => void }).mockClear() })

  it('apresenta o novo modelo de serviços precificados', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Tabela de Depots' })).toBeTruthy()
    expect(screen.getByText(/serviços precificados por tipo de cálculo/i)).toBeTruthy()
  })

  it('editar um serviço e salvar atualiza (não duplica)', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /editar/i }))
    fireEvent.click(screen.getByRole('button', { name: /salvar serviço/i }))
    await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalled())
    expect(mocks.upsertDepotService.mock.calls[0][0]).toMatchObject({ id: 's1', depot_id: 'd1' })
  })

  it('carrega o formulário do depot selecionado por padrão', async () => {
    renderPage()
    await waitFor(() => expect((screen.getByLabelText('Código') as HTMLInputElement).value).toBe('VBR'))
    expect((screen.getByLabelText('Free time (dias)') as HTMLInputElement).value).toBe('3')
  })

  it('pede confirmação antes de excluir um depot', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /excluir depot/i }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.deleteDepot).toHaveBeenCalledWith('d1')
  })

  it('não exclui quando a confirmação é negada', async () => {
    mocks.confirm.mockResolvedValueOnce(false)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /excluir depot/i }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.deleteDepot).not.toHaveBeenCalled()
  })

  it('mostra toast de erro quando o salvamento falha', async () => {
    mocks.upsertDepot.mockRejectedValueOnce(new Error('sem permissão'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /salvar depot/i }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('sem permissão', 'error'))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/pages/__tests__/DepotCadastro.behavior.test.tsx
```

Esperado: FAIL — 5 dos 6 testes quebram (`id` ausente no upsert, campo `Código` vazio, `confirm` nunca chamado, nenhum toast).

- [ ] **Step 3: Implementar**

Substituir o conteúdo de `src/pages/DepotCadastro.tsx` por:

```tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Edit3, Plus, Power, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useDepots } from '../hooks/useDepots'
import { deleteDepot, deleteDepotService, listDepotServices, upsertDepot, upsertDepotService, type DepotService } from '../services/depots'
import { formatBRL, formatDate } from '../lib/utils'

const today = () => new Date().toISOString().slice(0, 10)
const isVigente = (service: Pick<DepotService, 'active' | 'valid_from' | 'valid_to'>) => service.active && service.valid_from <= today() && (!service.valid_to || service.valid_to >= today())
const calcTypes = [
  ['fixo_por_container', 'Fixo por container'],
  ['storage_por_dias', 'Storage por dias'],
  ['quantidade', 'Quantidade (lançada no Vazios EXP)'],
] as const
const emptyDepotForm = { code: '', name: '', pol_port: '', free_time_days: 0, active: true }
const emptyServiceForm = { id: undefined as string | undefined, name: '', calc_type: 'fixo_por_container', rate_brl: 0, subject_to_overtime: false, valid_from: today(), valid_to: '', active: true }

export function DepotCadastro() {
  const { can } = useAuth()
  const canEdit = can('depots_edit')
  const confirm = useConfirm()
  const { showToast } = useToast()
  const depots = useDepots()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newDepot, setNewDepot] = useState(false)
  const selected = newDepot ? null : depots.data?.find((item) => item.id === selectedId) ?? depots.data?.[0] ?? null
  const [depotForm, setDepotForm] = useState(emptyDepotForm)
  const [serviceForm, setServiceForm] = useState(emptyServiceForm)
  const services = useQuery({ queryKey: ['depot-services', selected?.id], queryFn: () => listDepotServices(selected!.id), enabled: Boolean(selected) })

  // O formulário sempre espelha o depot realmente selecionado — inclusive o
  // fallback para o primeiro da lista. Sem isso, salvar sobrescreve um depot
  // que o usuário nunca escolheu.
  useEffect(() => {
    if (newDepot || !selected) return
    setDepotForm({ code: selected.code, name: selected.name ?? '', pol_port: selected.pol_port ?? '', free_time_days: selected.free_time_days, active: selected.active })
    setServiceForm(emptyServiceForm)
  }, [newDepot, selected])

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action()
      showToast(success, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao salvar.', 'error')
    }
  }

  function startNewDepot() {
    setNewDepot(true); setSelectedId(null); setDepotForm(emptyDepotForm); setServiceForm(emptyServiceForm)
  }
  function choose(id: string) { setNewDepot(false); setSelectedId(id) }

  async function saveDepot() {
    await run(async () => {
      await upsertDepot({ ...depotForm, id: newDepot ? undefined : selected?.id })
      await depots.refetch(); setNewDepot(false)
    }, 'Depot salvo.')
  }
  async function removeDepot() {
    if (!selected) return
    if (!(await confirm({ message: `Excluir o depot ${selected.code}? Os serviços precificados dele também serão removidos.`, tone: 'danger', confirmLabel: 'Excluir' }))) return
    await run(async () => { await deleteDepot(selected.id); setSelectedId(null); await depots.refetch() }, 'Depot excluído.')
  }
  async function saveService() {
    if (!selected) return
    await run(async () => {
      await upsertDepotService({ ...serviceForm, depot_id: selected.id, valid_to: serviceForm.valid_to || null })
      setServiceForm(emptyServiceForm); await services.refetch()
    }, 'Serviço salvo.')
  }
  async function toggleService(service: DepotService) {
    await run(async () => { await upsertDepotService({ ...service, active: !service.active }); await services.refetch() }, service.active ? 'Serviço inativado.' : 'Serviço ativado.')
  }
  async function removeService(service: DepotService) {
    if (!(await confirm({ message: `Excluir o serviço ${service.name}?`, tone: 'danger', confirmLabel: 'Excluir' }))) return
    await run(async () => { await deleteDepotService(service.id); await services.refetch() }, 'Serviço excluído.')
  }
  function editService(service: DepotService) {
    setServiceForm({ id: service.id, name: service.name, calc_type: service.calc_type, rate_brl: Number(service.rate_brl), subject_to_overtime: service.subject_to_overtime, valid_from: service.valid_from, valid_to: service.valid_to ?? '', active: service.active })
  }

  return <div className="grid gap-5">
    <PageHeader title="Tabela de Depots" description="Depots e serviços precificados por tipo de cálculo usados pelo fluxo VAZIOS EXP." action={canEdit ? <Button onClick={startNewDepot}><Plus size={16} /> Novo depot</Button> : null} />
    {depots.error ? <InlineError message="Erro ao carregar depots." /> : null}
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <Card className="grid content-start gap-2"><h2 className="app-panel__title">Depots</h2>{(depots.data ?? []).map((depot) => <button key={depot.id} type="button" onClick={() => choose(depot.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === depot.id ? 'border-[var(--app-blue-btn)]' : 'border-[var(--app-border)]'}`}><span className="font-semibold">{depot.code}</span><span className="block text-xs text-[var(--app-muted)]">{depot.name || depot.pol_port || 'Sem nome'}</span></button>)}</Card>
      <div className="grid gap-5">
        <Card className="grid gap-3">
          <h2 className="app-panel__title">Identificação</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Código"><Input value={depotForm.code} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, code: e.target.value }))} /></Field>
            <Field label="Nome"><Input value={depotForm.name} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="POL / porto"><Input value={depotForm.pol_port} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, pol_port: e.target.value }))} /></Field>
            <Field label="Free time (dias)"><Input type="number" min={0} value={depotForm.free_time_days} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, free_time_days: Number(e.target.value) }))} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={depotForm.active} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, active: e.target.checked }))} /> Depot ativo</label>
          {canEdit ? <span className="flex gap-2"><Button onClick={() => void saveDepot()} disabled={!depotForm.code.trim()}>Salvar depot</Button>{selected ? <Button variant="ghost" onClick={() => void removeDepot()}>Excluir depot</Button> : null}</span> : null}
        </Card>
        {selected ? <Card className="grid gap-3">
          <h2 className="app-panel__title">Serviços</h2>
          <div className="grid gap-3 md:grid-cols-5">
            <Field label="Nome"><Input value={serviceForm.name} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Tipo de cálculo"><Select value={serviceForm.calc_type} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, calc_type: e.target.value }))}>{calcTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
            <Field label="Valor unitário"><Input type="number" min={0} step="0.01" value={serviceForm.rate_brl} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, rate_brl: Number(e.target.value) }))} /></Field>
            <Field label="Vigência inicial"><Input type="date" value={serviceForm.valid_from} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, valid_from: e.target.value }))} /></Field>
            <Field label="Vigência final"><Input type="date" value={serviceForm.valid_to} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, valid_to: e.target.value }))} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceForm.subject_to_overtime} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, subject_to_overtime: e.target.checked }))} /> Sujeito a overtime</label>
          </div>
          {canEdit ? <span className="flex gap-2"><Button onClick={() => void saveService()} disabled={!serviceForm.name.trim()}><Plus size={16} /> {serviceForm.id ? 'Salvar serviço' : 'Adicionar serviço'}</Button>{serviceForm.id ? <Button variant="ghost" onClick={() => setServiceForm(emptyServiceForm)}>Cancelar edição</Button> : null}</span> : null}
          <ul className="grid gap-2 text-sm">{(services.data ?? []).map((service: DepotService) => <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2">
            <span className={service.active ? '' : 'opacity-60'}>{service.name} · {formatBRL(Number(service.rate_brl))} · {calcTypes.find(([value]) => value === service.calc_type)?.[1] ?? service.calc_type} · {formatDate(service.valid_from)}{service.valid_to ? ` — ${formatDate(service.valid_to)}` : ''} · {isVigente(service) ? 'vigente' : service.active ? 'fora da vigência' : 'inativo'}</span>
            {canEdit ? <span className="flex gap-1">
              <Button variant="ghost" onClick={() => editService(service)}><Edit3 size={14} /> Editar</Button>
              <Button variant="ghost" onClick={() => void toggleService(service)}><Power size={14} /> {service.active ? 'Inativar' : 'Ativar'}</Button>
              <Button variant="ghost" onClick={() => void removeService(service)}><Trash2 size={14} /> Excluir</Button>
            </span> : null}
          </li>)}</ul>
        </Card> : <Card><p className="text-sm text-[var(--app-muted)]">Selecione ou crie um depot para configurar serviços.</p></Card>}
      </div>
    </div>
  </div>
}
```

Se `Button` não aceitar `variant="ghost"`, use o mesmo `variant` que a versão atual do arquivo já usava — não invente variantes novas.

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/pages/__tests__/DepotCadastro.behavior.test.tsx
npm run typecheck
npm run lint
```

Esperado: PASS (6 testes), typecheck e lint limpos.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DepotCadastro.tsx src/pages/__tests__/DepotCadastro.behavior.test.tsx
git commit -m "fix(vazios): corrigir edicao, selecao e confirmacoes do cadastro de depot"
```

---

## Task 6: Restaurar o fluxo operacional de `/embarquevazios`

A PR #424 reduziu `src/pages/EmbarqueVazios.tsx` de 980 para 36 linhas. Sumiram: paginação (hoje `pageSize: 100` fixo, então escalas com mais de 100 containers **calculam custo só sobre os 100 primeiros, sem aviso**), edição inline por container, campo de OS, deep-link `?voyage=` e filtros na URL. Pior: `upsertVaziosExportOperation` deixou de ser chamado por qualquer página — sem linha em `vazios_export_operations`, os inputs de quantidade ficam `disabled` para sempre e **não há caminho no app para criar a operação**, o que torna os serviços de tipo Quantidade inalcançáveis.

A estratégia é restaurar o arquivo do commit anterior ao merge e portá-lo para o modelo novo, edição por edição. Não reescreva do zero.

**Files:**
- Modify: `src/pages/EmbarqueVazios.tsx` (restaurado de `1c3c167^`)

### 6.1 Restaurar o arquivo

- [ ] **Step 1: Restaurar**

```bash
git show 1c3c167^:src/pages/EmbarqueVazios.tsx > src/pages/EmbarqueVazios.tsx
git diff --stat src/pages/EmbarqueVazios.tsx
```

Esperado: o arquivo volta a ter 980 linhas.

- [ ] **Step 2: Confirmar que o typecheck falha (esperado)**

```bash
npm run typecheck
```

Esperado: FAIL, com erros em `VaziosReorgServiceType`, `listActiveReorgRates`, `upsertOvertimeDepot`, `upsertReorgService`, `resolveCurrentDepotTariff`, `booking.bundle`, `booking.overtime_handling` etc. Essa lista de erros é o roteiro dos passos seguintes.

- [ ] **Step 3: Commit do ponto de partida**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "chore(vazios): restaurar EmbarqueVazios antes de portar para o modelo novo"
```

### 6.2 Portar imports, constantes e estado

- [ ] **Step 1: Trocar o bloco de imports**

Substituir as linhas de import de serviços/tipos (as que citam `vaziosExportOperations`, `depots` e `types/database`) por:

```tsx
import {
  getVaziosExportOperation,
  listVaziosBookingsForOperation,
  updateVaziosBooking,
  upsertOperationServiceQty,
  upsertVaziosExportOperation,
} from '../services/vaziosExportOperations'
import { listCurrentDepotServices, listDepots } from '../services/depots'
```

Remover completamente `import type { VaziosReorgServiceType } from '../types/database'`. Manter todos os outros imports do arquivo restaurado (`Fragment`, `useSearchParams`, `FilterBar`, `TableFooterPagination`, `TruncationNote`, `Badge`, `usePageFilters`, `PAGE_SIZES`, `normalizePortCode`, ícones) — eles voltam a ser usados.

Nos ícones, remover `Boxes`, `Truck` e `Clock3` da lista do `lucide-react` (as badges que os usavam saem no passo 6.4) e manter `ChevronDown`, `ChevronUp`, `Download`, `Package`, `Upload`.

- [ ] **Step 2: Remover as constantes e helpers do modelo antigo**

Apagar `REORG_SERVICES`, `reorgDraftKey`, `parseReorgServiceType` e `BOOKING_ADR_FLAGS` inteiros.

- [ ] **Step 3: Trocar o estado**

Trocar:

```tsx
  const [overtimeDrafts, setOvertimeDrafts] = useState<Record<string, string>>({})
  const [reorgDrafts, setReorgDrafts] = useState<Record<string, string>>({})
```

por:

```tsx
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})
```

e apagar a linha `const [operationQuantities, setOperationQuantities] = useState({ bundle: 0, desova: 0 })`.

- [ ] **Step 4: Trocar as queries de catálogo**

Apagar a query `reorgRatesData` inteira (`queryKey: ['vazios-reorg-rates', 'active']`) e substituir a query `costCatalog` por:

```tsx
  const costCatalog = useQuery({
    queryKey: ['vazios-cost-catalog', selectedPortBookings.map((booking) => booking.depot_id ?? '').sort()],
    queryFn: async () => {
      const depotIds = [...new Set(selectedPortBookings.map((booking) => booking.depot_id).filter((id): id is string => Boolean(id)))]
      const allDepots = await listDepots()
      const depots = new Map(depotIds.map((depotId) => [depotId, allDepots.find((depot) => depot.id === depotId) ?? null] as const))
      const services = (await Promise.all(depotIds.map((depotId) => listCurrentDepotServices(depotId)))).flat()
      return { depots, services }
    },
    // Não é mais gated por aba: as quantidades por serviço são lançadas na aba
    // de operação e precisam da lista de serviços do depot.
    enabled: Boolean(selectedOperationPort) && selectedPortBookings.length > 0,
  })
  const qtyServices = (costCatalog.data?.services ?? []).filter((service) => service.calc_type === 'quantidade')
  const savedQty = new Map((operation?.service_qty ?? []).map((row) => [row.depot_service_id, row.qty]))
```

- [ ] **Step 5: Remover os derivados do modelo antigo**

Apagar os blocos `savedDepots` / `operationDepots`, `savedTypes` / `operationContainerTypes` e todo o bloco `const reorgRates = new Map…` (incluindo o `if (Array.isArray(reorgRatesData)) { … }`).

- [ ] **Step 6: Commit parcial**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "refactor(vazios): portar estado e catalogo de EmbarqueVazios para o modelo novo"
```

### 6.3 Portar os handlers de persistência

- [ ] **Step 1: Apagar `saveOvertimePercent` e `saveReorgQty`**

Remover as duas funções inteiras. **Manter `ensureOperationId` e `saveOperationOs` exatamente como estão** — `ensureOperationId` é justamente a peça que faltava para criar a operação sob demanda.

- [ ] **Step 2: Adicionar o handler de quantidade**

Inserir, logo depois de `saveOperationOs`:

```tsx
  async function saveServiceQty(serviceId: string, serviceName: string) {
    const draftStateKey = `${operationDraftPrefix}:qty:${serviceId}`
    const saved = savedQty.get(serviceId)
    const rawValue = qtyDrafts[draftStateKey] ?? String(saved ?? 0)
    const qty = Number(rawValue)
    if (!rawValue.trim() || !Number.isInteger(qty) || qty < 0) {
      showToast('Informe uma quantidade inteira maior ou igual a zero.', 'error')
      setQtyDrafts((current) => ({ ...current, [draftStateKey]: String(saved ?? 0) }))
      return
    }
    if (saved == null && qty === 0) return
    if (saved === qty) return

    const changed = await persistChange(`qty:${serviceId}`, async () => {
      const operationId = await ensureOperationId()
      await upsertOperationServiceQty({ operationId, depotServiceId: serviceId, qty })
      await queryClient.invalidateQueries({ queryKey: operationQueryKey })
    }, `Quantidade de ${serviceName} atualizada.`)
    if (changed) {
      setQtyDrafts((current) => {
        const next = { ...current }
        delete next[draftStateKey]
        return next
      })
    }
  }
```

- [ ] **Step 3: Commit parcial**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "feat(vazios): lancar quantidade por servico criando a operacao sob demanda"
```

### 6.4 Portar a renderização

- [ ] **Step 1: Botão da Tabela de Depots no cabeçalho**

No `action` do `PageHeader`, antes do `<a … download>`, inserir:

```tsx
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to="/embarquevazios/depots"
            >
              Tabela de Depots
            </Link>
```

- [ ] **Step 2: Trocar a seção "Overtime por depot"**

O overtime agora é `%` por container vindo do import — não há mais percentual por depot. Substituir a `<section>` inteira de "Overtime por depot" por:

```tsx
              <section>
                <h3 className="text-sm font-semibold text-white">Overtime</h3>
                <p className="mt-1 text-xs text-slate-400">
                  O percentual vem da coluna de overtime da planilha, por container, e incide sobre os serviços fixos marcados como sujeitos a overtime no depot.
                </p>
                <div className="mt-3 text-sm text-slate-300">
                  {selectedPortBookings.filter((booking) => Number(booking.overtime_pct ?? 0) > 0).length} de {selectedPortBookings.length} containers com overtime.
                </div>
              </section>
```

- [ ] **Step 3: Trocar a seção "Serviços de reorganização"**

Substituir a `<section>` inteira por:

```tsx
              <section>
                <h3 className="text-sm font-semibold text-white">Serviços por quantidade</h3>
                <p className="mt-1 text-xs text-slate-400">Serviços do tipo Quantidade cadastrados nos depots deste porto; valor = quantidade × valor unitário.</p>
                {costCatalog.error ? <div className="mt-3"><InlineError message="Erro ao carregar serviços do depot." /></div> : null}
                {qtyServices.length ? (
                  <div className="app-table-scroll mt-3 rounded-xl border border-[#30363d]">
                    <table className="app-table app-table--compact min-w-[680px] text-left text-sm whitespace-nowrap">
                      <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th scope="col" className="px-3 py-2">Serviço</th>
                          <th scope="col" className="px-3 py-2">Quantidade</th>
                          <th scope="col" className="px-3 py-2">Valor unitário</th>
                          <th scope="col" className="px-3 py-2">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#30363d]">
                        {qtyServices.map((service) => {
                          const draftStateKey = `${operationDraftPrefix}:qty:${service.id}`
                          const saved = savedQty.get(service.id)
                          const qty = Number(qtyDrafts[draftStateKey] ?? saved ?? 0)
                          const rate = Number(service.rate_brl)
                          return (
                            <tr key={service.id}>
                              <td className="px-3 py-2 font-medium text-white">{service.name}</td>
                              <td className="px-3 py-2">
                                <Input
                                  aria-label={`${service.name} quantidade`}
                                  className="w-28"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={qtyDrafts[draftStateKey] ?? String(saved ?? 0)}
                                  readOnly={!canEditVazios}
                                  disabled={Boolean(operationError) || savingKey === `qty:${service.id}`}
                                  onChange={(event) => setQtyDrafts((current) => ({ ...current, [draftStateKey]: event.target.value }))}
                                  onBlur={() => void saveServiceQty(service.id, service.name)}
                                />
                              </td>
                              <td className="px-3 py-2">{formatBRL(rate)}</td>
                              <td className="px-3 py-2 font-semibold text-white">{Number.isFinite(qty) ? formatBRL(qty * rate) : '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-400">
                    Nenhum serviço de quantidade cadastrado nos depots deste porto. Cadastre em <Link className="app-table__action" to="/embarquevazios/depots">Tabela de Depots</Link>.
                  </div>
                )}
              </section>
```

Remover também a linha `{reorgRatesError ? <div className="mt-4"><InlineError message="Erro ao carregar tarifas de reorganização." /></div> : null}`.

- [ ] **Step 4: Portar a aba de custos**

Substituir o corpo do `costCatalog.data` (o IIFE que monta `totals`) por:

```tsx
          {selectedPortBookings.length > 0 && costCatalog.data ? (() => {
            const totals = computeOperationTotals(
              selectedPortBookings.map((booking) => ({
                container_number: booking.container_number ?? '—',
                depot_id: booking.depot_id,
                hand_in_date: booking.hand_in_date,
                hand_out_date: booking.hand_out_date,
                overtime_pct: booking.overtime_pct,
              })),
              costCatalog.data.depots,
              costCatalog.data.services,
              savedQty,
            )
            return <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-[var(--app-border)] p-3"><div className="text-xs uppercase text-[var(--app-muted)]">Containers</div><div className="mt-1 text-2xl font-bold">{formatBRL(totals.rows.reduce((sum, row) => sum + row.total, 0))}</div></div>
                <div className="rounded-xl border border-[var(--app-border)] p-3"><div className="text-xs uppercase text-[var(--app-muted)]">Serviços por quantidade</div><div className="mt-1 text-2xl font-bold">{formatBRL(totals.qtyTotal)}</div></div>
                <div className="rounded-xl border border-[var(--app-border)] p-3"><div className="text-xs uppercase text-[var(--app-muted)]">Total</div><div className="mt-1 text-2xl font-bold">{formatBRL(totals.total)}</div></div>
              </div>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact w-full text-left text-sm">
                  <thead><tr><th>Container</th><th>Fixos</th><th>Storage</th><th>Overtime</th><th>Total</th></tr></thead>
                  <tbody>{totals.rows.map((row) => <tr key={row.container_number}><td>{row.container_number}</td><td>{formatBRL(row.fixed)}</td><td>{formatBRL(row.storage)}</td><td>{formatBRL(row.overtime)}</td><td className="font-semibold">{formatBRL(row.total)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          })() : null}
```

Trocar também a mensagem de erro dessa aba de `"Erro ao carregar tarifas vigentes."` para `"Erro ao carregar serviços vigentes."`.

- [ ] **Step 5: Portar as badges da coluna ADR**

Na coluna ADR da tabela, apagar o bloco `const overtimeLabels = […]` e os três blocos de badge `booking.bundle`, `booking.transporte` e `overtimeLabels`. No lugar dos três, inserir:

```tsx
                          {Number(booking.overtime_pct ?? 0) > 0 ? (
                            <span title={`Overtime ${booking.overtime_pct}%`}>
                              <Badge tone="yellow">{`OT ${booking.overtime_pct}%`}</Badge>
                            </span>
                          ) : null}
```

- [ ] **Step 6: Portar o accordion**

Substituir o bloco `{BOOKING_ADR_FLAGS.map(…)}` por dois campos — material (checkbox) e overtime (numérico):

```tsx
                            <label className="app-field">
                              <span className="app-field__label">Material do armador</span>
                              <span className="flex h-10 items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 text-sm text-slate-200">
                                <input
                                  aria-label={`Material do armador do booking ${booking.booking_number}`}
                                  type="checkbox"
                                  checked={booking.material}
                                  disabled={!canEditVazios || savingBooking}
                                  onChange={(event) => void saveBookingPatch(booking.id, { material: event.currentTarget.checked })}
                                />
                                {booking.material ? 'Sim' : 'Não'}
                              </span>
                            </label>
                            <Field label="Overtime (%)">
                              <Input
                                aria-label={`Percentual de overtime do booking ${booking.booking_number}`}
                                type="number"
                                min="0"
                                max="999.99"
                                step="0.01"
                                defaultValue={String(booking.overtime_pct ?? 0)}
                                readOnly={!canEditVazios}
                                disabled={savingBooking}
                                onBlur={(event) => {
                                  const next = Number(event.currentTarget.value)
                                  if (!Number.isFinite(next) || next < 0 || next > 999.99) {
                                    showToast('Informe um percentual entre 0 e 999,99.', 'error')
                                    event.currentTarget.value = String(booking.overtime_pct ?? 0)
                                    return
                                  }
                                  if (next !== Number(booking.overtime_pct ?? 0)) {
                                    void saveBookingPatch(booking.id, { overtime_pct: next })
                                  }
                                }}
                              />
                            </Field>
```

- [ ] **Step 7: Atualizar os textos que citam o modelo antigo**

- No card da operação: `"OS, overtime por depot e serviços extras dos vazios embarcados."` → `"OS da escala, overtime importado e serviços por quantidade dos vazios embarcados."`
- No mesmo card, o texto do estado vazio: `"Selecione a viagem para lançar OS, overtime por depot e serviços extras da escala."` → `"Selecione a viagem para lançar a OS e as quantidades de serviço da escala."`
- No aviso de "Salvando...": trocar `savingKey?.startsWith('overtime:') || savingKey?.startsWith('reorg:')` por `savingKey?.startsWith('qty:')`.
- No modal de importação: `"OT Handling / OT Transporte e serviços"` → `"Overtime (%)"`.
- Na aba de custos: `"Valores calculados por container a partir do Cadastro de Depot"` continua correto — não mexer.

- [ ] **Step 8: Verificar**

```bash
npm run typecheck
npm run lint
```

Esperado: ambos limpos. Se sobrar erro de import não usado (`Boxes`, `Truck`, `Clock3`, `EmptyState`), remova apenas os imports que as suas próprias edições deixaram órfãos.

- [ ] **Step 9: Commit**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "feat(vazios): restaurar operacao, paginacao e edicao inline no Vazios EXP"
```

---

## Task 7: Corrigir a apresentação do serviço extra no ADR

Em `VoyageAgencyReportTab.tsx`, o painel "Serviço extra" usa `service.depot_service_id` como rótulo — um UUID cru num documento assinado. E logo acima há um `as unknown as { overtime?: … }` apontando para `vazios_export_overtime_depots`, tabela que a migration 234 dropou: código morto que sempre renderiza vazio.

**Files:**
- Modify: `src/services/agencyDepartureReport.ts`
- Modify: `src/components/voyages/VoyageAgencyReportTab.tsx`

- [ ] **Step 1: Trazer o nome do serviço no select**

Em `getAgencyReportDerivedData`, trocar:

```ts
      .select('*, service_qty:vazios_operation_service_qty(depot_service_id, qty)')
```

por:

```ts
      .select('*, service_qty:vazios_operation_service_qty(depot_service_id, qty, service:depot_services(name))')
```

e o cast correspondente:

```ts
  const operation = operationRes.data as (VaziosExportOperation & { service_qty: Array<{ depot_service_id: string; qty: number; service: { name: string } | null }> }) | null
```

- [ ] **Step 2: Ajustar o mesmo select em `getVaziosExportOperation`**

Em `src/services/vaziosExportOperations.ts`, aplicar a mesma mudança de `select` e de tipo de retorno, para que as duas telas leiam a mesma forma:

```ts
export async function getVaziosExportOperation(voyageId: number, embarkPort: string) {
  const { data, error } = await supabase.from('vazios_export_operations')
    .select('*, service_qty:vazios_operation_service_qty(depot_service_id, qty, service:depot_services(name))')
    .eq('voyage_id', voyageId).eq('embark_port', embarkPort).maybeSingle()
  if (error) throw error
  return data as (VaziosExportOperation & { service_qty: Array<{ depot_service_id: string; qty: number; service: { name: string } | null }> }) | null
}
```

- [ ] **Step 3: Corrigir o painel do ADR**

Substituir o painel de overtime (removendo o cast morto) e o de serviço extra:

```tsx
              <MetricPanel title="Overtime"><Info label="Containers com overtime" value={String(bookings.filter((booking) => Number(booking.overtime_pct ?? 0) > 0).length)} /></MetricPanel>
```

```tsx
            <MetricPanel title="Serviço extra">{data?.operation?.service_qty?.length ? data.operation.service_qty.map((service) => <Info key={service.depot_service_id} label={service.service?.name ?? 'Serviço removido'} value={String(service.qty)} />) : <Info label="Registros" value="0" />}</MetricPanel>
```

- [ ] **Step 4: Verificar**

```bash
npm run typecheck
npx vitest run src/services/__tests__
```

Esperado: typecheck limpo, testes de services passando.

- [ ] **Step 5: Commit**

```bash
git add src/services/agencyDepartureReport.ts src/services/vaziosExportOperations.ts src/components/voyages/VoyageAgencyReportTab.tsx
git commit -m "fix(adr): exibir nome do servico extra e remover leitura de tabela dropada"
```

---

## Task 8: Restaurar a cobertura do ADR e dos gates RBAC

A PR #424 apagou 625 linhas de `VoyageAgencyReportTab.test.tsx` (~25 testes: sign-off departamental, reabertura com justificativa, fechamento com os 3 departamentos, histórico de eventos, permissões de admin) e 311 linhas de `EquipmentPermissionGates.test.tsx` (gates RBAC de Veículos, Granito e Vazios IMP). Nada disso mudou de comportamento nesta PR — só a fatia de vazios EXP mudou. Restaure e adapte só o que o modelo novo tocou.

**Files:**
- Modify: `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`
- Modify: `src/pages/__tests__/EquipmentPermissionGates.test.tsx`

- [ ] **Step 1: Restaurar os dois arquivos**

```bash
git show 1c3c167^:src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx > src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx
git show 1c3c167^:src/pages/__tests__/EquipmentPermissionGates.test.tsx > src/pages/__tests__/EquipmentPermissionGates.test.tsx
npx vitest run src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx src/pages/__tests__/EquipmentPermissionGates.test.tsx
```

Esperado: FAIL. Anote quais testes falham — só eles devem ser adaptados.

Antes de editar, descubra os nomes reais dos helpers e mocks de cada arquivo (eles são citados nos passos seguintes de forma genérica):

```bash
grep -n "^function \|^const mocks\|render(" src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx | head -20
grep -n "^function \|^const mocks\|render(" src/pages/__tests__/EquipmentPermissionGates.test.tsx | head -20
```

- [ ] **Step 2: Adaptar `VoyageAgencyReportTab.test.tsx`**

Aplicar exatamente estas adaptações (as demais linhas ficam como estão):

1. Em toda fixture, trocar `operation: { os_number: …, reorg: [], overtime: [] }` por `operation: { os_number: …, service_qty: [] }`.
2. Nas fixtures de booking, trocar `overtime_handling: false, overtime_transport: false` por `overtime_pct: 0`.
3. Substituir o teste `'exibe o percentual de overtime por depot da operação derivada, na fase Operação de pátio'` por um que reflita o modelo novo:

```tsx
it('conta os containers com overtime na fase Operação de pátio', () => {
  renderTab({
    vaziosExp: [
      { container_type: '40HC', depot: 'VBR', overtime_pct: 25 },
      { container_type: '40HC', depot: 'VBR', overtime_pct: 0 },
    ],
    operation: { os_number: null, service_qty: [] },
  })
  expect(screen.getByText('Containers com overtime')).toBeTruthy()
  expect(screen.getByText('1')).toBeTruthy()
})
```

Ajuste o helper de render (`renderTab` ou equivalente) ao nome que o arquivo restaurado realmente usa — não invente um novo.

4. Adicionar um teste para o rótulo do serviço extra (Task 7):

```tsx
it('exibe o serviço extra pelo nome, não pelo id', () => {
  renderTab({
    operation: { os_number: null, service_qty: [{ depot_service_id: 's1', qty: 3, service: { name: 'Bundle Composition' } }] },
  })
  expect(screen.getByText('Bundle Composition')).toBeTruthy()
})
```

- [ ] **Step 3: Adaptar `EquipmentPermissionGates.test.tsx`**

1. No mock de `../../services/vaziosExportOperations`, remover `upsertOvertimeDepot`, `upsertReorgService` e `listActiveReorgRates`; adicionar `upsertOperationServiceQty: mocks.upsertOperationServiceQty` e declarar `upsertOperationServiceQty: vi.fn(() => Promise.resolve())` no objeto `mocks`.
2. Remover o branch `if (queryKey[0] === 'vazios-reorg-rates')` do mock de `useQuery` e o estado `mocks.reorgRates` (declaração, reset em `beforeEach` e o teste que o populava).
3. No mock de `../../services/depots`, trocar `resolveCurrentDepotTariff` por `listDepots: vi.fn(async () => [{ id: 'd1', code: 'VBR', name: 'VBR', pol_port: null, free_time_days: 2, active: true }])` e manter `listCurrentDepotServices`, agora devolvendo `[{ id: 's1', depot_id: 'd1', name: 'Bundle Composition', calc_type: 'quantidade', rate_brl: 30, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null }]`.
4. Na fixture de booking, trocar `bundle: false, transporte: true, overtime_handling: true, overtime_transport: false` por `overtime_pct: 25`.
5. Substituir os dois testes que usavam `getByLabelText('Percentual de overtime do depot VBR')` por:

```tsx
  it('exibe a quantidade por serviço e salva criando a operação', async () => {
    render(<Page />)
    const input = await screen.findByLabelText('Bundle Composition quantidade')
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)
    await waitFor(() => expect(mocks.upsertOperationServiceQty).toHaveBeenCalled())
    expect(mocks.upsertOperationServiceQty.mock.calls[0][0]).toMatchObject({ depotServiceId: 's1', qty: 3 })
  })

  it('mantém a quantidade somente leitura sem vazios_edit', async () => {
    mocks.can = () => false
    render(<Page />)
    const input = await screen.findByLabelText('Bundle Composition quantidade')
    expect((input as HTMLInputElement).readOnly).toBe(true)
  })
```

Adapte `<Page />` e `mocks.can` aos nomes que o arquivo restaurado realmente usa.

6. Manter intactos os `describe` de `'controles de Veiculos'` e `'imports fora do escopo de Equipamentos'` — eles não têm relação com esta mudança e são o principal motivo desta task.

- [ ] **Step 4: Rodar até passar**

```bash
npx vitest run src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx src/pages/__tests__/EquipmentPermissionGates.test.tsx
```

Esperado: PASS, com pelo menos 24 testes em `VoyageAgencyReportTab` e 13 em `EquipmentPermissionGates`. Se algum teste restaurado só passar depois de mudar o código de produção, **pare e reporte** — pode ser regressão real da PR #424 ainda não coberta por este plano.

- [ ] **Step 5: Commit**

```bash
git add src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx src/pages/__tests__/EquipmentPermissionGates.test.tsx
git commit -m "test: restaurar cobertura do ADR e dos gates RBAC removida na PR 424"
```

---

## Task 9: Restaurar a cobertura do parser

A PR #424 removeu os casos `'dedupe container repetido na planilha, mantendo a ultima ocorrencia'` e `'planilha antiga (sem colunas novas) continua importando'`. Dedupe e compatibilidade retroativa continuam sendo comportamento do parser.

**Files:**
- Modify: `src/services/__tests__/vaziosImportAdrColumns.test.ts`
- Modify: `src/services/vaziosImport.ts`

- [ ] **Step 1: Ver os casos antigos**

```bash
git show 1c3c167^:src/services/__tests__/vaziosImportAdrColumns.test.ts
```

Use os dois testes citados como base; a estrutura de montagem da planilha (helper que gera o buffer XLSX) já está no arquivo atual.

- [ ] **Step 2: Acrescentar os testes ao arquivo atual**

Adicionar, dentro do `describe('parser de vazios — novo contrato')`:

```ts
  it('dedupe container repetido na planilha, mantendo a última ocorrência', async () => {
    const buffer = buildSheet([
      { Booking: 'B1', Container: 'ABCD1234567', Depot: 'VBR' },
      { Booking: 'B2', Container: 'ABCD1234567', Depot: 'VIX' },
    ])
    const parsed = await parseVaziosManifestBuffer(buffer)
    expect(parsed.bookings).toHaveLength(1)
    expect(parsed.bookings[0].booking_number).toBe('B2')
    expect(parsed.bookings[0].depot).toBe('VIX')
  })

  it('planilha antiga (sem coluna de overtime) continua importando com 0', async () => {
    const buffer = buildSheet([{ Booking: 'B1', Container: 'ABCD1234567', Depot: 'VBR' }])
    const parsed = await parseVaziosManifestBuffer(buffer)
    expect(parsed.bookings).toHaveLength(1)
    expect(parsed.bookings[0].overtime_pct).toBe(0)
  })
```

`buildSheet` é o helper já existente no arquivo — se o nome for outro, use o do arquivo. Não crie um helper novo.

- [ ] **Step 3: Rodar**

```bash
npx vitest run src/services/__tests__/vaziosImportAdrColumns.test.ts
```

Esperado: PASS. Se `overtime_pct` vier `undefined` em vez de `0`, siga para o Step 4; caso contrário, pule para o Step 5.

- [ ] **Step 4: Limpar o `parsePercent`**

O segundo parâmetro (`flag`) virou vestigial — sempre chega `undefined`. Em `src/services/vaziosImport.ts`, trocar:

```ts
function parsePercent(value: unknown, flag: unknown): number { const parsed = Number(String(value ?? '').replace(',', '.').replace('%', '').trim()); return Number.isFinite(parsed) && parsed >= 0 ? parsed : (flag !== undefined && parseBool(flag) ? 100 : 0) }
```

por:

```ts
function parsePercent(value: unknown): number { const parsed = Number(String(value ?? '').replace(',', '.').replace('%', '').trim()); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 }
```

e a chamada `overtime_pct: parsePercent(mapped.overtime_pct, undefined),` por `overtime_pct: parsePercent(mapped.overtime_pct),`.

- [ ] **Step 5: Verificar**

```bash
npx vitest run src/services/__tests__/vaziosImportAdrColumns.test.ts
npm run typecheck
```

Esperado: PASS e typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add src/services/__tests__/vaziosImportAdrColumns.test.ts src/services/vaziosImport.ts
git commit -m "test(vazios): restaurar dedupe e compatibilidade retroativa do parser"
```

---

## Task 10: Índice do FK da tabela de quantidades

`vazios_operation_service_qty` tem PK `(operation_id, depot_service_id)`, que não indexa `depot_service_id` isolado. Toda exclusão de serviço em `depot_services` faz varredura para resolver o `ON DELETE CASCADE`.

**Files:**
- Create: `supabase/migrations/237_operation_service_qty_index.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- A PK (operation_id, depot_service_id) não indexa depot_service_id isolado; o
-- ON DELETE CASCADE de depot_services faz varredura sem este índice.

CREATE INDEX IF NOT EXISTS idx_vazios_operation_service_qty_service
  ON public.vazios_operation_service_qty (depot_service_id);
```

- [ ] **Step 2: Verificar**

```bash
ls supabase/migrations/237_operation_service_qty_index.sql
```

Esperado: o arquivo existe. Não há teste dedicado — é DDL de uma linha, sem lógica.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/237_operation_service_qty_index.sql
git commit -m "perf(vazios): indexar depot_service_id em vazios_operation_service_qty"
```

---

## Task 11: Documentação viva e fechamento

**Files:**
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/plans/README.md`
- Move: `docs/plans/2026-07-24-correcoes-pr-424-cadastro-depot.md` → `docs/archive/plans/`

- [ ] **Step 1: Atualizar `docs/RASTREABILIDADE.md`**

Na linha de `/embarquevazios`, atualizar a coluna de campos por container para refletir o modelo atual — trocar a menção a `overtime` (dois tipos) por `overtime_pct` e citar as migrations `234`–`237`. Na linha de `/embarquevazios/depots`, citar `migrations 234–237`.

- [ ] **Step 2: Registrar no `docs/CHANGELOG.md`**

Adicionar uma entrada descrevendo: reparo de encoding do ADR, correção do `calc_type` de `visual_check`, filtro de vigência no motor de custo, restauração do fluxo operacional de Vazios EXP e da cobertura de testes.

- [ ] **Step 3: Rodar o gate completo**

```bash
npm run docs:check
npm run lint
npm run typecheck
npm test
npm run build
```

Todos precisam passar. Se `npm test` falhar em algum arquivo que este plano não tocou, **pare e reporte** antes de seguir.

- [ ] **Step 4: Arquivar o plano**

```bash
git mv docs/plans/2026-07-24-correcoes-pr-424-cadastro-depot.md docs/archive/plans/
```

Remover a linha correspondente da tabela "Planos ativos" em `docs/plans/README.md`.

- [ ] **Step 5: Rodar `docs:check` de novo e commitar**

```bash
npm run docs:check
git add docs/
git commit -m "docs: registrar correcoes da PR 424 e arquivar o plano"
```

- [ ] **Step 6: Abrir a PR**

```bash
git push -u origin fix/pr-424-cadastro-depot
gh pr create --base main --title "fix: correcoes da PR #424 (Cadastro de Depot por tipo de calculo)" --body "$(cat <<'EOF'
## O que muda

Correções dos defeitos introduzidos pela #424, sem reverter o modelo da ADR 0032.

- **Encoding:** repara 22 linhas de mojibake em `VoyageAgencyReportTab.tsx` (inclusive um `aria-label`) e adiciona guarda automatizada.
- **Cobrança:** migration `236` reclassifica `visual_check` como serviço de Quantidade — o backfill da `234` passou a cobrá-lo em todo container do depot.
- **Motor de custo:** `computeContainerCost`/`computeOperationTotals` passam a filtrar `active` e vigência.
- **ADR:** falha ao carregar depots volta a propagar em vez de exibir R$ 0,00; serviço extra é exibido pelo nome, não pelo UUID.
- **Cadastro de Depot:** "Editar" agora atualiza (antes duplicava), o formulário espelha o depot selecionado, exclusões pedem confirmação e falhas mostram toast.
- **Vazios EXP:** restaura paginação, edição inline por container, campo de OS, deep-link `?voyage=` e filtros na URL; sem isso não havia caminho no app para criar a operação, e as quantidades por serviço eram inalcançáveis.
- **Testes:** restaura ~25 testes do ADR e os gates RBAC de Equipamentos removidos fora de escopo, além do dedupe e da compatibilidade retroativa do parser.
- **Perf:** índice em `vazios_operation_service_qty(depot_service_id)`.

## Verificação

`npm run docs:check`, `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` — todos verdes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Acompanhar o CI**

Ficar inscrito só até o CI terminar para o commit enviado: corrigir falhas e empurrar; quando tudo estiver verde, reportar e parar. Não agendar checagens recorrentes (regra do `CLAUDE.md`).

---

## Fora de escopo (registrado, não executado)

- **Regenerar `src/types/database.ts`.** O arquivo é protegido pelo hook do repositório e foi editado à mão pela #424, em estilo diferente do gerado. Regenerar exige autorização explícita e uma rodada de `generate_typescript_types` contra o projeto Supabase — trabalho separado.
- **Migration de reversão da `234`.** A `234` dropou `depot_tariffs`, `vazios_reorg_rates`, `vazios_reorg_services` e `vazios_export_overtime_depots` com `CASCADE` e sem backfill de `free_time_days`. Se houvesse dado em produção, ele já se foi; escrever um `down` agora não recupera nada. Confirme com o dono do produto se a premissa de "sem dados legados" se sustentou.
- **`subject_to_overtime` default `FALSE`.** Depois da `234`, todo overtime calcula 0 até alguém marcar os serviços depot a depot. É o design correto, mas precisa de aviso operacional a quem opera a tela.
