# WS2 — Escalas: ciclo de datas, estado derivado, Painel e Line-Up TV (spec §3, §4, §12, §13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada escala registra o ciclo completo ETA/ATA, ETB/ATB, ETD/ATD; estado `Atracada`/`Concluída` derivado das datas reais; Painel e Line-Up TV aplicam linha verde (ATB sem ATD), precedência ATA→ETA na coluna ETA e fronteira do carrossel presa à primeira escala; ação dedicada de cancelamento de viagem; indicação "ETA vencido — ATA pendente".

**Architecture:** As agendas POD já vivem em `audit_logs` (`src/services/voyageRouteSchedules.ts`) com `eta/etb/ata/atd` — falta `atb` (e `etd` por POD, que a spec inclui no ciclo). O estado derivado e as precedências de exibição são funções puras em `src/lib/escalaState.ts`, consumidas por `VoyageCard`, `Painel.tsx`, `LineUpTVDisplay.tsx` e `src/services/lineup.ts` (que passa a transportar `atb`/`ata` no snapshot). Sem migration de schema: `audit_logs` é insert-only e aceita novos `field_name`s.

**Tech Stack:** React + TypeScript, Vitest, agendas via `audit_logs` (padrão existente), Tailwind para as classes visuais.

**Fontes obrigatórias:** spec §3, §4, §12, §13; `docs/modules/viagens.md` (invariantes 12–15); `docs/modules/operacao-suporte.md` (Painel/Line-Up); `docs/adr/0024` (cancelamento).

**Dependências:** Independente do WS1. O campo ATD do POL (WS1 Task 5) e o `atb` desta WS tocam o mesmo arquivo `voyageRouteSchedules.ts`; execute em branches separados e resolva conflito trivial se necessário.

---

### Task 1: Estado derivado da escala (`deriveEscalaState`)

**Files:**
- Create: `src/lib/escalaState.ts`
- Test: `src/lib/__tests__/escalaState.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { deriveEscalaState, arrivalDisplay } from '../escalaState'

describe('deriveEscalaState', () => {
  it('ATB sem ATD é Atracada', () => {
    expect(deriveEscalaState({ atb: '2026-07-10', atd: null })).toBe('atracada')
  })
  it('ATD preenchido é Concluída (mesmo sem ATB)', () => {
    expect(deriveEscalaState({ atb: '2026-07-10', atd: '2026-07-12' })).toBe('concluida')
    expect(deriveEscalaState({ atb: null, atd: '2026-07-12' })).toBe('concluida')
  })
  it('sem datas reais não há estado derivado', () => {
    expect(deriveEscalaState({ atb: null, atd: null })).toBeNull()
  })
})

describe('arrivalDisplay (precedência ATA → ETA)', () => {
  it('com ATA mostra a data real marcada como efetiva', () => {
    expect(arrivalDisplay({ eta: '2026-07-09', ata: '2026-07-10' })).toEqual({ value: '2026-07-10', isActual: true })
  })
  it('sem ATA volta ao ETA', () => {
    expect(arrivalDisplay({ eta: '2026-07-09', ata: null })).toEqual({ value: '2026-07-09', isActual: false })
  })
  it('sem nenhuma data retorna valor nulo estimado', () => {
    expect(arrivalDisplay({ eta: null, ata: null })).toEqual({ value: null, isActual: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/escalaState.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/escalaState.ts
// Spec §12–§13: estado operacional derivado de fatos, nunca status manual.

export type EscalaState = 'atracada' | 'concluida'

export function deriveEscalaState(input: { atb: string | null; atd: string | null }): EscalaState | null {
  if (input.atd) return 'concluida'
  if (input.atb) return 'atracada'
  return null
}

/** Coluna intitulada ETA: com ATA mostra a data real (verde); removida a ATA, volta ao ETA. */
export function arrivalDisplay(input: { eta: string | null; ata: string | null }) {
  return input.ata
    ? { value: input.ata, isActual: true as const }
    : { value: input.eta, isActual: false as const }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/escalaState.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/escalaState.ts src/lib/__tests__/escalaState.test.ts
git commit -m "feat: estado derivado da escala e precedência ATA→ETA (spec §12–§13)"
```

