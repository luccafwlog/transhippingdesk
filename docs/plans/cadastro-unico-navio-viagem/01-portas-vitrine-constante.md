# Plan 01: Constante única de portos-vitrine + LOCODEs canônicos

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. When done, update the status row in `../README.md`.
>
> **Drift check (run first)**:
> `git log --oneline -3 -- src/services/portCode.ts src/components/portal/ShipScheduleWidget.tsx src/pages/ChegadasSaidas.tsx`
> If `portCode.ts` changed since 2026-07-09, re-read it before editing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (foundation)
- **Category**: feature (ADR 0021)

## Why this matters

Hoje três lugares repetem, hardcoded, a mesma rota de 8 portos do serviço CSSC:
o widget do Portal (`ShipScheduleWidget.tsx`), o formulário de Chegadas e Saídas
(`ChegadasSaidas.tsx`) e o template de upload em lote. A unificação (planos 03,
04, 06) precisa de **uma** lista compartilhada, ordenada, que diga para cada
porto: rótulo exibido, se é POL (carregamento/ETD) ou POD (descarga/ETA) e o
**código canônico** usado como chave dos schedules da viagem.

O código canônico é crítico: os POL/POD schedules da viagem são chaveados por
`normalizePortCode(porto)` (ver `src/services/voyageRouteSchedules.ts:65-71`).
Um manifesto grava POL como o LOCODE do arquivo (ex.: `CNTAO`). Se Chegadas
gravar `"QINGDAO"` e `normalizePortCode("QINGDAO")` devolver `"QINGDAO"`
(fallback, hoje não mapeado), a projeção do Portal e a deduplicação **não casam**
com o schedule que o manifesto criou para o mesmo porto físico. Por isso este
plano também estende o lookup de `portCode.ts` para os 8 portos do serviço.

## Current state

`src/services/portCode.ts:8-13` mapeia só 4 portos:

```ts
const PORT_NAME_TO_LOCODE: Array<[string, string]> = [
  ['salvador', 'BRSSA'],
  ['vitoria', 'BRVIX'],
  ['taicang', 'CNTAC'],
  ['zhangjiagang', 'CNZJG'],
]
```

Os 8 portos-vitrine (na ordem das colunas atuais do Portal, ver
`ShipScheduleWidget.tsx:91-124`): Qingdao, Shanghai, Taicang, Ningbo, Nansha
(ETD/POL) e Salvador, Vitória, Pecém (ETA/POD).

## Tasks

### Task 1: Descobrir os LOCODEs reais em uso (evita adivinhar)

Os POL/POD schedules já criados por manifestos guardam o código real que o
sistema usa. **Antes de hardcodar**, descubra os códigos reais.

- [ ] **Step 1: Listar os codes de POL/POD já gravados**

Rode contra o banco (via MCP Supabase `execute_sql` ou psql):

```sql
select entity_type, split_part(entity_id, '::', 2) as port_code, count(*)
from audit_logs
where entity_type in ('voyage_pol_schedule', 'voyage_pod_schedule')
group by 1, 2
order by 1, 3 desc;
```

Expected: uma lista de códigos como `CNTAO`, `CNSHA`, `BRSSA`, `BRVIX`, etc.

- [ ] **Step 2: Registrar o mapeamento confirmado**

Preencha esta tabela com o que o Step 1 devolveu (use o código **realmente em
uso**; os valores abaixo são o palpite a confirmar):

| Porto | Tipo | LOCODE (confirmar no Step 1) |
|-------|------|------------------------------|
| Qingdao | POL | CNTAO |
| Shanghai | POL | CNSHA |
| Taicang | POL | CNTAC ✓ (já no lookup) |
| Ningbo | POL | CNNGB |
| Nansha | POL | CNNSA |
| Salvador | POD | BRSSA ✓ |
| Vitória | POD | BRVIX ✓ |
| Pecém | POD | BRPEC |

**STOP condition**: se o Step 1 mostrar, para o mesmo porto físico, dois códigos
divergentes (ex.: metade dos manifestos usa `CNTAO` e metade `QINGDAO`), pare e
reporte — a convergência de código precisa ser decidida antes de seguir, senão
a projeção do Portal ficará furada.

### Task 2: Estender o lookup de `portCode.ts`

**Files:**
- Modify: `src/services/portCode.ts:8-13`
- Test: `src/services/__tests__/portCode.test.ts` (criar se não existir)

- [ ] **Step 1: Escrever o teste que falha**

Crie/edite `src/services/__tests__/portCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizePortCode } from '../portCode'

describe('normalizePortCode — portos-vitrine do serviço CSSC', () => {
  // Use os códigos CONFIRMADOS na Task 1, Step 2.
  const cases: Array<[string, string]> = [
    ['QINGDAO', 'CNTAO'],
    ['SHANGHAI', 'CNSHA'],
    ['NINGBO', 'CNNGB'],
    ['NANSHA', 'CNNSA'],
    ['PECEM', 'BRPEC'],
    ['PECÉM', 'BRPEC'],
  ]
  it.each(cases)('mapeia %s -> %s', (name, code) => {
    expect(normalizePortCode(name)).toBe(code)
  })

  it('mantém os códigos já suportados', () => {
    expect(normalizePortCode('SALVADOR')).toBe('BRSSA')
    expect(normalizePortCode('TAICANG')).toBe('CNTAC')
    expect(normalizePortCode('CNSHA')).toBe('CNSHA') // já-LOCODE passa direto
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/services/__tests__/portCode.test.ts`
Expected: FAIL — `QINGDAO` etc. voltam como `"QINGDAO"` (fallback).

