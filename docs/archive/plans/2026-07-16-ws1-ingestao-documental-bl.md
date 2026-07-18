# WS1 — Ingestão documental B/L (spec §1, §2, §8, §10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o arquivo de B/L a fonte documental única da carga de container: aliases de navio na validação, `Laden on Board` → ATD do POL (menor data vence), razão social do consignatário e remoção do importador de Manifesto CNTR + Gerar EDI Mercante.

**Architecture:** Lógica pura em `src/lib/` (aliases, razão social) testada isolada; o preview/import de B/L (`src/services/blFreightImport.ts`) consome essas funções; agendas POL vivem em `audit_logs` via `src/services/voyageRouteSchedules.ts`, que ganha o campo `atd`. Remoções de legado seguem a ADR 0025 (código deletado, migrations históricas preservadas, RPC revogada por migration nova).

**Tech Stack:** React + TypeScript, Vitest (`npm test -- <arquivo>`), Supabase (RPCs SQL em `supabase/migrations/`, nomenclatura sequencial — próximo número livre era `199` na escrita deste plano; confirme com `ls supabase/migrations | tail -1`).

**Fontes obrigatórias antes de começar:** `docs/spec/refinamento-operacional-viagens-importacoes-lineup-portal.md` (§1, §2, §8, §10), `docs/adr/0025-bl-fonte-documental-unica-container-atd-pol.md`, skill `import-parser` (`.claude/skills/`), skill `supabase-migration`.

---

### Task 1: Alias de nome de navio (`canonicalizeVesselName`)

**Files:**
- Create: `src/lib/vesselAlias.ts`
- Test: `src/lib/__tests__/vesselAlias.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { canonicalizeVesselName } from '../vesselAlias'

describe('canonicalizeVesselName', () => {
  it('expande ZYHY como prefixo completo', () => {
    expect(canonicalizeVesselName('ZYHY JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
  })
  it('expande CS e C.S. como prefixo completo', () => {
    expect(canonicalizeVesselName('CS ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('C.S. ALGOL')).toBe('COSCO SHIPPING ALGOL')
  })
  it('é idempotente sobre a forma canônica (bidirecional via canonicalização dos dois lados)', () => {
    expect(canonicalizeVesselName('ZHONG YUAN HAI YUN JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
    expect(canonicalizeVesselName('COSCO SHIPPING ALGOL')).toBe('COSCO SHIPPING ALGOL')
  })
  it('não expande alias concatenado ou no meio do nome', () => {
    expect(canonicalizeVesselName('CSALGOL')).toBe('CSALGOL')
    expect(canonicalizeVesselName('NAVIO CS ALGOL')).toBe('NAVIO CS ALGOL')
  })
  it('normaliza caixa, acentos e espaços antes de comparar', () => {
    expect(canonicalizeVesselName('  zyhy jin qu ')).toBe('ZHONG YUAN HAI YUN JIN QU')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/vesselAlias.test.ts`
Expected: FAIL — `Cannot find module '../vesselAlias'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/vesselAlias.ts
// Aliases de prefixo de nome de navio (CONTEXT.md "Alias de Nome de Navio", spec §2).
// A canonicalização existe só para comparação de identidade; nunca altera o nome exibido.

const VESSEL_PREFIX_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'ZHONG YUAN HAI YUN', aliases: ['ZYHY'] },
  { canonical: 'COSCO SHIPPING', aliases: ['CS', 'C.S.'] },
]

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

/** Expande um alias de prefixo para a forma canônica. Retorna o nome normalizado. */
export function canonicalizeVesselName(name: string): string {
  const normalized = normalize(name)
  for (const { canonical, aliases } of VESSEL_PREFIX_ALIASES) {
    for (const alias of aliases) {
      const aliasNorm = normalize(alias)
      // alias deve ser token inicial completo, separado por espaço do restante
      if (normalized === aliasNorm) return canonical
      if (normalized.startsWith(`${aliasNorm} `)) {
        return `${canonical} ${normalized.slice(aliasNorm.length + 1)}`
      }
    }
  }
  return normalized
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/vesselAlias.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/vesselAlias.ts src/lib/__tests__/vesselAlias.test.ts
git commit -m "feat: canonicalização de aliases de prefixo de navio (spec §2)"
```