### Task 2: Agenda POD comporta ATB e ETD

**Files:**
- Modify: `src/services/voyageRouteSchedules.ts` — tipo `VoyagePodSchedule`, `makeEmptyPodSchedule`, `listVoyagePodSchedules` (loop de hidratação, linha ~135), `hydratePodSchedules` (mesma lógica, linha ~527), `saveVoyagePodSchedule` (linha ~258) e o union de `fieldName` (linha ~583: adicionar `'atb'`; `'etd'` para POD)
- Test: `src/services/__tests__/voyageRouteSchedules.test.ts`

- [ ] **Step 1: Write the failing test** — no padrão de mock existente: (a) hidratação lê `field_name='atb'` e `field_name='etd'` (POD); (b) `saveVoyagePodSchedule({ ..., atb: '2026-07-10T08:00', etd: '2026-07-12' })` insere audit rows com notas `'Atualizacao manual de ATB por POD'` e `'Atualizacao manual de ETD por POD'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/__tests__/voyageRouteSchedules.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation** — replique exatamente o padrão dos campos existentes (`ata`):

```typescript
// tipo: atb: string | null; etd: string | null  (+ makeEmptyPodSchedule)
// hidratação (nos DOIS pontos — listVoyagePodSchedules e hydratePodSchedules):
if (row.field_name === 'atb' && !seenFields.has('atb')) current.atb = normalizeDateValue(row.new_value)
if (row.field_name === 'etd' && !seenFields.has('etd')) current.etd = normalizeDateValue(row.new_value)
// saveVoyagePodSchedule: parâmetros atb?: string | null; etd?: string | null e makeAuditRow correspondentes,
// opcionais como escalaNumber (undefined = não tocar), para não forçar callers antigos.
```

**Não** mexa em `computeVoyageStatusFromPods` — conclusão da Viagem continua exigindo ATD de todos os PODs ativos; concluir uma escala não conclui a Viagem (spec §12).

Verifique o trigger `supabase/migrations/046_voyage_schedule_snapshot_trigger.sql`: ele materializa `voyages.pod_schedule_snapshot` a partir dos audit rows. Leia a function do trigger; se ela filtra `field_name` por lista fixa, crie migration nova (próximo número livre) estendendo a lista com `atb`/`etd`. Se ela copia qualquer field, nada a fazer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/__tests__/voyageRouteSchedules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/voyageRouteSchedules.ts src/services/__tests__/voyageRouteSchedules.test.ts
git commit -m "feat: agenda POD comporta ATB e ETD (ciclo completo spec §12)"
```

### Task 3: Modal de agenda POD expõe o ciclo completo

**Files:**
- Modify: `src/components/shared/VoyageScheduleModals.tsx` (`PodScheduleModal`: campos e payload), `src/pages/Viagens.tsx` (props/handler de save)
- Test: `src/components/shared/__tests__/VoyageScheduleModals.test.tsx` (existente — testa normalização e payload)

- [ ] **Step 1: Write the failing test** — no teste de payload do `PodScheduleModal`, inclua `atb` e `etd` preenchidos e asserta que o payload de `saveVoyagePodSchedule` os carrega; campos vazios seguem virando `null`.
- [ ] **Step 2:** Run: `npm test -- src/components/shared/__tests__/VoyageScheduleModals.test.tsx` — Expected: FAIL.
- [ ] **Step 3:** Adicione os inputs `ATB` (par do ETB) e `ETD` (par do ATD) seguindo exatamente o markup dos pares ETA/ATA existentes no modal; ligue ao estado e ao payload. A grade do planejamento em `VoyageCard.tsx` ganha as colunas correspondentes (mesmo padrão visual das colunas atuais).
- [ ] **Step 4:** Run: `npm test -- src/components/shared/__tests__/VoyageScheduleModals.test.tsx` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: modal POD registra ETA/ATA, ETB/ATB e ETD/ATD"`

