# Plan 05: Tela Viagens ganha campos POL/ETD no cadastro

> **Executor instructions**: Follow step by step. Run every verification. Update
> the status row in `../README.md` when done.
>
> **Drift check (run first)**:
> `git log --oneline -3 -- src/components/shared/VoyageCreateModal.tsx src/services/voyageForm.ts src/services/voyages.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 01 (para reusar códigos de porto, opcional)
- **Category**: feature (ADR 0021)

## Why this matters

O ADR 0021 diz: viagens de rota diferente do serviço CSSC continuam nascendo na
tela Viagens, que **ganha os campos de POL/ETD hoje ausentes**. Hoje o
`VoyageCreateModal` só expõe PODs (`dischargePortEtas`); os POLs só entram pelo
manifesto (`syncManifestPolEtdSchedules`). Para paridade com o cadastro por
Chegadas (que grava POL/ETD), o cadastro manual precisa poder informar POLs.

## Current state

- `VoyageFormValues` (`src/services/voyageForm.ts:11-19`) tem `dischargePortEtas`
  mas nenhum campo de POL.
- `VoyageCreateModal` (`src/components/shared/VoyageCreateModal.tsx:181-233`)
  renderiza só o bloco de portos de descarga.
- `createVoyage`/`updateVoyage` chamam `syncDischargePortEtas` (PODs). Não há
  sync de POLs no cadastro manual.

## Tasks

### Task 1: Adicionar `loadPortEtds` (POL) ao form model

**Files:**
- Modify: `src/services/voyageForm.ts`
- Test: `src/services/__tests__/voyageForm.test.ts` (criar se não existir)

- [ ] **Step 1: Teste que falha** — normalização de POLs (upper/trim, descarta
  linhas sem porto):

```ts
import { describe, expect, it } from 'vitest'
import { initialVoyageFormValues, normalizeVoyageFormValues } from '../voyageForm'

describe('voyageForm — portos de carregamento (POL)', () => {
  it('normaliza e descarta POLs vazios', () => {
    const out = normalizeVoyageFormValues({
      ...initialVoyageFormValues,
      vesselName: 'NAVIO', voyageNumber: '1', carrierName: 'Cosco',
      loadPortEtds: [
        { pol: ' cntao ', etd: '2026-01-04' },
        { pol: '', etd: '' },
      ],
    })
    expect(out.loadPortEtds).toEqual([{ pol: 'CNTAO', etd: '2026-01-04' }])
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npx vitest run src/services/__tests__/voyageForm.test.ts`

- [ ] **Step 3: Implementar** — em `voyageForm.ts`:
  - Adicionar `loadPortEtds: Array<{ pol: string; etd: string }>` a
    `VoyageFormValues`, `initialVoyageFormValues` (`[]`) e ao `voyageFormSchema`
    (`z.array(z.object({ pol: z.string(), etd: z.string() }))`).
  - Em `normalizeVoyageFormValues`, adicionar `loadPortEtds:
    normalizeLoadPortEtds(values.loadPortEtds)` espelhando `normalizeDischargePortEtas`
    (upper/trim no `pol`, descartar linhas totalmente vazias, dedup por `pol`).

- [ ] **Step 4: Rodar (passa)**

- [ ] **Step 5: Commit** — `git commit -m "feat(voyage-form): campos de POL/ETD no modelo do formulário"`

### Task 2: Persistir POLs em `createVoyage`/`updateVoyage`

**Files:**
- Modify: `src/services/voyages.ts`
- Test: `src/services/__tests__/voyages.pol.test.ts`

- [ ] **Step 1: Teste que falha** — `createVoyage` grava POL via
  `saveVoyagePolSchedule` (mock, padrão do repo). Espelhe o mock de
  `voyageRouteSchedules` e verifique que, dado `loadPortEtds: [{pol:'CNTAO',
  etd:'2026-01-04'}]`, `saveVoyagePolSchedule` é chamado com
  `{ voyageId, pol:'CNTAO', etd:'2026-01-04' }`.

- [ ] **Step 2: Rodar (falha)**

- [ ] **Step 3: Implementar** — adicionar `syncLoadPortEtds(voyageId, form,
  changedBy)` em `voyages.ts`, análogo a `syncDischargePortEtas` (linhas 116-141)
  mas chamando `saveVoyagePolSchedule({ voyageId, pol, etd, changedBy })` por
  linha. Chamá-la em `createVoyage` (após `syncDischargePortEtas`, linha 30) e em
  `updateVoyage` (após linha 63).

- [ ] **Step 4: Rodar (passa)**

- [ ] **Step 5: Commit** — `git commit -m "feat(voyage): persistir POL/ETD no cadastro manual da viagem"`

### Task 3: UI do bloco POL no modal

**Files:**
- Modify: `src/components/shared/VoyageCreateModal.tsx`
- Modify: `src/pages/Viagens.tsx` (`makeVoyageInitialValues:434-458` — incluir
  `loadPortEtds` ao pré-preencher edição)

- [ ] **Step 1**: Duplicar o bloco "Portos de descarga" (`VoyageCreateModal.tsx:181-233`)
  para um bloco "Portos de carregamento (POL)" acima dele, operando sobre
  `form.loadPortEtds` com handlers `updateLoadPort`/`addLoadPort`/`removeLoadPort`
  espelhando os de descarga (105-126). Campo de data `type="date"` para o ETD.

- [ ] **Step 2**: `makeVoyageInitialValues` passa a receber e devolver
  `loadPortEtds` (a partir dos POL schedules já carregados na página, se houver;
  senão `[]`).

- [ ] **Step 3: Typecheck + teste** — `npx tsc --noEmit` e rode os testes de
  `VoyageCreateModal`/`Viagens` existentes. Ajuste snapshots/asserts se houver.

- [ ] **Step 4: Commit** — `git commit -m "feat(viagens): bloco de portos de carregamento (POL) no modal de cadastro"`

## Docs to update

- `docs/modules/viagens.md` e `docs/RASTREABILIDADE.md`: o cadastro manual agora
  informa POL/ETD.
- Rodar `npm run docs:check`.

## STOP conditions

- `updateVoyage` não deve **apagar** POLs vindos de manifesto ao salvar edição
  com `loadPortEtds` vazio — `syncLoadPortEtds` deve seguir a semântica de
  `syncDischargePortEtas` (só grava o que foi informado; ver `voyages.ts:117`
  `if (!form.dischargePortEtas.length) return`). Confirme esse early-return no
  POL também, senão pare e reporte (risco de perda de dado).