- [ ] **Step 3: Estender o lookup**

Em `src/services/portCode.ts`, substitua o array (use os códigos confirmados):

```ts
// ponytail: lookup à mão dos lanes em uso; os 5 portos do serviço CSSC
// foram adicionados para o cadastro único (ADR 0021) casar com o code que o
// manifesto grava. Upgrade path = dataset UN/LOCODE real se a lista crescer.
const PORT_NAME_TO_LOCODE: Array<[string, string]> = [
  ['salvador', 'BRSSA'],
  ['vitoria', 'BRVIX'],
  ['pecem', 'BRPEC'],
  ['qingdao', 'CNTAO'],
  ['shanghai', 'CNSHA'],
  ['taicang', 'CNTAC'],
  ['ningbo', 'CNNGB'],
  ['nansha', 'CNNSA'],
  ['zhangjiagang', 'CNZJG'],
]
```

Nota: `normalizeText` (usado em `portCode.ts:24`) remove acentos, então `PECÉM`
já vira `pecem` antes do lookup — não precisa de entrada acentuada.

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/services/__tests__/portCode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/portCode.ts src/services/__tests__/portCode.test.ts
git commit -m "feat(ports): mapear os 8 portos-vitrine CSSC para LOCODE canônico"
```

### Task 3: Criar a constante de portos-vitrine

**Files:**
- Create: `src/services/portalScheduleLanes.ts`
- Test: `src/services/__tests__/portalScheduleLanes.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../portalScheduleLanes'

describe('portas-vitrine do Portal', () => {
  it('lista os 8 portos do serviço na ordem das colunas', () => {
    expect(PORTAL_SCHEDULE_LANES.map((l) => l.label)).toEqual([
      'QINGDAO', 'SHANGHAI', 'TAICANG', 'NINGBO', 'NANSHA',
      'SALVADOR', 'VITÓRIA', 'PECÉM',
    ])
  })

  it('classifica origem como POL e destino como POD', () => {
    const byLabel = Object.fromEntries(PORTAL_SCHEDULE_LANES.map((l) => [l.label, l.kind]))
    expect(byLabel['QINGDAO']).toBe('pol')
    expect(byLabel['SALVADOR']).toBe('pod')
  })

  it('deriva o code canônico via normalizePortCode', () => {
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[0])).toBe('CNTAO') // Qingdao
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[5])).toBe('BRSSA') // Salvador
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/services/__tests__/portalScheduleLanes.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Criar o módulo**

```ts
import { normalizePortCode } from './portCode'

export type PortalScheduleLaneKind = 'pol' | 'pod'

export type PortalScheduleLane = {
  /** Nome exibido na coluna e no rótulo do campo. */
  label: string
  /** POL = origem (ETD); POD = destino (ETA). */
  kind: PortalScheduleLaneKind
}

// Rota do serviço CSSC ECSA, na ordem das colunas do quadro do Portal.
// Fonte única consumida por: widget do Portal (04), formulário de Chegadas e
// Saídas (03) e upload em lote (06). Estável o suficiente para ser constante
// (ADR 0021, alternativa "tabela configurável" rejeitada por YAGNI).
export const PORTAL_SCHEDULE_LANES: readonly PortalScheduleLane[] = [
  { label: 'QINGDAO', kind: 'pol' },
  { label: 'SHANGHAI', kind: 'pol' },
  { label: 'TAICANG', kind: 'pol' },
  { label: 'NINGBO', kind: 'pol' },
  { label: 'NANSHA', kind: 'pol' },
  { label: 'SALVADOR', kind: 'pod' },
  { label: 'VITÓRIA', kind: 'pod' },
  { label: 'PECÉM', kind: 'pod' },
]

/** Code canônico do lane (chave dos POL/POD schedules da viagem). */
export function portalLaneCode(lane: PortalScheduleLane): string {
  return normalizePortCode(lane.label) ?? lane.label.toUpperCase()
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/services/__tests__/portalScheduleLanes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/portalScheduleLanes.ts src/services/__tests__/portalScheduleLanes.test.ts
git commit -m "feat(portal): constante única de portos-vitrine (ADR 0021)"
```

## Docs to update

Nenhuma neste plano (a constante é consumida pelos planos seguintes). O
`docs/modules/chegadas-saidas.md` é atualizado no plano 03.

## STOP conditions

- Step 1 da Task 1 revela códigos divergentes para o mesmo porto (ver acima).
- `normalizePortCode` já é usado em caminho de faturamento/EDI; se algum teste
  fora de escopo quebrar com o lookup estendido, pare e reporte — pode haver um
  porto cujo nome colide com outro lane.