### Task 4: "ETA vencido — ATA pendente" na Próxima Escala

**Files:**
- Modify: `src/services/voyageSummaries.ts` (onde vive `getProximaEscala`) — adicionar helper puro; `src/components/voyages/VoyageCard.tsx` linha ~184 (exibição)
- Test: `src/services/__tests__/voyageSummaries.omitted.test.ts` ou novo `voyageSummaries.proximaEscala.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { isEtaOverdue } from '../voyageSummaries'

it('ETA no passado sem ATA está vencido', () => {
  expect(isEtaOverdue('2026-07-01', new Date('2026-07-16'))).toBe(true)
})
it('ETA futuro não está vencido', () => {
  expect(isEtaOverdue('2026-08-01', new Date('2026-07-16'))).toBe(false)
})
it('sem ETA não há vencimento', () => {
  expect(isEtaOverdue(null, new Date('2026-07-16'))).toBe(false)
})
```

- [ ] **Step 2:** Run: `npm test -- src/services/__tests__` — Expected: FAIL.
- [ ] **Step 3:** Implementação:

```typescript
export function isEtaOverdue(eta: string | null, now: Date = new Date()): boolean {
  if (!eta) return false
  return new Date(`${eta}T23:59:59`) < now
}
```

No `VoyageCard.tsx`, junto à renderização da próxima escala, quando `isEtaOverdue(proximaEscala.eta)` exiba o texto `ETA vencido — ATA pendente` (badge âmbar no padrão de badges do arquivo). **Não altere** a seleção de `getProximaEscala`: ETA vencido continua sendo a próxima escala (spec §4).

- [ ] **Step 4:** Run: `npm test` (arquivos tocados) — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: próxima escala indica ETA vencido — ATA pendente (spec §4)"`

### Task 5: Snapshot do Line-Up transporta `ata` e `atb`

**Files:**
- Modify: `src/services/lineup.ts` — `LineUpRow` (linha ~41) e a montagem da linha (linha ~171)
- Test: teste existente de lineup em `src/services/__tests__/` (localize com `grep -rl "fetchLineUpSnapshot" src/services/__tests__/`)

- [ ] **Step 1: Write the failing test** — snapshot construído de um schedule com `ata`/`atb` preenchidos expõe `row.ata` e `row.atb`.
- [ ] **Step 2:** Run — Expected: FAIL (campos inexistentes).
- [ ] **Step 3:** Adicione a `LineUpRow`: `ata: string | null; atb: string | null; atd: string | null` e preencha na montagem: `ata: schedule?.ata ?? null, atb: schedule?.atb ?? null, atd: schedule?.atd ?? null` (o `atd` pode já existir — confirme; linhas de exportação usam `null`).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: snapshot do Line-Up transporta ATA/ATB/ATD por escala"`

### Task 6: Painel e Line-Up TV — linha atracada verde e coluna ETA com precedência

**Files:**
- Modify: `src/pages/Painel.tsx` (linha ~25, onde monta `ETA: row.eta`), `src/pages/LineUpTVDisplay.tsx` (linhas ~245, ~357, ~402 — todos os pontos que leem `row.eta`)
- Test: `src/pages/__tests__/Painel.behavior.test.tsx` (existente) e o teste de display se houver

- [ ] **Step 1: Write the failing test** — no `Painel.behavior.test.tsx`, linha com `ata` preenchida renderiza a data da ATA (não a ETA) com classe/atributo de destaque; linha com `atb` sem `atd` recebe a classe de linha atracada; linha com `atd` não recebe.
- [ ] **Step 2:** Run: `npm test -- src/pages/__tests__/Painel.behavior.test.tsx` — Expected: FAIL.
- [ ] **Step 3:** Em cada ponto de leitura troque `row.eta` por `arrivalDisplay({ eta: row.eta, ata: row.ata })` de `src/lib/escalaState.ts`; `isActual` aplica `text-green-600` na data (título da coluna permanece `ETA`). Para a linha: `deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada'` aplica fonte verde à linha inteira **exceto** células de CEs e Linked (badges preservam cores próprias — aplique a classe por célula, pulando essas duas). O indicador `Início do ciclo` (`LineUpTVDisplay.tsx` linhas ~187/~402, `formatDisplayLeadDate('ETA', row.eta)`) usa a mesma `arrivalDisplay`.
- [ ] **Step 4:** Run: `npm test -- src/pages/__tests__/Painel.behavior.test.tsx` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: Painel/Line-Up TV com linha atracada verde e precedência ATA→ETA"`

