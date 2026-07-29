# Aprofundamento arquitetural (revisão de 25 jul 2026) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar três módulos rasos em módulos profundos — um seam de invalidação de cache com interface de eventos de domínio, um leitor de recusa do banco em `lib/errors.ts`, e a conclusão dos dois seams de importação de planilha já abertos pela metade — além de cobrir com teste os dois serviços grandes que hoje não têm nenhum.

**Architecture:** Nenhuma regra de negócio muda de lugar. Cada mudança substitui uma decisão repetida por uma decisão única: `cacheEffects.ts` passa a ser dono da pergunta "o que envelheceu quando X aconteceu" (hoje respondida 217 vezes em 39 arquivos, com divergências comprovadas dentro do mesmo arquivo); `classifyDbError` em `lib/errors.ts` passa a ser dono da pergunta "o que o operador vê quando o RLS nega" (hoje respondida por 7 cópias, uma delas já divergente); `importCore.ts` passa a ser o único leitor de planilha, com as opções do `xlsx` viradas em opção nomeada em vez de deriva silenciosa. Adoção incremental — cada task deixa o repositório verde.

**Tech Stack:** React 18 + TypeScript, TanStack React Query v5, Supabase (Postgres + RLS), `@e965/xlsx`, Vitest + Testing Library (jsdom), Vite, ESLint.

---

## Base de decisão

Este plano executa os candidatos **#01, #02 e #03** da revisão de arquitetura de 25 jul 2026, mais o achado de cobertura registrado à parte no mesmo relatório. Antes de escrever o plano, **todas as métricas do relatório foram reconferidas contra o repositório em `eab066c`** e confirmadas:

| Afirmação do relatório | Verificado em `eab066c` |
|---|---|
| 661 arquivos `.ts/.tsx` em `src/` | 661 ✅ |
| 217 invalidações com chave literal em 39 arquivos | 217 / 39 ✅ |
| 7 cópias de `isPermissionError`, 1 divergente | 7, e só `reports.ts` trata `PGRST301` ✅ |
| `223 × if (error) throw error` | 227 (cresceu 4 desde 25 jul) ✅ |
| `voyageSummaries.ts` — 923 linhas, 28 exports | 923 linhas, 29 exports ✅ |
| `importCore` usado por 3 de 10 parsers | 3 (`vaziosImport`, `vaziosImportacaoImport`, `graniteImport`) ✅ |
| `FileImportModal` usado por 1 de 7 | 1 (`VoyageImportActions`) ✅ |
| Deriva de opções do `xlsx` entre parsers | ✅ — 5 combinações distintas de `cellText`/`cellDates`/`raw` |
| `Object.entries(headerMap).find(...)` copiado em 5 arquivos | 5 ✅ (`ceMercante`, `containerDates`, `vehicle`, `breakbulk`, `customerBase`) |
| `charges/` e `lineup.ts` sem arquivo de teste | `src/services/charges/` tem **zero** testes; `lineup.ts` tem 2 testes de função pura (`lineUpScheduleDates`, `compareDateValues`) mas nenhum de `fetchLineUpSnapshot` (427 linhas) ✅ |
| 6 páginas com máquina de estado de importação à mão | **7** — o relatório não contou `src/pages/Clientes.tsx` |

**Uma correção ao relatório.** O candidato #03b afirma que "um bom módulo profundo está sendo desperdiçado **por um parâmetro**" — que bastaria trocar `voyageLabel` por um `subtitle` opcional para as 6 páginas adotarem `FileImportModal`. Isso está incompleto. As 6 páginas renderizam um `VoyageCombobox` **dentro** do modal, antes do input de arquivo: o operador escolhe a Viagem de destino e só então anexa o arquivo. `FileImportModal` hoje vai direto ao input de arquivo — ele assume que a Viagem já é conhecida, que é exatamente a situação do seu único usuário (`VoyageImportActions`, chamado de dentro da página de uma Viagem). Remover `voyageLabel` é necessário, mas **não suficiente**: o módulo também precisa de um slot de pré-requisito que trave o input de arquivo até estar satisfeito. A Task 14 faz as duas coisas.

**Fora de escopo deste plano, por decisão consciente:**

- **Candidato #04 (`voyageSummaries`)** — o próprio relatório o marca *Worth exploring* e admite que "o ganho é de clareza, não de bug conhecido", numa refatoração que mexe na tela mais usada do sistema (`/viagens`). Fica para depois do #01: quando as invalidações da Viagem já falarem de Viagem, o custo dessa refatoração cai.
- **Candidato #05 (projeção da Escala pelos módulos de origem)** — o acoplamento é real e confirmado (8 `.from()` de tabelas alheias em `agencyDepartureReport.ts:301–332`), mas mexe no ADR, que tem snapshot congelado no fechamento (ADR 0027) e sign-off departamental (ADRs 0028/0029). Merece ADR próprio antes de código; este plano não o abre.

---

## Leitura obrigatória antes de começar

Leia, nesta ordem:

1. [`../../CLAUDE.md`](../../CLAUDE.md) — regras de mudança cirúrgica, comentários `ponytail:`, contrato de documentação e gates de verificação.
2. [`../../CONTEXT.md`](../../CONTEXT.md) — seções *Próxima Escala* (L31), *Estado de Conciliação da Viagem* (L385) e *Dupla proteção RBAC* (L849).
3. [`../CONVENCOES.md`](../CONVENCOES.md) — "Ciclo de vida de planos e specs".
4. [`../../skills/react-query-pattern/SKILL.md`](../../skills/react-query-pattern/SKILL.md) — o playbook de cache que a Task 6 altera.
5. [`../../skills/import-parser/SKILL.md`](../../skills/import-parser/SKILL.md) — o playbook de parsers que a Task 16 altera.

Glossário mínimo:

- **Seam** — onde uma interface mora: o ponto em que o comportamento pode mudar sem editar no lugar.
- **Adapter** — algo concreto que satisfaz a interface num seam. Um adapter = seam hipotético; dois = seam real.
- **Escala** — parada da Viagem num porto. Identidade = (viagem, porto).
- **ADR** — neste plano sempre *Agency Departure Report* (o relatório), nunca *Architecture Decision Record*.

## Setup

```bash
cd /home/user/transhippingdesk
npm ci
git fetch origin main
git checkout -B claude/project-report-review-5g89go origin/main
```

Comandos de verificação usados o tempo todo:

```bash
npx vitest run <caminho-do-teste>   # teste isolado, o mais usado
npm run lint
npm run typecheck
npm test
npm run build
npm run docs:check
```

**Regra de commit:** cada task termina com um commit. Se a task deixa `npm test` vermelho, ela não terminou.

---

# Fase 1 — Seam de invalidação de cache (candidato #01)

**O problema, em uma frase:** não existe seam entre "um evento de domínio aconteceu" e "qual estado remoto ficou obsoleto" — e a prova é que `src/pages/Viagens.tsx` carrega **seis** listas de invalidação sobrepostas para mutações da mesma Viagem, cada uma esquecendo uma chave diferente:

| Bloco em `Viagens.tsx` | Chaves invalidadas hoje | O que falta |
|---|---|---|
| L159 excluir viagem | `voyages` `voyage-options` `voyage-pod-schedules` `bls` `containers` `dashboard` `lineup-tv-v3` `lineup-tv-display-v2` | — (é o superconjunto) |
| L194 cancelar viagem | `voyages` `lineup-tv-v3` `lineup-tv-display-v2` | `dashboard`, `bls`, `voyage-options` |
| L391 escala de exportação | `voyage-export-schedules` `lineup-tv-v3` `lineup-tv-display-v2` | `voyage-timeline` |
| L429 escala POD | `voyage-pod-schedules` `voyage-timeline` `lineup-tv-v3` `lineup-tv-display-v2` | — |
| L468 rota da viagem | `voyage-pol-schedules` `voyage-pod-schedules` `voyage-route-ce-masters` `voyage-timeline` `voyages` | `lineup-tv-v3`, `lineup-tv-display-v2` |
| L506 datas da escala | `voyage-pod-schedules` `voyage-timeline` `lineup-tv-v3` `lineup-tv-display-v2` | — |

**Princípio da convergência:** cada evento passa a invalidar o **superconjunto** das listas que hoje o representam. Sobre-invalidar custa um refetch; sub-invalidar mostra dado velho ao operador. Essa assimetria é a razão de o superconjunto ser a resposta certa, e é exatamente o que `reviewCaches.ts` já documenta ter aprendido na marra.

---

### Task 1: `cacheEffects` — módulo e o primeiro evento de domínio

**Files:**
- Create: `src/services/cacheEffects.ts`
- Test: `src/services/__tests__/cacheEffects.test.ts`

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/services/__tests__/cacheEffects.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { afterViagemAlterada } from '../cacheEffects'

function fakeQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  return {
    client: { invalidateQueries },
    keys: () => invalidateQueries.mock.calls.map(([input]) => JSON.stringify(input.queryKey)),
  }
}

describe('afterViagemAlterada', () => {
  it('invalida o superconjunto que a exclusao de viagem ja invalidava', async () => {
    const { client, keys } = fakeQueryClient()

    await afterViagemAlterada(client)

    // Superconjunto historico de Viagens.tsx L159 (exclusao) — o bloco mais completo.
    expect(keys()).toEqual(
      expect.arrayContaining(
        [
          ['voyages'],
          ['voyage-options'],
          ['voyage-pod-schedules'],
          ['bls'],
          ['containers'],
          ['dashboard'],
          ['lineup-tv-v3'],
          ['lineup-tv-display-v2'],
        ].map((key) => JSON.stringify(key)),
      ),
    )
  })

  it('nao repete a mesma chave quando chamado sem viagem especifica', async () => {
    const { client, keys } = fakeQueryClient()

    await afterViagemAlterada(client)

    expect(new Set(keys()).size).toBe(keys().length)
  })

  it('acrescenta a linha do tempo da viagem com o id em STRING', async () => {
    const { client, keys } = fakeQueryClient()

    await afterViagemAlterada(client, { voyageId: 24 })

    // `useVoyageTimeline` guarda a query em ['voyage-timeline', String(voyageId)]
    // e o React Query compara os elementos da chave por tipo: 24 !== '24'.
    // Invalidar com numero nao casaria com query nenhuma.
    expect(keys()).toContain(JSON.stringify(['voyage-timeline', '24']))
    expect(keys()).not.toContain(JSON.stringify(['voyage-timeline', 24]))
  })
})
```

- [ ] **Step 2: Rode o teste para ver falhar**

```bash
npx vitest run src/services/__tests__/cacheEffects.test.ts
```

Esperado: FAIL — `Failed to resolve import "../cacheEffects"`.

- [ ] **Step 3: Implemente o módulo**

Crie `src/services/cacheEffects.ts`:

```ts
/**
 * Seam entre "um evento de dominio aconteceu" e "qual estado remoto ficou
 * obsoleto". Os chamadores declaram o que fizeram; este modulo decide o que
 * envelheceu.
 *
 * Existe porque a licao ja foi aprendida duas vezes e nunca generalizada:
 * `components/review/reviewCaches.ts` e `services/baplieInvalidation.ts` sao
 * dois adapters do mesmo seam — dois adapters significam que o seam e real.
 * Fora deles, 217 invalidacoes com chave literal espalhadas por 39 arquivos
 * divergiam entre si dentro do mesmo arquivo (Viagens.tsx carregava seis
 * listas sobrepostas para mutacoes da mesma Viagem).
 *
 * Regra de convergencia: cada evento invalida o SUPERCONJUNTO das listas que o
 * representavam. Sobre-invalidar custa um refetch; sub-invalidar mostra dado
 * velho ao operador.
 */

/** Contrato minimo do QueryClient — permite testar contra um duble simples. */
export type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => Promise<unknown>
}