### Task 2: Usar aliases na validação navio/viagem do Importar B/L

**Files:**
- Modify: `src/services/blFreightImport.ts` — função `getDeclaredVoyageMismatchReason` (~linha 593) e imports no topo
- Test: `src/services/__tests__/blFreightImport.test.ts` (arquivo existente; adicionar casos)

- [ ] **Step 1: Write the failing test** — no describe existente de preview do `blFreightImport.test.ts`, adicione um caso que monta um `ParsedBLDocument` com `route.vessel = 'ZYHY JIN QU'` e viagem selecionada `vesselName = 'ZHONG YUAN HAI YUN JIN QU'`, mesmo `voyageNumber`, e asserta que `blockedReasons` NÃO contém a mensagem `Arquivo e da viagem`. Adicione o caso inverso (`CSALGOL` vs `COSCO SHIPPING ALGOL`) assertando que a linha fica `blocked`. Siga o padrão de fixture já usado nos testes existentes desse arquivo (procure por `buildBlFreightPreview` nos testes atuais e copie a fixture mínima).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/__tests__/blFreightImport.test.ts`
Expected: FAIL no caso ZYHY (hoje `normalizeText('ZYHY JIN QU') !== normalizeText('ZHONG YUAN HAI YUN JIN QU')` gera bloqueio)

- [ ] **Step 3: Write minimal implementation** — em `blFreightImport.ts`:

```typescript
import { canonicalizeVesselName } from '../lib/vesselAlias'

// dentro de getDeclaredVoyageMismatchReason, troque a comparação de vessel:
const vesselMismatch = Boolean(
  doc.route.vessel
  && selectedVoyage.vesselName
  && canonicalizeVesselName(doc.route.vessel) !== canonicalizeVesselName(selectedVoyage.vesselName),
)
// voyageMismatch permanece com normalizeText — número de viagem não tem alias.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/__tests__/blFreightImport.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/blFreightImport.ts src/services/__tests__/blFreightImport.test.ts
git commit -m "feat: validação navio/viagem do Importar B/L aceita aliases de prefixo"
```

### Task 3: Razão social do consignatário (`extractConsigneeShortName`)

**Files:**
- Create: `src/lib/consigneeName.ts`
- Test: `src/lib/__tests__/consigneeName.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { extractConsigneeShortName } from '../consigneeName'