### Task 7: Fronteira do carrossel presa à primeira escala

**Files:**
- Modify: `src/pages/LineUpTVDisplay.tsx` (render das linhas do board e dos cards mobile) e o CSS associado (procure `app-lineup-display-board` em `src/`)
- Test: teste de render do display, se existir; senão, validação visual via skill `design-audit`/`run`

- [ ] **Step 1:** Identifique a linha que é a primeira na ordem do ciclo (índice 0 do array ordenado). Aplique uma classe `app-lineup-display-board__row--cycle-start` que desenha `border-top` destacada (2px, cor de destaque do tema) **na própria linha**, de modo que a borda viaja com ela durante a animação do carrossel — não uma borda em posição fixa da viewport. Como o carrossel repete linhas, aplique em toda ocorrência da primeira escala.
- [ ] **Step 2:** No mobile (render de cards estáticos, linha ~357), a mesma classe aparece antes do card da primeira escala.
- [ ] **Step 3:** O texto `Início do ciclo` do cabeçalho (linha ~187) permanece.
- [ ] **Step 4:** Validação visual: use a skill `run` para subir o app e conferir desktop + mobile contra a referência da spec §13 (borda entre `GREEN SANTOS / 16` e `ZYHY JIN QU / 39`).
- [ ] **Step 5:** Commit: `git commit -m "feat: fronteira do ciclo acompanha a primeira escala no Line-Up TV"`

### Task 8: Ação dedicada de cancelamento de viagem

**Files:**
- Modify: `src/pages/Viagens.tsx` / `src/components/voyages/VoyageCard.tsx` (onde hoje a edição genérica de status permite `cancelled`), `src/services/voyages.ts`
- Test: `src/services/__tests__/voyageRouteSchedules.test.ts` já cobre o guard de ATD × cancelada; adicionar teste do novo serviço

- [ ] **Step 1: Write the failing test** — `cancelVoyage({ voyageId, reason, changedBy })` grava status `cancelled` e um audit row com o motivo (`entity_type='voyages'`, `field_name='status'`, nota contendo o motivo).
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implemente `cancelVoyage` em `src/services/voyages.ts` (update + audit, padrão do arquivo). Na UI, substitua a seleção genérica de `cancelled` por ação "Cancelar viagem" com `useConfirm` (`src/components/ui/ConfirmDialog.tsx`) exigindo motivo (campo texto no diálogo ou prompt dedicado). ADR 0024: cancelamento é estado retido; reativação está fora de escopo desta spec.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: ação dedicada de cancelamento de viagem com motivo e auditoria"`

### Task 9: Documentação e verificação final

**Files:**
- Modify: `docs/modules/viagens.md` (invariantes 12–15 deixam de ser "pendente de implementação"), `docs/modules/operacao-suporte.md` (parágrafos "O código atual ainda não..."), `docs/RASTREABILIDADE.md` (linhas de Painel/Line-Up se afetadas)

- [ ] **Step 1:** Atualize os documentos vivos: comportamento aprovado agora é comportamento implementado.
- [ ] **Step 2:** Run: `npm run docs:check && npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 3:** Confira spec §3, §4, §12, §13 critério a critério; validação visual do Painel e Line-Up TV desktop/mobile (skill `run`).
- [ ] **Step 4:** Commit: `git commit -m "docs: escalas com ciclo completo e regras visuais implementadas"`