/** Telas de Line-Up (TV): derivadas de qualquer mudanca de Viagem ou Escala. */
const LINEUP_KEYS: readonly (readonly unknown[])[] = [['lineup-tv-v3'], ['lineup-tv-display-v2']]

/**
 * A Linha do Tempo e keyed por id em STRING (`useVoyageTimeline`:
 * `['voyage-timeline', String(voyageId)]`). O React Query compara elemento a
 * elemento por tipo — invalidar com `24` nao casa com a query guardada em
 * `'24'`. Normalizar aqui e o motivo de esta funcao existir: e o unico ponto
 * do app que monta essa chave para invalidacao.
 */
function voyageTimelineKey(voyageId: number | string): readonly unknown[] {
  return ['voyage-timeline', String(voyageId)]
}

async function invalidate(
  queryClient: QueryInvalidator,
  keys: readonly (readonly unknown[])[],
): Promise<void> {
  const seen = new Set<string>()
  const unique = keys.filter((key) => {
    const id = JSON.stringify(key)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  await Promise.all(unique.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/**
 * A Viagem em si mudou: criacao, edicao, cancelamento ou exclusao.
 * Passe `voyageId` quando a Viagem afetada e conhecida — a Linha do Tempo dela
 * so pode ser invalidada com identidade.
 */
export async function afterViagemAlterada(
  queryClient: QueryInvalidator,
  options: { voyageId?: number | string } = {},
): Promise<void> {
  await invalidate(queryClient, [
    ['voyages'],
    ['voyage-options'],
    ['voyage-pod-schedules'],
    ['bls'],
    ['containers'],
    ['dashboard'],
    ...(options.voyageId === undefined ? [] : [voyageTimelineKey(options.voyageId)]),
    ...LINEUP_KEYS,
  ])
}
```

- [ ] **Step 4: Rode o teste para ver passar**

```bash
npx vitest run src/services/__tests__/cacheEffects.test.ts
```

Esperado: PASS — 3 testes.

- [ ] **Step 5: Commit**

```bash
git add src/services/cacheEffects.ts src/services/__tests__/cacheEffects.test.ts
git commit -m "feat(cache): abrir seam de invalidacao com evento afterViagemAlterada"
```

---

### Task 2: Eventos de Escala e de Rota

**Files:**
- Modify: `src/services/cacheEffects.ts`
- Test: `src/services/__tests__/cacheEffects.test.ts`

- [ ] **Step 1: Escreva os testes que falham**

Acrescente ao final de `src/services/__tests__/cacheEffects.test.ts` (mantenha o `import` do topo e adicione os nomes novos a ele):

```ts
describe('afterEscalaAlterada', () => {
  it('invalida todas as agendas, a linha do tempo e o line-up', async () => {
    const { client, keys } = fakeQueryClient()

    await afterEscalaAlterada(client, { voyageId: 24 })

    expect(keys()).toEqual(
      expect.arrayContaining(
        [
          ['voyage-pod-schedules'],
          ['voyage-pol-schedules'],
          ['voyage-export-schedules'],
          ['voyage-timeline', '24'],
          ['voyages'],
          ['lineup-tv-v3'],
          ['lineup-tv-display-v2'],
        ].map((key) => JSON.stringify(key)),
      ),
    )
  })

  it('nao esquece a linha do tempo — o bug de Viagens.tsx L391', async () => {
    const { client, keys } = fakeQueryClient()

    await afterEscalaAlterada(client, { voyageId: 7 })

    expect(keys()).toContain(JSON.stringify(['voyage-timeline', '7']))
  })
})

describe('afterRotaAlterada', () => {
  it('invalida os CE Masters da rota e o line-up — o bug de Viagens.tsx L468', async () => {
    const { client, keys } = fakeQueryClient()

    await afterRotaAlterada(client, { voyageId: 24 })

    expect(keys()).toEqual(
      expect.arrayContaining(
        [
          ['voyage-route-ce-masters'],
          ['voyage-pol-schedules'],
          ['voyage-pod-schedules'],
          ['voyage-timeline', '24'],
          ['voyages'],
          ['lineup-tv-v3'],
          ['lineup-tv-display-v2'],
        ].map((key) => JSON.stringify(key)),
      ),
    )
  })
})
```

```ts
describe('afterManifestoImportado', () => {
  it('preserva as tres chaves que as telas de importacao ja invalidavam', async () => {
    const { client, keys } = fakeQueryClient()

    await afterManifestoImportado(client, { voyageId: 24 })

    // Superconjunto do que `CargaSolta.tsx` L192-196 invalidava: um manifesto
    // pode introduzir portos novos, dai `port-options`.
    expect(keys()).toEqual(
      expect.arrayContaining([['bls'], ['voyages'], ['port-options']].map((key) => JSON.stringify(key))),
    )
  })
})
```

E troque a primeira linha de import do arquivo por:

```ts
import {
  afterEscalaAlterada,
  afterManifestoImportado,
  afterRotaAlterada,
  afterViagemAlterada,
} from '../cacheEffects'
```

- [ ] **Step 2: Rode para ver falhar**

```bash
npx vitest run src/services/__tests__/cacheEffects.test.ts
```

Esperado: FAIL — `afterEscalaAlterada is not a function`.

- [ ] **Step 3: Implemente os dois eventos**

Acrescente ao final de `src/services/cacheEffects.ts`:

```ts
/** As agendas da Viagem — POD, POL e exportacao. Uma Escala mexe no conjunto. */
const SCHEDULE_KEYS: readonly (readonly unknown[])[] = [
  ['voyage-pod-schedules'],
  ['voyage-pol-schedules'],
  ['voyage-export-schedules'],
]

/**
 * Uma Escala (viagem, porto) foi criada, editada ou removida — inclui datas,
 * planejamento de exportacao e remocao de POD.
 *
 * Invalida as tres agendas juntas de proposito: a tela de Viagem mostra POD,
 * POL e exportacao lado a lado, e os blocos historicos divergiam justamente em
 * quais delas lembrar (L391 esquecia a Linha do Tempo).
 */
export async function afterEscalaAlterada(
  queryClient: QueryInvalidator,
  options: { voyageId: number | string },
): Promise<void> {
  await invalidate(queryClient, [
    ...SCHEDULE_KEYS,
    voyageTimelineKey(options.voyageId),
    ['voyages'],
    ...LINEUP_KEYS,
  ])
}

/**
 * A rota da Viagem mudou: CE Master do lote ou da rota (POL, POD).
 * O Line-Up exibe o status de CE, entao entra aqui — L468 o esquecia.
 */
export async function afterRotaAlterada(
  queryClient: QueryInvalidator,
  options: { voyageId: number | string },
): Promise<void> {
  await invalidate(queryClient, [
    ['voyage-route-ce-masters'],
    ['voyage-pol-schedules'],
    ['voyage-pod-schedules'],
    voyageTimelineKey(options.voyageId),
    ['voyages'],
    ...LINEUP_KEYS,
  ])
}

/**
 * Um manifesto foi importado para a Viagem (carga solta, vazios de importacao,
 * veiculos, granito). Alem do que muda na Viagem, a importacao pode introduzir
 * portos novos — dai `port-options`, que as telas de filtro consomem.
 */
export async function afterManifestoImportado(
  queryClient: QueryInvalidator,
  options: { voyageId: number | string },
): Promise<void> {
  await invalidate(queryClient, [
    ['bls'],
    ['containers'],
    ['voyages'],
    ['port-options'],
    voyageTimelineKey(options.voyageId),
    ...LINEUP_KEYS,
  ])
}
```

- [ ] **Step 4: Rode para ver passar**

```bash
npx vitest run src/services/__tests__/cacheEffects.test.ts
```

Esperado: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add src/services/cacheEffects.ts src/services/__tests__/cacheEffects.test.ts
git commit -m "feat(cache): adicionar eventos afterEscalaAlterada e afterRotaAlterada"
```

---

### Task 3: Migrar os seis blocos de `Viagens.tsx`

**Files:**
- Modify: `src/pages/Viagens.tsx` (blocos em L157–167, L192–197, L389–394, L427–433, L466–473, L504–510)

Esta é a task que paga o módulo: seis listas divergentes viram seis chamadas.

- [ ] **Step 1: Adicione o import**

Em `src/pages/Viagens.tsx`, junto aos outros imports de `../services`:

```ts
import { afterEscalaAlterada, afterRotaAlterada, afterViagemAlterada } from '../services/cacheEffects'
```

- [ ] **Step 2: Substitua o bloco de exclusão de viagem (L157–167)**

Troque:

```ts
      await deleteVoyage(deletingVoyageId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
```

por:

```ts
      await deleteVoyage(deletingVoyageId)
      await afterViagemAlterada(queryClient, { voyageId: deletingVoyageId })
```

- [ ] **Step 3: Substitua o bloco de cancelamento (L192–197)**

Troque:

```ts
      await cancelVoyage({ voyageId: cancellingVoyageId, reason: cancellationReason, changedBy: user.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
```

por:

```ts
      await cancelVoyage({ voyageId: cancellingVoyageId, reason: cancellationReason, changedBy: user.id })
      await afterViagemAlterada(queryClient, { voyageId: cancellingVoyageId })
```

- [ ] **Step 4: Substitua o bloco de escala de exportação (L389–394)**

Troque:

```ts
            await saveVoyageExportSchedule({ voyageId, pol, hasGranite, containersQty, movementsQty, eta, etb, ceStatus, linked })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-export-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
            ])
```

por:

```ts
            await saveVoyageExportSchedule({ voyageId, pol, hasGranite, containersQty, movementsQty, eta, etb, ceStatus, linked })
            await afterEscalaAlterada(queryClient, { voyageId })
```

- [ ] **Step 5: Substitua os dois blocos de escala POD (L427–433 e L504–510)**

Nos dois lugares, troque:

```ts
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
            ])
```

por:

```ts
            await afterEscalaAlterada(queryClient, { voyageId })
```

- [ ] **Step 6: Substitua o bloco de rota (L466–473)**

Troque:

```ts
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pol-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-route-ce-masters'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
            ])
```

por:

```ts
            await afterRotaAlterada(queryClient, { voyageId })
```

- [ ] **Step 7: Confirme que nenhuma invalidação literal sobrou**

As 27 invalidações literais do arquivo estavam todas nesses seis blocos (8 + 3 + 3 + 4 + 5 + 4 = 27). Depois dos steps 2–6 não deve sobrar nenhuma:

```bash
grep -c "invalidateQueries" src/pages/Viagens.tsx
```

Esperado: `0`. Se for maior que zero, rode `grep -n "invalidateQueries" src/pages/Viagens.tsx` e migre o bloco que escapou.

- [ ] **Step 8: Rode os testes e o typecheck**

```bash
npx vitest run src/pages/__tests__
npm run typecheck
```

Esperado: PASS e sem erros de tipo.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Viagens.tsx
git commit -m "refactor(viagens): trocar seis listas de invalidacao por eventos de dominio"
```

---

### Task 4: Migrar `VoyageVisaoTab`

**Files:**
- Modify: `src/components/voyages/VoyageVisaoTab.tsx` (bloco em L141–146 e o bloco equivalente de exclusão de POL)

- [ ] **Step 1: Adicione o import**

```ts
import { afterEscalaAlterada } from '../../services/cacheEffects'
```

- [ ] **Step 2: Substitua o bloco de exclusão de POD (L141–146)**

Troque:

```ts
      await deleteVoyagePodSchedule({ voyageId: voyage.id, pod: row.pod, changedBy: user.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
```

por:

```ts
      await deleteVoyagePodSchedule({ voyageId: voyage.id, pod: row.pod, changedBy: user.id })
      await afterEscalaAlterada(queryClient, { voyageId: voyage.id })
```

- [ ] **Step 3: Substitua o bloco de exclusão de POL (`handleDeleteExport`, L168–172)**

Troque:

```ts
      await deleteVoyageExportSchedule(schedule.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyage-export-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
```

por:

```ts
      await deleteVoyageExportSchedule(schedule.id)
      await afterEscalaAlterada(queryClient, { voyageId: voyage.id })
```

Confirme que sobrou zero:

```bash
grep -c "invalidateQueries" src/components/voyages/VoyageVisaoTab.tsx
```

Esperado: `0`.

- [ ] **Step 4: Rode os testes**

```bash
npx vitest run src/components/voyages
npm run typecheck
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/voyages/VoyageVisaoTab.tsx
git commit -m "refactor(viagens): VoyageVisaoTab passa a declarar Escala alterada"
```

---

### Task 5: Re-hospedar os dois adapters existentes no seam

`reviewCaches.ts` e `baplieInvalidation.ts` já são adapters certos deste seam. Eles não são reescritos — ganham um nome de evento em `cacheEffects`, para que exista **um único lugar** onde se pergunta "o que envelheceu quando X aconteceu".

**Files:**
- Modify: `src/services/cacheEffects.ts`
- Test: `src/services/__tests__/cacheEffects.test.ts`

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `src/services/__tests__/cacheEffects.test.ts`:

```ts
describe('afterBaplieImportado', () => {
  it('delega para o adapter historico do Baplie', async () => {
    const { client, keys } = fakeQueryClient()

    await afterBaplieImportado(client, { voyageId: '24' })

    expect(keys()).toEqual([
      ['baplie-reconciliation', '24'],
      ['bls'],
      ['bl-detail'],
      ['voyages'],
      ['voyage-timeline', '24'],
    ].map((key) => JSON.stringify(key)))
  })
})
```

E acrescente `afterBaplieImportado` ao import do topo do arquivo.

- [ ] **Step 2: Rode para ver falhar**

```bash
npx vitest run src/services/__tests__/cacheEffects.test.ts
```

Esperado: FAIL — `afterBaplieImportado is not a function`.

- [ ] **Step 3: Implemente a delegação**

Acrescente ao topo de `src/services/cacheEffects.ts`, junto aos imports:

```ts
import { invalidateBaplieDependentQueries } from './baplieInvalidation'
```

E ao final do arquivo:

```ts
/**
 * Um Baplie foi importado ou reconciliado.
 *
 * ponytail: delega para `baplieInvalidation.ts` em vez de absorve-lo. Teto
 * conhecido: enquanto os dois modulos existirem, um chamador ainda pode
 * importar o antigo direto e escapar do seam. Upgrade: mover o corpo para ca e
 * apagar `baplieInvalidation.ts` depois que os 4 chamadores atuais migrarem.
 */
export async function afterBaplieImportado(
  queryClient: QueryInvalidator,
  options: { voyageId: string },
): Promise<void> {
  await invalidateBaplieDependentQueries(queryClient, options.voyageId)
}
```

- [ ] **Step 4: Adicione o evento de B/L revisado**

Ainda em `src/services/cacheEffects.ts`, acrescente ao final:

```ts
/**
 * Um B/L saiu da fila de Revisao Operacional (correcao inline, vinculo em
 * lote, reavaliacao de grupo ou drawer).
 *
 * ponytail: mesmo teto de `afterBaplieImportado` — delega para
 * `components/review/reviewCaches.ts`, que ja e dono do escopo. Upgrade: mover
 * o corpo para ca quando os 6 chamadores da fila migrarem.
 */
export async function afterBlRevisado(
  queryClient: Parameters<typeof invalidateReviewQueueCaches>[0],
  scope: Parameters<typeof invalidateReviewQueueCaches>[1] = {},
): Promise<void> {
  await invalidateReviewQueueCaches(queryClient, scope)
}
```

E acrescente o import correspondente ao topo:

```ts
import { invalidateReviewQueueCaches } from '../components/review/reviewCaches'
```

- [ ] **Step 5: Rode para ver passar**

```bash
npx vitest run src/services/__tests__/cacheEffects.test.ts
npm run typecheck
```

Esperado: PASS — 7 testes, sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/services/cacheEffects.ts src/services/__tests__/cacheEffects.test.ts
git commit -m "feat(cache): re-hospedar Baplie e Revisao como eventos do seam"
```

---

### Task 6: Documentar o seam

**Files:**
- Modify: `skills/react-query-pattern/SKILL.md`
- Modify: `docs/RASTREABILIDADE.md` (linha de `/viagens`, L45)
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Atualize o playbook de React Query**

Em `skills/react-query-pattern/SKILL.md`, logo após a linha `Prefer \`src/services/queryKeys.ts\`.` (L54), acrescente:

```markdown
### Invalidação: declare o evento, não a chave

Para **ler** cache, use `queryKeys`. Para **invalidar** depois de uma mutação,
use `src/services/cacheEffects.ts` — a interface são eventos de domínio, não
chaves:

```ts
await afterViagemAlterada(queryClient, { voyageId })
await afterEscalaAlterada(queryClient, { voyageId })
await afterRotaAlterada(queryClient, { voyageId })
await afterBaplieImportado(queryClient, { voyageId })
await afterBlRevisado(queryClient, { blId })
```

Não escreva `invalidateQueries({ queryKey: ['voyages'] })` em página ou
componente. A lista de chaves de um evento mora em `cacheEffects.ts` e em
nenhum outro lugar; adicionar uma query nova é editar essa lista, não caçar
os call sites.

Se o evento que você precisa ainda não existe, **crie-o em `cacheEffects.ts`**
com um teste em `src/services/__tests__/cacheEffects.test.ts`. Nunca duplique
uma lista de chaves numa página.
```

- [ ] **Step 2: Atualize a rastreabilidade de `/viagens`**

Em `docs/RASTREABILIDADE.md` L45, troque o trecho `invalida \`queryKeys.voyages.*\`` por:

```
invalida via `cacheEffects` (`afterViagemAlterada`/`afterEscalaAlterada`/`afterRotaAlterada`)
```

- [ ] **Step 3: Registre o módulo na arquitetura**

Em `docs/ARCHITECTURE.md`, na seção que descreve `src/services/`, acrescente uma linha:

```markdown
- `cacheEffects.ts` — seam de invalidação de cache. Interface = eventos de
  domínio (`afterViagemAlterada`, `afterEscalaAlterada`, `afterRotaAlterada`,
  `afterBaplieImportado`, `afterBlRevisado`); o módulo é dono de quais query
  keys envelhecem em cada um. `reviewCaches.ts` e `baplieInvalidation.ts` são
  os dois adapters herdados.
```

- [ ] **Step 4: Rode o gate de documentação**

```bash
npm run docs:check
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add skills/react-query-pattern/SKILL.md docs/RASTREABILIDADE.md docs/ARCHITECTURE.md
git commit -m "docs: registrar o seam de invalidacao de cache"
```

---

# Fase 2 — Leitura da recusa do banco (candidato #02)

**O problema, em uma frase:** o `CONTEXT.md` (L849) diz que "a autoridade real está em RLS, RPCs e Edge Functions" — e nenhum módulo do frontend sabe ler a recusa delas. A classificação foi reimplementada sete vezes, quatro byte a byte idênticas, e a sétima já divergiu:

| Local | Forma | Cobre |
|---|---|---|
| `services/billing.ts:988` | função privada | `42501` + `permission denied` |
| `services/customerFicha.ts:75` | função privada (idêntica) | idem |
| `services/charges/chargeOperationsService.ts:599` | função privada (idêntica) | idem |
| `hooks/useCustomers.ts:221` | função privada (idêntica) | idem |
| `components/review/ReviewDrawer.tsx:123` | inline | idem |
| `components/voyages/VoyageVisaoTab.tsx:150` | inline | idem |
| `services/reports.ts:424` | função privada **divergente** | `42501` + **`PGRST301`** |

As seis primeiras tratam JWT expirado (`PGRST301`) como erro desconhecido e mostram ao operador o texto cru do PostgREST.

---

### Task 7: `classifyDbError` — a tabela

**Files:**
- Modify: `src/lib/errors.ts`
- Test: `src/lib/__tests__/errors.test.ts`

- [ ] **Step 1: Escreva os testes que falham**

Acrescente a `src/lib/__tests__/errors.test.ts`:

```ts
import { classifyDbError } from '../errors'

describe('classifyDbError', () => {
  it('classifica 42501 como recusa de permissao', () => {
    expect(classifyDbError({ code: '42501', message: 'permission denied for table bls' })).toEqual({
      kind: 'permissao',
      message: 'Sem permissao para esta acao. Solicite acesso administrativo.',
    })
  })

  it('preserva a mensagem escrita pelo banco quando ela nao e texto cru do PostgREST', () => {
    expect(classifyDbError({ code: '42501', message: 'Usuario sem permissao ativa.' })).toEqual({
      kind: 'permissao',
      message: 'Usuario sem permissao ativa.',
    })
  })

  it('classifica PGRST301 e 28000 como sessao expirada — o caso que 6 das 7 copias erravam', () => {
    expect(classifyDbError({ code: 'PGRST301' }).kind).toBe('sessao_expirada')
    expect(classifyDbError({ code: '28000' }).kind).toBe('sessao_expirada')
  })

  it('classifica violacao de unicidade como conflito', () => {
    expect(classifyDbError({ code: '23505' }).kind).toBe('conflito')
  })

  it('classifica P0429 como limite', () => {
    expect(classifyDbError({ code: 'P0429' }).kind).toBe('limite')
  })

  it('reconhece permission denied sem codigo, por substring', () => {
    expect(classifyDbError({ message: 'PERMISSION DENIED for relation invoices' }).kind).toBe('permissao')
  })

  it('nao vaza details nem hint do Postgres na mensagem de erro desconhecido', () => {
    const result = classifyDbError({
      code: 'XX000',
      message: 'internal error',
      details: 'Key (bl_id)=(ABC) is not present in table "bls".',
      hint: 'check policy bls_select_active_user',
    })

    expect(result.kind).toBe('desconhecido')
    expect(result.message).not.toContain('bls_select_active_user')
    expect(result.message).not.toContain('Key (bl_id)')
  })

  it('devolve desconhecido com mensagem generica para erro vazio', () => {
    expect(classifyDbError(null)).toEqual({ kind: 'desconhecido', message: 'Falha inesperada. Tente novamente.' })
  })

  it('aceita Error nativo', () => {
    expect(classifyDbError(new Error('Falha de rede.'))).toEqual({
      kind: 'desconhecido',
      message: 'Falha de rede.',
    })
  })
})
```

- [ ] **Step 2: Rode para ver falhar**

```bash
npx vitest run src/lib/__tests__/errors.test.ts
```

Esperado: FAIL — `classifyDbError is not exported`.

- [ ] **Step 3: Implemente**

Acrescente ao final de `src/lib/errors.ts`:

```ts
/**
 * Como o app entende uma recusa do banco. A `Dupla proteção RBAC`
 * (CONTEXT.md) diz que a autoridade e RLS/RPC/Edge Function; este e o lado do
 * frontend que le essa recusa.
 */
export type DbErrorKind =
  | 'permissao'
  | 'sessao_expirada'
  | 'conflito'
  | 'limite'
  | 'validacao'
  | 'desconhecido'

export type ClassifiedDbError = { kind: DbErrorKind; message: string }

/** Tabela codigo Postgres/PostgREST -> como o operador entende a recusa. */
const ERROR_TABLE: Readonly<Record<string, ClassifiedDbError>> = {
  '42501': { kind: 'permissao', message: 'Sem permissao para esta acao. Solicite acesso administrativo.' },
  PGRST301: { kind: 'sessao_expirada', message: 'Sua sessao expirou. Entre novamente para continuar.' },
  '28000': { kind: 'sessao_expirada', message: 'Sua sessao expirou. Entre novamente para continuar.' },
  '23505': { kind: 'conflito', message: 'Este registro ja existe.' },
  '23503': { kind: 'validacao', message: 'Registro referenciado nao existe ou ainda esta em uso.' },
  '23514': { kind: 'validacao', message: 'Dados fora das regras do cadastro.' },
  '22P02': { kind: 'validacao', message: 'Valor em formato invalido.' },
  P0429: { kind: 'limite', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  '57014': { kind: 'limite', message: 'A consulta demorou demais. Reduza o periodo e tente novamente.' },
}

const UNKNOWN_MESSAGE = 'Falha inesperada. Tente novamente.'

/**
 * Texto cru do PostgREST/Postgres, que nomeia tabela, funcao ou policy. Nunca
 * vai para a tela: e o unico ponto onde essa decisao e tomada.
 */
const RAW_POSTGREST_TEXT = /permission denied for (?:table|view|function|relation|schema|sequence)/i

function errorFields(error: unknown): { code: string; message: string } {
  if (error instanceof Error) return { code: '', message: error.message }
  if (typeof error === 'string') return { code: '', message: error }
  if (typeof error === 'object' && error) {
    const candidate = error as { code?: unknown; message?: unknown }
    return { code: String(candidate.code ?? ''), message: String(candidate.message ?? '') }
  }
  return { code: '', message: '' }
}

/**
 * Le a recusa do banco e devolve como o app a entende, com a mensagem ja em
 * portugues. Substitui as sete copias privadas de `isPermissionError` e os
 * fallbacks escritos a mao nos catch de UI.
 *
 * Mensagem escrita pelo banco (RAISE EXCEPTION numa RPC) ganha da mensagem
 * generica da tabela — ela e mais especifica e foi escrita para o operador.
 * Texto cru do PostgREST nunca ganha: ele nomeia tabelas e policies.
 * `details` e `hint` nunca sao exibidos.
 */
export function classifyDbError(error: unknown): ClassifiedDbError {
  const { code, message } = errorFields(error)
  const known = ERROR_TABLE[code]

  if (known) {
    const authored = message.trim()
    const safeToShow = authored.length > 0 && !RAW_POSTGREST_TEXT.test(authored)
    return { kind: known.kind, message: safeToShow ? authored : known.message }
  }

  if (/permission denied/i.test(message)) {
    return ERROR_TABLE['42501']
  }

  const authored = message.trim()
  return { kind: 'desconhecido', message: authored.length > 0 ? authored : UNKNOWN_MESSAGE }
}
```

- [ ] **Step 4: Rode para ver passar**

```bash
npx vitest run src/lib/__tests__/errors.test.ts
```

Esperado: PASS — todos os testes de `extractErrorText` continuam verdes mais os 9 novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/lib/__tests__/errors.test.ts
git commit -m "feat(errors): aprofundar lib/errors com classifyDbError"
```

---

### Task 8: Substituir as sete cópias

**Files:**
- Modify: `src/services/billing.ts:924,988-990`
- Modify: `src/services/customerFicha.ts:75-77`
- Modify: `src/services/charges/chargeOperationsService.ts:599-601`
- Modify: `src/hooks/useCustomers.ts:221-223`
- Modify: `src/services/reports.ts:148,286,424-426`
- Modify: `src/components/review/ReviewDrawer.tsx:123-126`
- Modify: `src/components/voyages/VoyageVisaoTab.tsx:149-155`

Faça um arquivo por vez, rodando o teste do arquivo entre cada um.

- [ ] **Step 1: `services/billing.ts`**

Apague a função privada de L988–990:

```ts
function isPermissionError(error: { code?: string | null; message?: string | null }) {
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}
```

Acrescente ao bloco de imports do topo:

```ts
import { classifyDbError } from '../lib/errors'
```

E em L924 troque `if (isPermissionError(error)) {` por:

```ts
    if (classifyDbError(error).kind === 'permissao') {
```

- [ ] **Step 2: `services/customerFicha.ts`**

Apague L75–77 (a função privada) e acrescente o import:

```ts
import { classifyDbError } from '../lib/errors'
```

Troque **todas** as chamadas `isPermissionError(x)` do arquivo (L103, L113, L121, L171, L172, L173) por:

```ts
classifyDbError(x).kind === 'permissao'
```

Localize-as com:

```bash
grep -n "isPermissionError" src/services/customerFicha.ts
```

- [ ] **Step 3: `services/charges/chargeOperationsService.ts`**

Apague L599–601 e acrescente:

```ts
import { classifyDbError } from '../../lib/errors'
```

Troque L301 `if (auditError && !isPermissionError(auditError)) {` por:

```ts
  if (auditError && classifyDbError(auditError).kind !== 'permissao') {
```

- [ ] **Step 4: `hooks/useCustomers.ts`**

Apague L221–223 e acrescente:

```ts
import { classifyDbError } from '../lib/errors'
```

Troque L191 `if (isPermissionError(invoiceError)) {` por:

```ts
          if (classifyDbError(invoiceError).kind === 'permissao') {
```

- [ ] **Step 5: `services/reports.ts` — a cópia divergente**

Apague L424–426:

```ts
function isAccessDenied(error: { code?: string } | null | undefined) {
  return error?.code === '42501' || error?.code === 'PGRST301'
}
```

Acrescente o import:

```ts
import { classifyDbError } from '../lib/errors'
```

Crie no lugar dela, no mesmo ponto do arquivo:

```ts
/** `accessDenied` do relatorio = recusa de RLS ou sessao expirada. */
function isAccessDenied(error: unknown): boolean {
  const kind = classifyDbError(error).kind
  return kind === 'permissao' || kind === 'sessao_expirada'
}
```

E troque as duas condições inline (L148 e L286):

```ts
    if (error.code === '42501' || error.code === 'PGRST301') {
```

por:

```ts
    if (isAccessDenied(error)) {
```

(em L286 o identificador é `invoicesError`, não `error` — use `isAccessDenied(invoicesError)`).

- [ ] **Step 6: `components/review/ReviewDrawer.tsx`**

Acrescente o import (o arquivo já importa de `../../lib/errors`; adicione `classifyDbError` à lista):

```ts
import { classifyDbError, extractErrorText } from '../../lib/errors'
```

Troque L123–126:

```ts
      if (haystack.includes('permission denied') || haystack.includes('42501')) {
        showToast('Seu usuário não tem permissão para cadastrar cliente. Solicite acesso administrativo.', 'error')
        return
      }
```

por:

```ts
      if (classifyDbError(error).kind === 'permissao') {
        showToast('Seu usuário não tem permissão para cadastrar cliente. Solicite acesso administrativo.', 'error')
        return
      }
```

(o identificador do erro capturado no `catch` deste bloco pode chamar-se `err` — use o nome que estiver no escopo; confira com `grep -n "catch" src/components/review/ReviewDrawer.tsx`).

- [ ] **Step 7: `components/voyages/VoyageVisaoTab.tsx`**

Adicione `classifyDbError` ao import existente de `../../lib/errors` e troque L149–155:

```ts
      const errorText = extractErrorText(error).toLowerCase()
      if (errorText.includes('42501') || errorText.includes('permission denied')) {
        showToast('Sem permissão para excluir planejamento do POD. Solicite acesso administrativo.', 'error')
        return
      }
      showToast(`Falha ao excluir planejamento do POD.${errorText ? ` Motivo: ${errorText}` : ''}`, 'error')
```

por:

```ts
      const classified = classifyDbError(error)
      if (classified.kind === 'permissao') {
        showToast('Sem permissão para excluir planejamento do POD. Solicite acesso administrativo.', 'error')
        return
      }
      showToast(`Falha ao excluir planejamento do POD. Motivo: ${classified.message}`, 'error')
```

Faça a mesma troca no handler de exclusão de POL do mesmo arquivo, se ele repetir o padrão.

- [ ] **Step 8: Confirme que não sobrou nenhuma cópia**

```bash
grep -rn "isPermissionError" src --include=*.ts --include=*.tsx
grep -rn "includes('42501')\|includes(\"42501\")" src --include=*.ts --include=*.tsx
```

Esperado: **nenhuma saída** em ambos (os testes de migration que mencionam `42501` em SQL são strings de teste e continuam válidos — se aparecerem, confirme que estão em `src/services/__tests__/*Migration.test.ts` e deixe-os).

- [ ] **Step 9: Rode a suíte e o typecheck**

```bash
npm test
npm run typecheck
```

Esperado: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "refactor(errors): trocar as sete copias de isPermissionError por classifyDbError"
```

---

### Task 9: `portalErrorMessage` vira adapter

Dois adapters sobre a mesma tabela é o que torna o seam real, e não uma hipótese.

**Files:**
- Modify: `src/lib/portalErrorMessage.ts`
- Test: `src/lib/__tests__/portalErrorMessage.test.ts` (criar se não existir)

- [ ] **Step 1: Escreva o teste**

Crie ou acrescente a `src/lib/__tests__/portalErrorMessage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { portalErrorMessage } from '../portalErrorMessage'

describe('portalErrorMessage', () => {
  it('mantem a mensagem de rate limit do Portal', () => {
    expect(portalErrorMessage({ code: 'P0429' }, 'fallback')).toBe(
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    )
  })

  it('mantem a mensagem de sessao expirada do Portal', () => {
    expect(portalErrorMessage({ code: '28000' }, 'fallback')).toBe(
      'Sua sessao expirou. Entre novamente para continuar.',
    )
  })

  it('mantem a regra especifica do Portal para senha repetida', () => {
    expect(portalErrorMessage({ message: 'New password should be different from the old password' }, 'fallback')).toBe(
      'A nova senha deve ser diferente da senha atual.',
    )
  })

  it('herda a tabela compartilhada para recusa de RLS', () => {
    expect(portalErrorMessage({ code: '42501', message: 'permission denied for table bls' }, 'fallback')).toBe(
      'Sem permissao para esta acao. Solicite acesso administrativo.',
    )
  })

  it('usa o fallback do chamador quando o erro e desconhecido e sem mensagem', () => {
    expect(portalErrorMessage({}, 'Falha ao entrar.')).toBe('Falha ao entrar.')
  })

  it('usa o fallback tambem quando o erro desconhecido TEM mensagem em ingles', () => {
    // Regressao a evitar: o cliente do Portal nunca ve texto cru do GoTrue.
    expect(portalErrorMessage({ message: 'Invalid login credentials' }, 'Falha ao entrar.')).toBe(
      'Falha ao entrar.',
    )
  })
})
```

- [ ] **Step 2: Rode para ver falhar**

```bash
npx vitest run src/lib/__tests__/portalErrorMessage.test.ts
```

Esperado: FAIL no teste "herda a tabela compartilhada" — hoje devolve `'fallback'`.

- [ ] **Step 3: Reescreva `portalErrorMessage` como adapter**

Substitua todo o conteúdo de `src/lib/portalErrorMessage.ts` por:

```ts
import { classifyDbError } from './errors'

/**
 * Adapter do Portal sobre `classifyDbError`. Ele nao reimplementa a tabela —
 * so acrescenta as regras que sao do Portal e de mais ninguem (a mensagem de
 * senha repetida do GoTrue) e reduz o resultado a uma string, que e o que os
 * formularios do Portal consomem.
 */
export function portalErrorMessage(error: unknown, fallback: string): string {
  const message = (typeof error === 'object' && error ? String((error as { message?: unknown }).message ?? '') : '')
    .toLowerCase()

  // Regra exclusiva do Portal: o GoTrue devolve isso sem codigo classificavel.
  if ((message.includes('new password') && message.includes('different')) || message.includes('same password')) {
    return 'A nova senha deve ser diferente da senha atual.'
  }

  const classified = classifyDbError(error)

  // Erro nao classificado NUNCA vira texto na tela do cliente: o GoTrue e o
  // PostgREST devolvem mensagem em ingles e, as vezes, detalhe interno. Todos
  // os chamadores do Portal ja passam um fallback em portugues escrito para o
  // caso deles — e ele que vale aqui.
  return classified.kind === 'desconhecido' ? fallback : classified.message
}
```

- [ ] **Step 4: Rode para ver passar**

```bash
npx vitest run src/lib/__tests__/portalErrorMessage.test.ts
npm test
```

Esperado: PASS. Se algum teste do Portal quebrar por causa de acentuação da mensagem, ajuste **o teste** para a mensagem da tabela — a tabela é agora a fonte única.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portalErrorMessage.ts src/lib/__tests__/portalErrorMessage.test.ts
git commit -m "refactor(errors): portalErrorMessage vira adapter de classifyDbError"
```

---

### Task 10: Documentar o leitor de recusa

**Files:**
- Modify: `CONTEXT.md` (seção *Dupla proteção RBAC*, L849)
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Complete a seção de RBAC no `CONTEXT.md`**

Ao final do parágrafo de *Dupla proteção RBAC* (a partir de L849), acrescente:

```markdown
O lado do frontend que **lê** essa recusa é `classifyDbError` em
`src/lib/errors.ts`: uma tabela de códigos Postgres/PostgREST para
`kind` + mensagem em português. É o único lugar do app que decide o que o
operador vê quando o banco nega — e o único ponto que garante que `details` e
`hint` do Postgres (que nomeiam tabelas e policies) nunca cheguem à tela.
```

- [ ] **Step 2: Registre na arquitetura**

Em `docs/ARCHITECTURE.md`, na seção de `src/lib/`, acrescente:

```markdown
- `errors.ts` — `extractErrorText` (texto legível) e `classifyDbError` (leitura
  da recusa do banco: `permissao`, `sessao_expirada`, `conflito`, `limite`,
  `validacao`, `desconhecido`). `portalErrorMessage.ts` é o adapter do Portal
  sobre a mesma tabela.
```

- [ ] **Step 3: Rode o gate**

```bash
npm run docs:check
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add CONTEXT.md docs/ARCHITECTURE.md
git commit -m "docs: registrar classifyDbError como leitura da recusa do banco"
```

---

# Fase 3 — Pipeline de importação (candidato #03)

**O problema, em uma frase:** dois seams certos foram abertos e nenhum foi terminado. `importCore.ts` é usado por 3 dos 10 parsers; `FileImportModal` (que já é profundo) é usado por 1 das 7 telas de importação — bloqueado por um parâmetro obrigatório.

A deriva de opções do `xlsx` é o custo concreto — ela decide se uma célula de data chega como `Date` ou como `string`:

| Parser | Opções de leitura | Efeito |
|---|---|---|
| `importCore` (3 parsers) | `cellText:true` `cellDates:false` / `raw:false` `defval:''` | datas como texto |
| `containerDatesImport` | `cellDates:true` / `defval:''` | datas como `Date` |
| `customerBase` | (sem opções) / `defval:''` | depende do heurístico do `xlsx` |
| `vesselScheduleImport` | `cellDates:false` / `raw:true` | números crus, sem formatação |
| `vehicleImport`, `ceMercante`, `breakbulk` | `cellText:true` / `raw:false` | datas como texto |

**Fase 3a (Tasks 11–13)** e **Fase 3b (Tasks 14–15)** são independentes — nenhuma depende da outra.

---

### Task 11: `readSheet` — leitura com opções nomeadas

**Files:**
- Modify: `src/services/importCore.ts`
- Test: `src/services/__tests__/importCore.test.ts`

- [ ] **Step 1: Escreva os testes que falham**

Acrescente a `src/services/__tests__/importCore.test.ts`:

```ts
import { readSheet } from '../importCore'

/** Gera um .xlsx em memoria com uma coluna de data, para exercer as opcoes. */
async function buildWorkbook(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const XLSX = await import('@e965/xlsx')
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
  const out = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return out
}

describe('readSheet', () => {
  it('devolve cabecalhos e linhas-objeto da primeira aba', async () => {
    const buffer = await buildWorkbook([{ Container: 'ABCD1234567', Tipo: '40HC' }])

    const { headers, rows } = await readSheet(buffer)

    expect(headers).toEqual(['Container', 'Tipo'])
    expect(rows).toEqual([{ Container: 'ABCD1234567', Tipo: '40HC' }])
  })

  it('com dates: "texto" (padrao) a data chega como string', async () => {
    const buffer = await buildWorkbook([{ Data: new Date(Date.UTC(2026, 6, 27)) }])

    const { rows } = await readSheet(buffer)

    expect(rows[0].Data).toBeTypeOf('string')
  })

  it('com dates: "date" a data chega como Date — a opcao vira decisao explicita', async () => {
    const buffer = await buildWorkbook([{ Data: new Date(Date.UTC(2026, 6, 27)) }])

    const { rows } = await readSheet(buffer, { dates: 'date' })

    expect(rows[0].Data).toBeInstanceOf(Date)
  })

  it('preenche celula ausente com string vazia', async () => {
    const buffer = await buildWorkbook([{ A: 'x', B: 'y' }, { A: 'z' }])

    const { rows } = await readSheet(buffer)

    expect(rows[1].B).toBe('')
  })

  it('lanca com a mensagem historica quando o arquivo nao tem aba', async () => {
    const XLSX = await import('@e965/xlsx')
    const empty = XLSX.write(XLSX.utils.book_new(), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    await expect(readSheet(empty)).rejects.toThrow('Arquivo sem abas validas.')
  })

  it('lanca com a mensagem historica quando a aba nao tem linhas', async () => {
    const buffer = await buildWorkbook([])

    await expect(readSheet(buffer)).rejects.toThrow('Planilha vazia.')
  })
})
```

- [ ] **Step 2: Rode para ver falhar**

```bash
npx vitest run src/services/__tests__/importCore.test.ts
```

Esperado: FAIL — `readSheet is not exported`.

- [ ] **Step 3: Implemente `readSheet`**

Em `src/services/importCore.ts`, **substitua** a função `readFirstSheetRows` (L44–59) por:

```ts
/**
 * Como as celulas devem chegar ao parser. Isto existe porque a escolha era
 * deriva silenciosa: sete parsers passavam combinacoes diferentes de
 * `cellText`/`cellDates`/`raw` ao xlsx, e a diferenca decide se uma data chega
 * como `Date` ou como `string` — que e onde parsers de planilha erram.
 * Aqui a escolha e nomeada e o padrao e o do projeto (data como texto).
 */
export type SheetReadOptions = {
  /** `'texto'` (padrao) devolve a data ja formatada; `'date'` devolve `Date`. */
  dates?: 'texto' | 'date'
  /** `'formatado'` (padrao) aplica a formatacao da celula; `'cru'` devolve o valor bruto. */
  values?: 'formatado' | 'cru'
  /** Descarta linhas totalmente vazias (padrao: `true`). */
  skipBlankRows?: boolean
}

export type SheetContent = {
  /** Cabecalhos da primeira linha, na ordem, com `trim` aplicado. */
  headers: string[]
  /** Linhas-objeto com o cabecalho original como chave. */
  rows: Record<string, unknown>[]
}

/**
 * Le a primeira aba de um buffer XLSX. Unico leitor de planilha do projeto:
 * cabecalhos e linhas saem da mesma leitura, evitando o par
 * `sheet_to_json(header:1)` + `sheet_to_json()` copiado nos parsers.
 */
export async function readSheet(
  buffer: ArrayBuffer,
  options: SheetReadOptions = {},
): Promise<SheetContent> {
  const wantDates = options.dates === 'date'
  const raw = options.values === 'cru'

  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellText: !wantDates,
    cellDates: wantDates,
  })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) throw new Error('Arquivo sem abas validas.')

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw,
  })
  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: '',
    raw,
    blankrows: !(options.skipBlankRows ?? true),
  })
  if (!rows.length) throw new Error('Planilha vazia.')

  return { headers, rows }
}

/**
 * ponytail: preservado para os 3 parsers que ja usavam o seam, com o
 * comportamento exato de antes. Teto: duas portas de entrada para a mesma
 * leitura. Upgrade: apagar quando `vaziosImport`, `vaziosImportacaoImport` e
 * `graniteImport` chamarem `readSheet` direto (Task 13).
 */
export async function readFirstSheetRows(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const { rows } = await readSheet(buffer)
  return rows
}
```

- [ ] **Step 4: Rode para ver passar**

```bash
npx vitest run src/services/__tests__/importCore.test.ts
```

Esperado: PASS — os testes antigos de `readFirstSheetRows` continuam verdes mais os 6 novos.

- [ ] **Step 5: Commit**

```bash
git add src/services/importCore.ts src/services/__tests__/importCore.test.ts
git commit -m "feat(import): readSheet com opcoes de leitura nomeadas"
```

---

### Task 12: `HeaderSpec` — casamento de cabeçalho num lugar só

Hoje cinco arquivos (`ceMercanteImport`, `containerDatesImport`, `vehicleImport`, `breakbulkManifestParser`, `customerBase`) declaram cada um o próprio `headerMap`, o próprio `type DestinationField = keyof typeof headerMap` e a própria checagem de coluna faltante, com o mesmo `Object.entries(headerMap).find(...)` copiado.

**Files:**
- Modify: `src/services/importCore.ts`
- Test: `src/services/__tests__/importCore.test.ts`

- [ ] **Step 1: Escreva os testes que falham**

Acrescente a `src/services/__tests__/importCore.test.ts`:

```ts
import { matchHeaders, type HeaderSpec } from '../importCore'

const spec: HeaderSpec<'container' | 'tipo' | 'observacao'> = {
  aliases: {
    container: ['container', 'conteiner', 'n container'],
    tipo: ['tipo', 'type', 'tipo container'],
    observacao: ['observacao', 'obs'],
  },
  required: ['container', 'tipo'],
}

describe('matchHeaders', () => {
  it('casa cabecalhos ignorando caixa, acento e espaco extra', () => {
    const result = matchHeaders(['  CONTÊINER ', 'Tipo Container', 'OBS'], spec)

    expect(result.columnByField).toEqual({
      container: '  CONTÊINER ',
      tipo: 'Tipo Container',
      observacao: 'OBS',
    })
    expect(result.missing).toEqual([])
  })

  it('relata apenas as colunas obrigatorias ausentes', () => {
    const result = matchHeaders(['Tipo'], spec)

    expect(result.missing).toEqual(['container'])
    expect(result.columnByField.tipo).toBe('Tipo')
  })

  it('nao reclama de coluna opcional ausente', () => {
    const result = matchHeaders(['Container', 'Tipo'], spec)

    expect(result.missing).toEqual([])
    expect(result.columnByField.observacao).toBeUndefined()
  })

  it('o primeiro cabecalho que casa vence — planilhas com coluna repetida', () => {
    const result = matchHeaders(['Container', 'Conteiner'], spec)

    expect(result.columnByField.container).toBe('Container')
  })
})
```

- [ ] **Step 2: Rode para ver falhar**

```bash
npx vitest run src/services/__tests__/importCore.test.ts
```

Esperado: FAIL — `matchHeaders is not exported`.

- [ ] **Step 3: Implemente**

Acrescente ao final de `src/services/importCore.ts`:

```ts
/**
 * O contrato de cabecalho de um formato de planilha: quais nomes de coluna sao
 * aceitos para cada campo canonico e quais campos sao obrigatorios.
 * "Quais colunas faltam?" passa a ser respondido uma vez, e nao uma vez por
 * parser.
 */
export type HeaderSpec<F extends string> = {
  readonly aliases: Readonly<Record<F, readonly string[]>>
  readonly required: readonly F[]
}

/** `trim` + minusculas + remocao de acento — a normalizacao usada em todos os parsers. */
function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Casa os cabecalhos reais da planilha com os campos canonicos do `HeaderSpec`.
 * Devolve o cabecalho ORIGINAL de cada campo (e nao o normalizado), porque e
 * ele que indexa as linhas-objeto devolvidas por `readSheet`.
 */
export function matchHeaders<F extends string>(
  headers: readonly string[],
  spec: HeaderSpec<F>,
): { columnByField: Partial<Record<F, string>>; missing: F[] } {
  const columnByField: Partial<Record<F, string>> = {}

  for (const field of Object.keys(spec.aliases) as F[]) {
    const accepted = new Set(spec.aliases[field].map(normalizeHeader))
    const found = headers.find((header) => accepted.has(normalizeHeader(header)))
    if (found !== undefined) columnByField[field] = found
  }

  const missing = spec.required.filter((field) => columnByField[field] === undefined)
  return { columnByField, missing }
}
```

- [ ] **Step 4: Rode para ver passar**

```bash
npx vitest run src/services/__tests__/importCore.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/importCore.ts src/services/__tests__/importCore.test.ts
git commit -m "feat(import): HeaderSpec e matchHeaders no seam de parsing"
```

---

### Task 13: Migrar os parsers para `readSheet` e `matchHeaders`

Um arquivo por vez, com os testes do parser rodando entre cada um. **Não mude o comportamento observável de nenhum parser** — só de onde a leitura vem.

**Files:**
- Modify: `src/services/containerDatesImport.ts:32-49`
- Modify: `src/services/customerBase.ts:44-61`
- Modify: `src/services/vesselScheduleImport.ts:1-11`
- Modify: `src/services/vehicleImport.ts:101-121`
- Modify: `src/services/ceMercanteImport.ts:82-102`
- Modify: `src/services/breakbulkManifestParser.ts:78-101`

- [ ] **Step 1: `containerDatesImport.ts` — o parser que quer `Date`**

Troque L32–49:

```ts
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

  if (!firstSheet) throw new Error('Arquivo sem abas validas.')

  const matrix = XLSX.utils.sheet_to_json<(unknown)[]>(firstSheet, { header: 1, defval: '', blankrows: false })
  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
```

por:

```ts
  const { headers: rawHeaders, rows: objectRows } = await readSheet(buffer, { dates: 'date' })
```

e apague a leitura duplicada de L48 (`const objectRows = XLSX.utils.sheet_to_json...`). Acrescente ao topo:

```ts
import { readSheet } from './importCore'
```

Se o `import dinâmico do XLSX` ficar sem uso no arquivo, remova-o (o `lint` acusa).

- [ ] **Step 2: Rode o teste do parser**

```bash
npx vitest run src/services/__tests__ -t "containerDates"
```

Esperado: PASS. Se falhar, a diferença está em `blankrows` — `readSheet` descarta linha vazia por padrão, igual ao `blankrows:false` original.

- [ ] **Step 3: `customerBase.ts`**

Troque a leitura de L44–60 por:

```ts
  const { rows: objectRows } = await readSheet(buffer)
```

mantendo o restante do arquivo. Onde a matriz era usada só para achar cabeçalho, use `headers` de `readSheet`. Acrescente o import de `./importCore`.

**Atenção:** `customerBase` hoje lê sem `raw:false`, ou seja, depende do heurístico do `xlsx`. `readSheet` padroniza para valor formatado. Rode o teste e, se algum caso numérico mudar, use `{ values: 'cru' }` e registre a escolha com um comentário de uma linha explicando **por quê**.

- [ ] **Step 4: Rode o teste**

```bash
npx vitest run src/services/__tests__ -t "customerBase"
```

- [ ] **Step 5: `vesselScheduleImport.ts` — o parser que quer valor cru**

Substitua o corpo inteiro por:

```ts
import { assertUploadFile } from '../lib/fileGuard'
import { readSheet } from './importCore'

export async function parseVesselScheduleFile(file: File): Promise<Record<string, unknown>[]> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  // `values: 'cru'` preserva o comportamento historico (raw: true): a programacao
  // do armador traz numeros que o parser converte, sem formatacao da planilha.
  const { rows } = await readSheet(buffer, { values: 'cru' })
  return rows
}
```

**Nota:** o comportamento muda num detalhe — a versão antiga lançava `'Planilha sem aba valida.'` e a nova lança `'Arquivo sem abas validas.'`. Ajuste o teste que assertar essa string, se houver:

```bash
grep -rn "Planilha sem aba valida" src
```

- [ ] **Step 6: `vehicleImport.ts`, `ceMercanteImport.ts`, `breakbulkManifestParser.ts`**

Os três já usam `cellText:true` + `raw:false`, que é exatamente o padrão de `readSheet`. Em cada um, troque o par `XLSX.read` + duas chamadas `sheet_to_json` por:

```ts
  const { headers, rows } = await readSheet(buffer)
```

adaptando os nomes das variáveis locais (`matrix[0]` vira `headers`; `objectRows` vira `rows`). Acrescente o import de `./importCore` e remova o import dinâmico do `xlsx` se ficar sem uso.

- [ ] **Step 7: Rode a suíte completa dos parsers**

```bash
npx vitest run src/services/__tests__
npm run lint
npm run typecheck
```

Esperado: PASS, sem warning de import não usado.

- [ ] **Step 8: Confirme que sobrou um único leitor de planilha**

```bash
grep -rn "XLSX.read(" src --include=*.ts
```

Esperado: só `src/services/importCore.ts` e `src/services/blParser.ts`.

`blParser.ts` fica de fora **de propósito**: ele lê a aba nomeada `'Page 1'` por posição de célula (layout COSCO), não linhas-objeto por cabeçalho — já marcado com `ponytail:` no próprio arquivo. Forçá-lo no seam distorceria a interface. Registre isso num comentário de uma linha em `importCore.ts`.

- [ ] **Step 9: Adote `matchHeaders` nos cinco parsers que copiam a checagem**

Sem este step, `matchHeaders` fica sendo uma abstração sem usuário — falharia o teste da deleção que justifica o plano inteiro.

Os cinco arquivos têm a **mesma** função privada `mapRow`, copiada com variações cosméticas (`normalizeHeader` vs `normalizeText`, `forEach` vs `for…of`):

| Arquivo | Função | Linha |
|---|---|---|
| `ceMercanteImport.ts` | `mapRow` | 307–321 |
| `containerDatesImport.ts` | `mapRow` | 211–221 |
| `vehicleImport.ts` | `mapRow` | 477–491 |
| `breakbulkManifestParser.ts` | `mapRow` | 527–541 |
| `customerBase.ts` | `mapRow` | 243–257 |

Em **cada um**, o corpo é este padrão:

```ts
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  Object.entries(row).forEach(([header, value]) => {
    const normalizedHeader = normalizeText(header)
    const destination = Object.entries(headerMap).find(([, candidates]) =>
      candidates.some((candidate) => normalizedHeader === normalizeText(candidate)),
    )?.[0] as DestinationField | undefined
    if (destination && mapped[destination] === undefined) {
      mapped[destination] = value
    }
  })
  return mapped
```

Substitua-o por, mantendo o nome e a assinatura de `mapRow` (para não tocar nos chamadores):

```ts
function mapRow(row: Record<string, unknown>): Partial<Record<DestinationField, unknown>> {
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) {
    mapped[field] = row[column]
  }
  return mapped
}
```

E, acima dele, declare o `HeaderSpec` a partir do `headerMap` que o arquivo já tem:

```ts
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  // Preserva o comportamento atual: `mapRow` nunca reprovou coluna ausente —
  // quem valida obrigatoriedade e o parser, depois. Ver o step 10.
  required: [],
}
```

Acrescente ao import de `./importCore`: `matchHeaders, type HeaderSpec`.

Depois de cada arquivo, rode o teste dele antes de passar ao próximo:

```bash
npx vitest run src/services/__tests__ -t "ceMercante"
```

**Duas diferenças de comportamento a conferir**, ambas para melhor — se um teste quebrar por causa delas, o teste é que estava fixando o bug:

- `matchHeaders` normaliza **acento** além de caixa e espaço; três dos cinco parsers usavam `normalizeText`, que já removia acento, e dois usavam `normalizeHeader`, que não. Depois da troca, `CONTÊINER` passa a casar com `conteiner` nos cinco.
- No empate (duas colunas casando o mesmo campo), o original mantinha a **primeira coluna da linha**; `matchHeaders` mantém a **primeira coluna que casa**, na ordem dos headers. É a mesma coisa para os cinco formatos, que não têm coluna repetida.

- [ ] **Step 10: Mova a validação de coluna obrigatória para o `HeaderSpec`**

Cada um dos cinco parsers valida colunas obrigatórias em algum ponto **depois** de `mapRow`. Localize:

```bash
grep -n "obrigat\|ausente\|faltando" src/services/ceMercanteImport.ts src/services/containerDatesImport.ts src/services/vehicleImport.ts src/services/breakbulkManifestParser.ts src/services/customerBase.ts
```

Para cada validação encontrada, mova os campos para `required` do `SPEC` daquele arquivo e substitua a checagem à mão por, no ponto onde a planilha é lida:

```ts
  const { columnByField, missing } = matchHeaders(headers, SPEC)
  if (missing.length) {
    throw new Error(`Colunas obrigatorias ausentes: ${missing.join(', ')}.`)
  }
```

**Preserve a mensagem de erro original** de cada parser se ela já for específica — os testes a asseguram e o operador a conhece. Se o parser não validava nada, deixe `required: []` e siga.

- [ ] **Step 11: Confirme que a cópia sumiu**

```bash
grep -rn "Object.entries(headerMap).find\|Object.entries(headerMap) as" src --include=*.ts
```

Esperado: **nenhuma saída**.

- [ ] **Step 12: Rode a suíte completa**

```bash
npx vitest run src/services/__tests__
npm run lint
npm run typecheck
```

Esperado: PASS, sem `normalizeHeader`/`normalizeText` órfãos (o `lint` acusa se ficarem sem uso).

- [ ] **Step 13: Commit**

```bash
git add -A src/services
git commit -m "refactor(import): parsers passam a ler planilha e casar cabecalho pelo seam"
```

---

### Task 14: `FileImportModal` deixa de exigir Viagem e ganha pré-requisito

`FileImportModal` já é um módulo profundo — é dono de toda a máquina de estado arquivo → preview → confirmação, incluindo lote e erros por arquivo. Duas coisas o mantêm com 1 usuário em vez de 7:

1. `voyageLabel: string` é **obrigatório** e renderizado como um painel fixo `Viagem: X`.
2. Não existe lugar para o passo que vem **antes** do arquivo. As 6 páginas põem um `VoyageCombobox` dentro do modal — o operador escolhe a Viagem de destino e só então anexa o arquivo.

Esta task resolve as duas com uma interface que continua pequena: `subtitle` (contexto já conhecido) e `prerequisite` + `ready` (contexto que o operador ainda precisa escolher).

**Files:**
- Modify: `src/components/shared/FileImportModal.tsx`
- Modify: `src/components/shared/VoyageImportActions.tsx` (4 usos)

- [ ] **Step 1: Troque os props no tipo**

Em `src/components/shared/FileImportModal.tsx`, no tipo `Props<T>`, troque:

```ts
  voyageLabel: string
```

por:

```ts
  /** Contexto já conhecido, exibido acima do input — ex.: `Viagem: 24W`. */
  subtitle?: ReactNode
  /**
   * Passo que precede o arquivo — ex.: escolher a Viagem de destino.
   * Renderizado acima do input; o input fica travado enquanto `ready` for false.
   */
  prerequisite?: ReactNode
  /** Libera o input de arquivo. Padrão `true` (sem pré-requisito). */
  ready?: boolean
```

E na desestruturação do componente troque `voyageLabel,` por:

```ts
  subtitle,
  prerequisite,
  ready = true,
```

- [ ] **Step 2: Ajuste o JSX**

No `return`, troque:

```tsx
        <div className="app-panel app-panel--padded text-sm">
          Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span>
        </div>
        {helper}
        <Field label={`Arquivo ${accept}`}>
          <Input accept={accept} multiple={multiple} type="file" onChange={handleFile} />
        </Field>
```

por:

```tsx
        {subtitle ? <div className="app-panel app-panel--padded text-sm">{subtitle}</div> : null}
        {helper}
        {prerequisite}
        <Field label={`Arquivo ${accept}`}>
          <Input accept={accept} disabled={!ready} multiple={multiple} type="file" onChange={handleFile} />
        </Field>
```

- [ ] **Step 3: Trave também a confirmação**

Ainda no `return`, no botão `Confirmar`, troque:

```tsx
            disabled={!entries.some((entry) => canImport(entry.preview))}
```

por:

```tsx
            disabled={!ready || !entries.some((entry) => canImport(entry.preview))}
```

- [ ] **Step 4: Atualize os 4 usos em `VoyageImportActions.tsx`**

```bash
grep -n "voyageLabel" src/components/shared/VoyageImportActions.tsx
```

Em cada um, troque `voyageLabel={X}` por:

```tsx
          subtitle={<>Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{X}</span></>}
```

substituindo `X` pela expressão que já estava lá. O markup é o mesmo de antes — a diferença é que agora quem escolhe o rótulo é o chamador.

- [ ] **Step 5: Verifique**

```bash
grep -rn "voyageLabel" src/components/shared/FileImportModal.tsx
npm run typecheck
npx vitest run src/components/shared
```

Esperado: nenhuma ocorrência em `FileImportModal.tsx`, typecheck limpo, testes verdes. (`voyageLabel` continua existindo como prop de outros componentes — `VoyageVisaoTab`, por exemplo. Só o `FileImportModal` deixa de exigi-lo.)

- [ ] **Step 6: Commit**

```bash
git add src/components/shared/FileImportModal.tsx src/components/shared/VoyageImportActions.tsx
git commit -m "refactor(import): FileImportModal aceita subtitle e pre-requisito opcionais"
```

---

### Task 15: Adotar `FileImportModal` em duas telas

Duas, e não sete: dois adapters bastam para provar que o seam é real, e as telas restantes divergem em detalhe de UI (o `Granite.tsx` mantém overrides de CNPJ por linha dentro do modal, o `EmbarqueVazios.tsx` tem seleção de depot) o suficiente para que migrá-las todas de uma vez seja uma refatoração de UI, não de arquitetura. As cinco restantes ficam para adoção incremental — a Task 16 registra a regra para que toda tela **nova** já nasça no seam.

Escolhidas por serem as que menos customizam além do preview: `CargaSolta` e `VaziosImportacao`.

**Files:**
- Modify: `src/pages/CargaSolta.tsx` (estados em L52–54, modal em ~L440–530)
- Modify: `src/pages/VaziosImportacao.tsx` (estados em L58–59)

- [ ] **Step 1: `CargaSolta.tsx` — remova a máquina de estado à mão**

Apague os três `useState` de L52–54:

```ts
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<ParsedBreakbulkManifest | null>(null)
  const [parsing, setParsing] = useState(false)
```

e o handler `handleFile` que os alimenta (localize com `grep -n "function handleFile" src/pages/CargaSolta.tsx`).

Mantenha `voyageId` e `setVoyageId` — eles são o pré-requisito, não parte da máquina de estado do arquivo.

- [ ] **Step 2: Extraia o preview para um componente local**

Ainda em `src/pages/CargaSolta.tsx`, acima do componente de página, crie:

```tsx
function BreakbulkPreview({ manifest }: { manifest: ParsedBreakbulkManifest }) {
  return (
    <div className="grid gap-4">
      {/* Cole aqui, sem alterar, todo o JSX que hoje esta dentro de `{manifest ? (...) : null}` */}
    </div>
  )
}
```

Mova o JSX do bloco `{manifest ? (<div className="grid gap-4"> … </div>) : null}` para dentro dele **sem editar nada** — as referências a `manifest` continuam válidas porque agora ele é prop.

- [ ] **Step 3: Troque o modal pelo seam**

Substitua o `<Modal …>` de importação inteiro por:

```tsx
      {uploadOpen ? (
        <FileImportModal
          title="Importar manifesto de carga solta"
          accept=".xlsx,.xls,.csv"
          parser={parseBreakbulkManifestFile}
          importer={async (manifest, file) => {
            await importBreakbulkManifest({
              filename: file.name,
              voyageId: Number(voyageId),
              manifest,
              uploadedBy: user.id,
            })
            await afterManifestoImportado(queryClient, { voyageId })
            showToast('Manifesto BB importado com sucesso.', 'success')
          }}
          canImport={(manifest) => manifest.bls.length > 0}
          ready={Boolean(voyageId)}
          prerequisite={
            <VoyageCombobox
              required
              label="Viagem de destino"
              selectedVoyageId={voyageId}
              onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
            />
          }
          renderPreview={(manifest) => <BreakbulkPreview manifest={manifest} />}
          helper={
            <div className="app-panel app-panel--padded">
              {/* Cole aqui os dois links de download de modelo que ja existiam no modal */}
            </div>
          }
          onClose={() => {
            setUploadOpen(false)
          }}
        />
      ) : null}
```

Os argumentos de `importBreakbulkManifest` e a mensagem de sucesso vêm do `handleImport` atual (`src/pages/CargaSolta.tsx:185-199`) — confira antes de colar:

```bash
grep -n "parseBreakbulkManifestFile\|importBreakbulkManifest" src/pages/CargaSolta.tsx
```

**A invalidação não pode encolher.** O `handleImport` atual invalida `bls`, `voyages` **e** `port-options` — um manifesto pode introduzir portos novos, e perder `port-options` deixaria os filtros de porto obsoletos. `afterManifestoImportado` (Task 2) cobre as três mais o que a Viagem deriva; é por isso que o `importer` acima chama o evento em vez de uma chave literal.

Acrescente o import:

```tsx
import { FileImportModal } from '../components/shared/FileImportModal'
import { afterManifestoImportado } from '../services/cacheEffects'
```

**Dependência:** este step usa `afterManifestoImportado`, criado na Task 2. Se estiver executando a Fase 3 isoladamente, faça a Task 2 antes.

- [ ] **Step 4: Rode os testes e o build**

```bash
npx vitest run src/pages/__tests__
npm run typecheck
npm run build
```

Esperado: PASS. Se `ParsedBreakbulkManifest` ficar sem uso no arquivo, o `lint` acusa — remova o import de tipo.

- [ ] **Step 5: Repita para `src/pages/VaziosImportacao.tsx`**

Mesmo movimento, com os nomes desta página:

```bash
grep -n "useState\|parseVazios\|importVazios\|VoyageCombobox" src/pages/VaziosImportacao.tsx
```

O pré-requisito é o mesmo `VoyageCombobox`; o preview é o bloco `{manifest ? … : null}` extraído para um `VaziosImportacaoPreview`.

- [ ] **Step 6: Confirme a redução**

```bash
grep -c "setParsing" src/pages/CargaSolta.tsx src/pages/VaziosImportacao.tsx
```

Esperado: `0` nos dois.

- [ ] **Step 7: Rode a suíte e o build**

```bash
npm test
npm run build
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/CargaSolta.tsx src/pages/VaziosImportacao.tsx
git commit -m "refactor(import): CargaSolta e VaziosImportacao adotam FileImportModal"
```

---

### Task 16: Atualizar o playbook de parsers

O `CLAUDE.md` exige que o playbook mude no mesmo change. Ele é o mecanismo que impede a deriva de voltar.

**Files:**
- Modify: `skills/import-parser/SKILL.md`
- Modify: `docs/RASTREABILIDADE.md` (linha de `/carga-solta`, L56)

- [ ] **Step 1: Reescreva o passo de leitura no playbook**

Em `skills/import-parser/SKILL.md`, substitua o passo que hoje descreve ler a planilha com `XLSX.read` direto por:

```markdown
### 1. Leia a planilha pelo seam

Nunca chame `XLSX.read` num parser novo. Use `readSheet` de
`src/services/importCore.ts`:

```ts
import { matchHeaders, readSheet, type HeaderSpec } from './importCore'

const SPEC: HeaderSpec<'container' | 'tipo'> = {
  aliases: {
    container: ['container', 'conteiner', 'n container'],
    tipo: ['tipo', 'type'],
  },
  required: ['container', 'tipo'],
}

const { headers, rows } = await readSheet(buffer)
const { columnByField, missing } = matchHeaders(headers, SPEC)
if (missing.length) throw new Error(`Colunas obrigatorias ausentes: ${missing.join(', ')}.`)
```

`readSheet` devolve a data como **texto** por padrão. Se o seu formato precisa
de `Date` ou de valor numérico cru, diga isso na chamada — e só então:

```ts
await readSheet(buffer, { dates: 'date' })   // ex.: containerDatesImport
await readSheet(buffer, { values: 'cru' })   // ex.: vesselScheduleImport
```

A opção é uma **decisão documentada**. Passar opções do `xlsx` por fora é a
deriva que este seam existe para impedir: antes dele, sete parsers usavam
cinco combinações diferentes de `cellText`/`cellDates`/`raw`, e a diferença
decidia silenciosamente se uma data chegava como `Date` ou como `string`.

### 2. Monte a UI pelo seam

Nunca reconstrua o trio `file` / `parsing` / `importing` numa página nova.
Use `FileImportModal` (`src/components/shared/FileImportModal.tsx`) — ele é
dono da máquina de estado arquivo → preview → confirmação, do lote e dos erros
por arquivo. O contexto da importação vai em `subtitle` (opcional).
```

- [ ] **Step 2: Atualize a rastreabilidade**

Em `docs/RASTREABILIDADE.md`, a linha de `/carga-solta` (L56) já cita `importCore.ts`. Acrescente `FileImportModal` à coluna de componentes dela e da linha de `/vaziosimportacao`, já que as duas passaram a usá-lo.

- [ ] **Step 3: Rode o gate**

```bash
npm run docs:check
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add skills/import-parser/SKILL.md docs/RASTREABILIDADE.md
git commit -m "docs: playbook de parser passa a exigir readSheet e FileImportModal"
```

---

# Fase 4 — Cobertura dos dois serviços grandes sem teste

Achado adjacente do relatório, não arquitetural: `src/services/charges/` tem **626 linhas no coração das Taxas Locais e zero arquivos de teste**, e `fetchLineUpSnapshot` (427 das 521 linhas de `lineup.ts`) nunca é exercido. São perfeitamente testáveis — 59 arquivos de teste do projeto já mockam `supabase` com `vi.mock`.

---

### Task 17: Cobrir `chargeOperationsService`

**Files:**
- Create: `src/services/charges/__tests__/chargeOperationsService.test.ts`

- [ ] **Step 1: Encontre o padrão de mock do projeto**

```bash
grep -rln "vi.mock('../supabase')\|vi.mock('../../lib/supabase')" src/services/__tests__ | head -3
```

Abra um deles e **copie o formato do duble** — não invente um novo. O teste abaixo assume um duble encadeável de `supabase.from(...)`.

- [ ] **Step 2: Escreva o teste**

Crie `src/services/charges/__tests__/chargeOperationsService.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../../supabase', () => ({ supabase: { from: (table: string) => from(table) } }))

/** Duble encadeavel: qualquer metodo do builder devolve `this`, exceto o await. */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'range', 'eq', 'or', 'ilike', 'in', 'limit', 'overrideTypes']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

describe('listLocalChargeOperationalRows', () => {
  beforeEach(() => {
    from.mockReset()
  })

  it('nao consulta B/Ls quando o filtro pede so granito', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))

    await listLocalChargeOperationalRows({ cargoMode: 'granito' })

    expect(from.mock.calls.map(([table]) => table)).not.toContain('bls')
  })

  it('nao consulta granito quando o filtro pede so container', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))

    await listLocalChargeOperationalRows({ cargoMode: 'container' })

    expect(from.mock.calls.map(([table]) => table)).not.toContain('granite_bls')
  })

  it('propaga o erro do banco em vez de devolver lista vazia', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: null, error: { code: '42501', message: 'permission denied' } }))

    await expect(listLocalChargeOperationalRows({ cargoMode: 'container' })).rejects.toMatchObject({ code: '42501' })
  })

  it('para de paginar quando a pagina volta incompleta', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation((table: string) =>
      builder(table === 'bls' ? { data: [{ id: 'BL1' }], error: null } : { data: [], error: null }),
    )

    await listLocalChargeOperationalRows({ cargoMode: 'container', limit: 5000 })

    // Uma unica pagina de `bls`: a primeira voltou incompleta, entao o loop parou.
    expect(from.mock.calls.filter(([table]) => table === 'bls')).toHaveLength(1)
  })

  it('limita o `limit` recebido a faixa [50, 5000]', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))

    await expect(listLocalChargeOperationalRows({ cargoMode: 'container', limit: 999999 })).resolves.toEqual([])
    await expect(listLocalChargeOperationalRows({ cargoMode: 'container', limit: -1 })).resolves.toEqual([])
  })
})
```

- [ ] **Step 3: Rode**

```bash
npx vitest run src/services/charges/__tests__/chargeOperationsService.test.ts
```

Esperado: PASS. Se o caminho do mock de `supabase` estiver errado, o erro será `Cannot find module '../../supabase'` — corrija para o caminho que os outros testes usam (`grep -rn "from '.*supabase'" src/services/charges/chargeOperationsService.ts` mostra o certo).

- [ ] **Step 4: Commit**

```bash
git add src/services/charges/__tests__/chargeOperationsService.test.ts
git commit -m "test(charges): cobrir listLocalChargeOperationalRows"
```

---

### Task 18: Cobrir `fetchLineUpSnapshot`

**Files:**
- Create: `src/services/__tests__/lineupSnapshot.test.ts`

`fetchLineUpSnapshot` começa por `fetchVoyages()` e, se não houver viagem, faz *short-circuit* (`lineup.ts:85-87`). Todas as leituras — inclusive as de `voyageRouteSchedules` e `voyageExportSchedules` — passam pelo mesmo `supabase`, então mockar só `./supabase` cobre a função inteira, dirigindo o duble pelo nome da tabela.

- [ ] **Step 1: Escreva o teste**

Crie `src/services/__tests__/lineupSnapshot.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../supabase', () => ({ supabase: { from: (table: string) => from(table) } }))

/** Duble encadeavel dirigido por tabela — mesmo padrao do teste de charges. */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'range', 'eq', 'or', 'ilike', 'in', 'limit', 'not', 'overrideTypes']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

/** Responde por tabela; qualquer tabela nao listada devolve lista vazia. */
function byTable(tables: Record<string, unknown[]>) {
  return (table: string) => builder({ data: tables[table] ?? [], error: null })
}

const VOYAGE = {
  id: 24,
  voyage_number: '24W',
  status: 'active',
  vessel: { name: 'MV TESTE' },
  pol: { name: 'Vitoria', locode: 'BRVIX' },
}

describe('fetchLineUpSnapshot', () => {
  beforeEach(() => {
    from.mockReset()
  })

  it('devolve snapshot vazio sem consultar mais nada quando nao ha viagem', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({}))

    const snapshot = await fetchLineUpSnapshot()

    expect(snapshot).toEqual({ rows: [], lastChangedAt: null })
    // Short-circuit: so a leitura de `voyages` aconteceu.
    expect(from.mock.calls.map(([table]) => table)).toEqual(['voyages'])
  })

  it('propaga a recusa do banco em vez de devolver snapshot parcial', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(() => builder({ data: null, error: { code: '42501', message: 'permission denied' } }))

    await expect(fetchLineUpSnapshot()).rejects.toBeTruthy()
  })

  it('monta uma linha de importacao por Escala da viagem', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(
      byTable({
        voyages: [VOYAGE],
        bls: [
          {
            id: 'BL1',
            voyage_id: 24,
            pod: 'BRSSZ',
            cargo_mode: 'carga_solta',
            ce_mercante: 'CE1',
            bb_machine_qty: 2,
            bb_packages_qty: 10,
          },
        ],
        voyage_pod_schedules: [
          { voyage_id: 24, pod: 'BRSSZ', eta: '2026-08-01', etb: null, ata: '2026-08-02', atb: null, atd: null, rtw: null },
        ],
      }),
    )

    const snapshot = await fetchLineUpSnapshot()

    const row = snapshot.rows.find((candidate) => candidate.pod === 'BRSSZ')
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      voyageId: 24,
      voyageNumber: '24W',
      vesselName: 'MV TESTE',
      rowType: 'import',
      ata: '2026-08-02',
      bbMachines: 2,
    })
  })
})
```

**Se o terceiro teste falhar**, é porque o nome da tabela de agendas ou de alguma coluna difere do assumido. Descubra o nome real com:

```bash
grep -n "\.from('" src/services/lineup.ts src/services/voyageRouteSchedules.ts
```

e corrija a chave de `byTable` — **não** relaxe a asserção.

- [ ] **Step 2: Rode**

```bash
npx vitest run src/services/__tests__/lineupSnapshot.test.ts
```

Esperado: PASS — 3 testes.

- [ ] **Step 3: Commit**

```bash
git add src/services/__tests__/lineupSnapshot.test.ts
git commit -m "test(lineup): cobrir fetchLineUpSnapshot"
```

---

# Fase 5 — Fechamento

### Task 19: Verificação completa e ciclo de vida do plano

**Files:**
- Move: `docs/plans/2026-07-27-aprofundamento-arquitetural.md` → `docs/archive/plans/`
- Modify: `docs/plans/README.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Rode todos os gates**

```bash
npm run docs:check
npm run lint
npm run typecheck
npm test
npm run build
```

Esperado: todos PASS. **Não prossiga com nenhum vermelho** — corrija e recommite.

- [ ] **Step 2: Confirme os invariantes que este plano criou**

```bash
# Nenhuma copia de classificacao de permissao sobrou:
grep -rn "isPermissionError" src --include=*.ts --include=*.tsx

# Um unico leitor de planilha (mais o blParser, que fica de fora de proposito):
grep -rln "XLSX.read(" src --include=*.ts

# Viagens.tsx e VoyageVisaoTab nao invalidam mais chave literal:
grep -c "invalidateQueries" src/pages/Viagens.tsx src/components/voyages/VoyageVisaoTab.tsx

# Nenhuma copia da checagem de cabecalho sobrou:
grep -rn "Object.entries(headerMap)" src --include=*.ts

# FileImportModal nao exige mais Viagem:
grep -c "voyageLabel" src/components/shared/FileImportModal.tsx
```

Esperado: primeira sem saída; segunda com `importCore.ts` e `blParser.ts`; terceira `0` nos dois arquivos; quarta sem saída; quinta `0`.

- [ ] **Step 3: Registre a entrega no CHANGELOG**

Em `docs/CHANGELOG.md`, no topo, acrescente:

```markdown
## 2026-07-27 — Aprofundamento arquitetural

- **Seam de invalidação de cache** (`src/services/cacheEffects.ts`): mutações
  passam a declarar o evento de domínio (`afterViagemAlterada`,
  `afterEscalaAlterada`, `afterRotaAlterada`, `afterBaplieImportado`,
  `afterBlRevisado`, `afterManifestoImportado`) em vez de listar query keys.
  Corrige três divergências reais em `Viagens.tsx` (cancelamento não invalidava
  o dashboard, a escala de exportação não invalidava a Linha do Tempo, a rota
  não invalidava o Line-Up) e normaliza o id da Linha do Tempo para string, que
  é como `useVoyageTimeline` a indexa.
- **Leitura da recusa do banco** (`classifyDbError` em `src/lib/errors.ts`):
  substitui sete cópias de `isPermissionError`, das quais só uma tratava JWT
  expirado. `details`/`hint` do Postgres deixam de poder chegar à tela.
  `portalErrorMessage` vira adapter da mesma tabela.
- **Pipeline de importação**: `readSheet` com opções nomeadas substitui cinco
  combinações divergentes de opções do `xlsx`; `HeaderSpec`/`matchHeaders`
  substituem cinco cópias da checagem de coluna faltante; `FileImportModal`
  deixa de exigir `voyageLabel`, ganha slot de pré-requisito (a escolha da
  Viagem que precede o arquivo) e é adotado por `/carga-solta` e
  `/vaziosimportacao`.
- **Cobertura**: primeiros testes de `src/services/charges/` e de
  `fetchLineUpSnapshot`.
```

- [ ] **Step 4: Arquive o plano**

```bash
git mv docs/plans/2026-07-27-aprofundamento-arquitetural.md docs/archive/plans/
```

E remova a linha correspondente da tabela "Planos ativos" em `docs/plans/README.md`.

- [ ] **Step 5: Rode o gate de documentação de novo**

```bash
npm run docs:check
```

Esperado: sem erros (o `docs:check` ignora `archive/`, mas os links **para** o plano a partir de `docs/plans/README.md` precisam ter sumido).

- [ ] **Step 6: Commit e push**

```bash
git add -A docs
git commit -m "docs: arquivar plano de aprofundamento arquitetural e registrar entrega"
git push -u origin claude/project-report-review-5g89go
```

---

## Sequenciamento e independência

As Fases 1, 2 e 4 são independentes entre si. Pontos de atenção:

- **A Task 15 (Fase 3) depende da Task 2 (Fase 1)** — ela usa `afterManifestoImportado`. Se for executar a Fase 3 isoladamente, faça a Task 2 antes.
- **Task 8** toca `src/services/charges/chargeOperationsService.ts` (remove `isPermissionError`) e a **Task 17** cria o teste desse arquivo. Se rodarem em paralelo, execute a Task 8 primeiro.
- **Task 4** e **Task 7–8** ambas tocam `src/components/voyages/VoyageVisaoTab.tsx`, em blocos diferentes do mesmo handler. Execute a Task 4 primeiro.

Dentro de cada fase, a ordem das tasks é obrigatória.

## O que este plano deliberadamente não faz

- **Não migra os 39 arquivos com invalidação literal.** Migra os dois que
  demonstram a divergência (`Viagens.tsx`, `VoyageVisaoTab.tsx`) e deixa a
  regra escrita no playbook para que os demais migrem quando forem tocados.
  Um big bang de 217 call sites não é revisável.
- **Não absorve `reviewCaches.ts` nem `baplieInvalidation.ts`.** Eles são
  re-hospedados como eventos com `ponytail:` nomeando o teto e o upgrade.
- **Não migra as sete telas de importação.** Migra duas — o suficiente para o
  seam ser real — e fecha a porta para telas novas via playbook.
- **Não toca `blParser.ts`.** Ele lê por posição de célula num layout fixo, não
  por cabeçalho; forçá-lo no seam distorceria a interface de `readSheet`.
- **Não abre os candidatos #04 e #05.** Ver "Base de decisão".