describe('extractConsigneeShortName', () => {
  it('termina inclusivamente na natureza jurídica', () => {
    expect(extractConsigneeShortName('QA IMPORTADORA LTDA\nRUA X, 100\nVITORIA ES')).toBe('QA IMPORTADORA LTDA')
    expect(extractConsigneeShortName('ACME COMERCIO EXTERIOR S.A. AV BRASIL 1')).toBe('ACME COMERCIO EXTERIOR S.A.')
  })
  it('reconhece combinações como LTDA EPP', () => {
    expect(extractConsigneeShortName('FOO BAR LTDA EPP\nCEP 29000-000')).toBe('FOO BAR LTDA EPP')
  })
  it('reconhece EIRELI, EI, MEI, SLU, EPP, ME', () => {
    expect(extractConsigneeShortName('JOAO SILVA MEI TEL 27 99999')).toBe('JOAO SILVA MEI')
    expect(extractConsigneeShortName('BETA TRADE EIRELI\nBRASIL')).toBe('BETA TRADE EIRELI')
  })
  it('sem natureza jurídica reconhecida usa a primeira linha não vazia', () => {
    expect(extractConsigneeShortName('\n  \nGAMMA GLOBAL TRADING\nRUA Y')).toBe('GAMMA GLOBAL TRADING')
  })
  it('não inclui endereço, telefone, CEP, cidade ou país após o marcador', () => {
    expect(extractConsigneeShortName('DELTA LOG LTDA CNPJ 11.444.777/0001-61 VITORIA BRAZIL')).toBe('DELTA LOG LTDA')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/consigneeName.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/consigneeName.ts
// Razão social curta do consignatário (CONTEXT.md, spec §8). O bloco completo
// permanece intacto em consignee_block para EDI e auditoria.

// Marcadores de natureza jurídica; combinações são cobertas por repetição gulosa.
const LEGAL_SUFFIX = /\b(LTDA|S[./]?A\.?|EIRELI|EI|MEI|SLU|EPP|ME)\b\.?/g

export function extractConsigneeShortName(block: string): string {
  const firstLine = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''

  let lastEnd = -1
  LEGAL_SUFFIX.lastIndex = 0
  for (let m = LEGAL_SUFFIX.exec(firstLine); m; m = LEGAL_SUFFIX.exec(firstLine)) {
    // só estende se o próximo marcador é adjacente ao nome já capturado
    // (combinações tipo "LTDA EPP"); marcador isolado depois de outro texto não conta
    if (lastEnd === -1 || firstLine.slice(lastEnd, m.index).trim() === '') {
      lastEnd = m.index + m[0].length
    } else break
  }
  if (lastEnd === -1) return firstLine
  return firstLine.slice(0, lastEnd).trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/consigneeName.test.ts`
Expected: PASS (5 tests). Se o caso `S.A.` falhar por fronteira de regex, ajuste `LEGAL_SUFFIX` mantendo os testes como contrato.

- [ ] **Step 5: Commit**

```bash
git add src/lib/consigneeName.ts src/lib/__tests__/consigneeName.test.ts
git commit -m "feat: extrator de razão social do consignatário (spec §8)"
```

### Task 4: Consumir razão social no preview do B/L

**Files:**
- Modify: `src/services/blFreightImport.ts` — construção do payload (função que monta `BlFreightRpcPayload`, campo `consignee`, ~linha 329 em diante)
- Test: `src/services/__tests__/blFreightImport.test.ts`

- [ ] **Step 1: Write the failing test** — caso no teste de preview: documento com `consigneeBlock: 'QA IMPORTADORA LTDA\nRUA X, 100'` deve produzir `payload.consignee === 'QA IMPORTADORA LTDA'` e `payload.consignee_block` com o bloco completo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/__tests__/blFreightImport.test.ts`
Expected: FAIL (hoje `consignee` carrega o valor bruto do parser)

- [ ] **Step 3: Write minimal implementation** — no ponto onde o payload define `consignee`, aplique:

```typescript
import { extractConsigneeShortName } from '../lib/consigneeName'
// ...
consignee: doc.parties.consigneeBlock ? extractConsigneeShortName(doc.parties.consigneeBlock) : null,
consignee_block: doc.parties.consigneeBlock || null, // inalterado
```

Verifique também `findMatchedCustomer`/`loadCustomerMaps` (`src/services/customerReconciliation.ts`): a reconciliação por nome deve receber o nome curto. Se ela já recebe `consignee`, nada muda; se recebe o bloco, troque para o nome curto.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/__tests__/blFreightImport.test.ts src/services/__tests__/customerReconciliation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/blFreightImport.ts src/services/__tests__/blFreightImport.test.ts
git commit -m "feat: preview do B/L usa razão social curta do consignatário"
```

### Task 5: ATD do POL na agenda (leitura e escrita)

**Files:**
- Modify: `src/services/voyageRouteSchedules.ts` — `listVoyagePolSchedules` (linha ~75), `saveVoyagePolSchedule` (linha ~229), tipo `VoyagePolSchedule` e `makeEmptyPolSchedule`
- Test: `src/services/__tests__/voyageRouteSchedules.test.ts` (existente)

- [ ] **Step 1: Write the failing test** — seguindo o padrão de mock de `audit_logs` já usado no arquivo de teste, adicione: (a) `listVoyagePolSchedules` hidrata `atd` do `field_name='atd'` mais recente; (b) `saveVoyagePolSchedule({ ..., atd: '2026-07-10' })` insere audit row `field_name='atd'` com nota `'Atualizacao manual de ATD por POL'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/__tests__/voyageRouteSchedules.test.ts`
Expected: FAIL — `atd` não existe em `VoyagePolSchedule`

- [ ] **Step 3: Write minimal implementation**

```typescript
// tipo/empty: adicionar `atd: string | null` a VoyagePolSchedule e makeEmptyPolSchedule({ ..., atd: null })

// listVoyagePolSchedules: no loop, aceitar o campo:
if (row.field_name !== 'etd' && row.field_name !== 'escala_number' && row.field_name !== 'atd') continue
// ...
if (row.field_name === 'atd' && !seenFields.has('atd')) current.atd = normalizeDateValue(row.new_value)

// saveVoyagePolSchedule: parâmetro opcional `atd?: string | null` e:
atd === undefined
  ? null
  : makeAuditRow(POL_ENTITY_TYPE, entityId, 'atd', current.atd, atd, changedBy, 'Atualizacao manual de ATD por POL'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/__tests__/voyageRouteSchedules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/voyageRouteSchedules.ts src/services/__tests__/voyageRouteSchedules.test.ts
git commit -m "feat: agenda POL comporta ATD (audit_logs field atd)"
```

### Task 6: `Laden on Board` alimenta o ATD do POL (menor data vence)

**Files:**
- Create: `src/services/ladenOnBoardAtd.ts`
- Modify: `src/services/blFreightImport.ts` (exportar `ladenOnBoard` por linha no preview — o parser já o lê em `blParser.ts` linha 106) e o fluxo de confirmação do Importar B/L em `src/components/shared/BlImportModal.tsx` (chamada pós-commit, mesmo padrão de `tryAutoIssueInvoice`)
- Test: `src/services/__tests__/ladenOnBoardAtd.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { resolveCanonicalPolAtd } from '../ladenOnBoardAtd'

describe('resolveCanonicalPolAtd', () => {
  it('adota a menor data entre os B/Ls importados', () => {
    expect(resolveCanonicalPolAtd(null, ['2026-07-12', '2026-07-10', '2026-07-15'])).toBe('2026-07-10')
  })
  it('nunca substitui o ATD canônico por data posterior (reimportação)', () => {
    expect(resolveCanonicalPolAtd('2026-07-08', ['2026-07-10'])).toBe('2026-07-08')
  })
  it('substitui quando chega data mais antiga', () => {
    expect(resolveCanonicalPolAtd('2026-07-10', ['2026-07-08'])).toBe('2026-07-08')
  })
  it('sem datas novas mantém o atual', () => {
    expect(resolveCanonicalPolAtd('2026-07-10', [])).toBe('2026-07-10')
    expect(resolveCanonicalPolAtd(null, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/ladenOnBoardAtd.ts
// ADR 0025: Laden on Board do B/L é a fonte documental do ATD do POL.
// Regra: entre B/Ls da mesma Viagem+POL, prevalece automaticamente a data mais antiga.
import { saveVoyagePolSchedule, listVoyagePolSchedules, buildVoyagePolEntityId } from './voyageRouteSchedules'

export function resolveCanonicalPolAtd(currentAtd: string | null, ladenDates: string[]): string | null {
  const candidates = [currentAtd, ...ladenDates].filter((d): d is string => Boolean(d))
  if (!candidates.length) return null
  return candidates.sort()[0] // ISO yyyy-mm-dd ordena lexicograficamente
}

/** Pós-commit do Importar B/L: aplica o menor Laden on Board como ATD do POL. */
export async function applyLadenOnBoardAtd(input: {
  voyageId: number
  ladenByPol: Map<string, string[]> // POL normalizado -> datas ISO dos B/Ls importados
  changedBy: string | null
}) {
  for (const [pol, dates] of input.ladenByPol) {
    const entityId = buildVoyagePolEntityId(input.voyageId, pol)
    const current = (await listVoyagePolSchedules([entityId])).get(entityId)
    const next = resolveCanonicalPolAtd(current?.atd ?? null, dates)
    if (next && next !== (current?.atd ?? null)) {
      await saveVoyagePolSchedule({
        voyageId: input.voyageId,
        pol,
        etd: current?.etd ?? null,
        atd: next,
        changedBy: input.changedBy,
      })
    }
  }
}
```

No `BlImportModal.tsx`, após o loop de confirmação bem-sucedida das RPCs (mesmo lugar que chama `tryAutoIssueInvoice`), monte `ladenByPol` a partir das linhas importadas (`doc.route.pol` normalizado com `normalizePortCode`, `doc.route.ladenOnBoard` convertido para ISO — reutilize o normalizador de data já usado pelo parser) e chame `applyLadenOnBoardAtd`. Invalide também `['voyage-pol-schedules']` e `['voyage-timeline']`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ladenOnBoardAtd.ts src/services/__tests__/ladenOnBoardAtd.test.ts src/components/shared/BlImportModal.tsx src/services/blFreightImport.ts
git commit -m "feat: Laden on Board do B/L alimenta ATD do POL com menor data (ADR 0025)"
```

### Task 7: Exibição do ATD sobre a célula de ETD (verde)

**Files:**
- Modify: `src/components/voyages/VoyageCard.tsx` (aba Escalas & Manifestos, célula de ETD por rota POL) e `src/pages/Viagens.tsx` se a célula for renderizada lá
- Test: `src/components/voyages/__tests__/voyageCardHelpers.test.tsx`

- [ ] **Step 1: Write the failing test** — helper puro `formatPolDeparture(etd, atd)` (crie em `src/components/voyages/voyageCardHelpers.ts` junto aos helpers existentes): com `atd` retorna `{ value: atd, isActual: true }`; sem `atd` retorna `{ value: etd, isActual: false }`.

- [ ] **Step 2: Run test** — Expected: FAIL.

- [ ] **Step 3: Implement** — helper de 4 linhas + na célula: `isActual` aplica classe `text-green-600 font-medium` (siga o padrão de classes Tailwind do arquivo); o título da coluna permanece `ETD`.

```typescript
export function formatPolDeparture(etd: string | null, atd: string | null) {
  return atd ? { value: atd, isActual: true as const } : { value: etd, isActual: false as const }
}
```

- [ ] **Step 4: Run test** — `npm test -- src/components/voyages/__tests__/voyageCardHelpers.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: célula ETD por POL exibe ATD em verde quando conhecido"`

### Task 8: Remover Importar Manifesto CNTR e Gerar EDI Mercante da tela `/manifestos`

**Files:**
- Modify: `src/pages/Manifestos.tsx` (imports das linhas 12/15, botão `Gerar EDI Mercante` ~linha 288, render de `UploadManifestModal` ~576 e `MercanteEdiModal` ~589, estados associados)
- Delete: `src/components/shared/UploadManifestModal.tsx`, `src/components/shared/MercanteEdiModal.tsx`, `src/services/manifestParser.ts`, `src/services/mercanteEdiGenerator.ts`, `src/services/mercanteEdiDownload.ts`, `src/services/manifestOverwritePreview.ts` e seus testes em `src/services/__tests__/` e `src/components/shared/__tests__/`
- **Atenção:** `src/services/manifestImport.ts` também exporta `setImportBatchCeMaster`, usado pela edição de CE Master em `Viagens` (ver `docs/modules/viagens.md`). NÃO delete o arquivo inteiro: remova apenas o caminho de importação CNTR (`import_manifest_with_postprocess_transactional` e funções exclusivas dele), preservando `setImportBatchCeMaster`. `breakbulkImport.ts` usa RPC própria (`import_breakbulk_manifest_transactional`) e não é afetado.

- [ ] **Step 1:** `grep -rn "UploadManifestModal\|MercanteEdiModal\|manifestParser\|mercanteEdiGenerator\|manifestOverwritePreview" src/` e liste todos os consumidores (inclui `VoyageImportActions.tsx` — a remoção da ação CNTR lá é do plano WS4 Task de reorganização; se WS4 ainda não rodou, remova aqui a entrada `cntr` de `VoyageImportActions.tsx` linhas 25 e 221–232 para o build não quebrar).
- [ ] **Step 2:** Remova UI + arquivos + testes exclusivos listados acima; mantenha `manifestImport.ts` reduzido a `setImportBatchCeMaster` (e o que mais `Viagens.tsx` importar dele).
- [ ] **Step 3:** Run: `npm run lint && npm test && npm run build` — Expected: PASS, sem referências órfãs.
- [ ] **Step 4:** Commit: `git commit -m "feat!: remove importador Manifesto CNTR e Gerar EDI Mercante (ADR 0025)"`

### Task 9: Migration — revogar e remover a RPC legada de Manifesto CNTR

**Files:**
- Create: `supabase/migrations/<próximo-número>_drop_import_manifest_cntr_rpc.sql`
- Test: `src/services/__tests__/dropImportManifestCntrMigration.test.ts` (siga o padrão dos testes de contrato SQL existentes, ex.: `blFreightLinesMigration.test.ts`)

- [ ] **Step 1:** Leia a skill `supabase-migration` antes de escrever. A migration:

```sql
-- ADR 0025: Manifesto CNTR deixa de ser fonte de ingestão. A RPC transacional
-- do importador é removida; migrations históricas permanecem preservadas.
DROP FUNCTION IF EXISTS public.import_manifest_with_postprocess_transactional(
  -- copie a assinatura exata de 13 argumentos de supabase/migrations/129_review_gate_hardening.sql
);
```

- [ ] **Step 2:** Teste de contrato: asserta que a function não existe mais no catálogo (padrão dos testes de migration do repo).
- [ ] **Step 3:** Run: `npm test -- src/services/__tests__/dropImportManifestCntrMigration.test.ts` — Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -m "feat!: migration remove RPC import_manifest_with_postprocess_transactional"`

### Task 10: Documentação viva e fixtures

**Files:**
- Modify: `docs/RASTREABILIDADE.md` (linhas marcadas **Divergência documentada** para `/manifestos` e RPC), `docs/modules/manifesto-edi.md` (remover o bloco "Divergência transitória — ADR 0025"), `WORKFLOW.md` §parsers, `test-fixtures/README.md` (remover linha `qa-manifest-cntr.xlsx` e deletar a fixture), `docs/operations/validacao.md` (remover parágrafo do cenário legado)

- [ ] **Step 1:** Atualize cada documento: o que era "condenado/divergência" vira comportamento vigente; remova `test-fixtures/qa-manifest-cntr.xlsx`.
- [ ] **Step 2:** Run: `npm run docs:check` — Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -m "docs: ADR 0025 implementada — remove divergências transitórias de Manifesto CNTR"`

### Task 11: Verificação final do workstream

- [ ] Run: `npm run docs:check && npm run lint && npm test && npm run build` — Expected: tudo PASS.
- [ ] Verifique os critérios de aceite da spec §1, §2, §8, §10 um a um contra o código.
- [ ] Use a skill `verify` para exercitar o fluxo real: importar um B/L de fixture, conferir ATD do POL e razão social na lista.
