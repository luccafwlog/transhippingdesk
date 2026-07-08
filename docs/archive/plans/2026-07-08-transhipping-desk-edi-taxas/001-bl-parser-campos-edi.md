# Plan 001: Parser de B/L captura descrição, volumes, telefone e DG (IMO) para o EDI Mercante

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/archive/plans/2026-07-08-transhipping-desk-edi-taxas/README.md`.
>
> **Drift check (run first)**: `git diff --stat b2461da..HEAD -- src/services/blParser.ts src/services/blFreightImport.ts supabase/migrations/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (migration em RPC transacional de produção)
- **Depends on**: none
- **Category**: feature (fluxo Importar B/L → EDI Mercante)
- **Planned at**: commit `b2461da`, 2026-07-08

## Why this matters

Numa viagem alimentada só por arquivos de B/L (sem manifesto), o EDI Mercante
sai degradado: a descrição da mercadoria do C5 fica vazia, os NCMs do I5 não
são derivados (dependem de `cargo_description`), o trailer `TOTAL: N UNITS` e o
telefone do consignatário não aparecem, e containers de carga perigosa (IMO)
saem sem DG Class/número ONU. A regra de domínio (CONTEXT.md, entrada **B/L**)
é: *"O documento do B/L é um superconjunto do manifesto: toda informação
presente no manifesto existe também no B/L"* — logo tudo isso é parseável do
próprio Excel COSCO do B/L. Este plano fecha a captura; o Plano 003 corrige o
gerador de EDI que consome esses campos.

## Current state

Arquivos e papéis:

- `src/services/blParser.ts` — parser posicional do Excel COSCO "Page 1"
  (células fixas). NÃO captura descrição da mercadoria, total de volumes,
  telefone nem DG Class/UN.
- `src/services/blFreightImport.ts` — monta o payload
  (`buildBlFreightPayload`, linha ~302) e chama a RPC
  `import_bl_freight_transactional`. Containers nascem com
  `is_imo: false, imo_class: null, un_number: null` (linhas 313–316).
- `supabase/migrations/166_bl_import_party_blocks.sql` — versão vigente da RPC
  `import_bl_freight_transactional`. **Já aceita e persiste
  `cargo_description`** quando o payload traz o campo (guard
  `payload ? 'cargo_description'`, linhas 168 e 386). NÃO aceita
  `total_packages`, `packages_unit`, `consignee_phone`.
- `supabase/migrations/161_bls_mercante_party_blocks.sql` — já criou as colunas
  `consignee_phone`, `total_packages`, `packages_unit` (e blocos de partes) em
  `bls`. Nenhuma coluna nova é necessária.
- `src/lib/ncm.ts` — `extractNcmCodes` deriva NCMs de `cargo_description`;
  exclui deliberadamente o padrão `UN NCM.: 3556` (número ONU, não NCM).

Excerto do parser hoje (`src/services/blParser.ts:77-104`):

```ts
  return {
    blNumber: cell(rows, 6, 'AC'),
    parties: {
      shipperBlock: cell(rows, 6, 'A'),
      consigneeBlock: cell(rows, 10, 'A'),
      consigneeTaxId: extractTaxId(cell(rows, 10, 'A')),
      notifyBlock: cell(rows, 14, 'A'),
      alsoNotifyBlock: cell(rows, 14, 'T'),
    },
    ...
    containers: parseContainers(rows),   // linhas físicas a partir da row 47 (0-based 46)
```

Excerto do payload hoje (`src/services/blFreightImport.ts:306-317`):

```ts
    return [{
      container_number: containerNumber,
      seal_number: container.sealNumber,
      type: container.type,
      tare_weight_kg: container.tareKg,
      gross_weight_kg: container.grossWeightKg,
      cbm: container.cbm,
      is_oog: false,
      is_imo: false,
      imo_class: null,
      un_number: null,
    }]
```

### Layout real do Excel COSCO (verificado em 3 arquivos reais de portos e cargas distintos)

Posições estáveis nos 3 arquivos (linhas 1-based, colunas em letra):

| Dado | Posição | Exemplos reais |
|---|---|---|
| Cabeçalho do bloco de descrição | R43, col J = `Description of Goods (If Dangerous Goods, See Clause 21)` | idem nos 3 arquivos |
| **Descrição da mercadoria** | **R44, col J** — célula única multi-linha | `BYD DOLPHIN GS 180EV, 200 UNITS ... NCM : 8703.80.00 \n DG CLASS:9 \n UN NCM: 3556 ...`; `48 PACKAGES (36 IN NUDE PACKING...)`; `TEXTILE PIECE GOODS ... NCM: 5514 ...` |
| Rótulo do total | R46, col A = `TOTAL:` | idem nos 3 |
| **Total de volumes + unidade** | **R46, col C** | `200 UNITS`, `48 PACKAGES`, `672 ROLLS` (com espaços à esquerda) |
| Peso/cubagem totais (cross-check) | R46, col Z (`288140.00 KGS`) e col AF (`2338.800 CBM`) | idem |
| Linhas físicas de container | R47 em diante, col A, separadas por `/` | já parseado hoje |
| Cabeçalhos de página repetidos | ex.: R100/R165/R230 (arquivo de 5 páginas) | o loop atual já os ignora (não casam ISO) |
| Telefone nas partes | dentro dos blocos (R10 A consignee etc.), prefixo `TEL:` quando existe | ex. bloco notify de agente: `TEL:+552721241654` |

Padrões de DG na descrição (arquivo real de veículos elétricos):

```
NCM : 8703.80.00
DG CLASS:9
UN NCM: 3556
```

Atenção: o número ONU aparece com o rótulo idiossincrático `UN NCM:` — por isso
`extractNcmCodes` o exclui da lista de NCMs. O parser de DG deve aceitar
`UN NCM: 3556`, `UN NO. 3556`, `UN 3556` e variantes com `:` ou `.`.

### Vocabulário e decisões que este plano deve honrar

- `CONTEXT.md`, **Flags Operacionais**: *"O B/L declara carga perigosa no nível
  do conhecimento (DG Class e número ONU na descrição da mercadoria),
  aplicando-se inicialmente a todos os containers do B/L; o Baplie refina
  depois quais containers são de fato IMO."* — ou seja: DG extraído da
  descrição aplica-se a TODOS os containers do payload; a preservação de flags
  em reimport (função `preserveExistingContainerPhysicalAttributes`,
  `blFreightImport.ts:394-411`) NÃO deve ser alterada.
- `docs/adr/0017-...md`: perfil IMO/OOG é variável de faturamento — a detecção
  de impacto (`computeBillingImpact`, `blFreightImport.ts:429`) já cobre
  mudança de perfil IMO; não alterar.
- ADR 0016: migrations têm numeração sequencial; a próxima é `171_...`.
- `src/types/database.ts` é **protegido por hook** — não editar à mão. As
  colunas já existem (migration 161) e o padrão do repo para campos ainda não
  regenerados é extensão `Partial<>` local (ver `MercanteBlSource` em
  `src/services/mercanteEdiGenerator.ts:382-395`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Testes (foco) | `npx vitest run src/services/__tests__/blParser.test.ts src/services/__tests__/blFreightImport.test.ts` | all pass |
| Testes (suíte) | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Docs | `npm run docs:check` | "Documentation checks passed" |

## Scope

**In scope** (únicos arquivos a modificar):

- `src/services/blParser.ts`
- `src/services/blFreightImport.ts`
- `supabase/migrations/171_bl_import_edi_fields.sql` (criar)
- `src/services/__tests__/blParser.test.ts`
- `src/services/__tests__/blFreightImport.test.ts`
- `src/services/__tests__/blImportEdiFieldsMigration.test.ts` (criar, opcional — ver Test plan)
- `docs/modules/manifesto-edi.md` (seção "Importar B/L")
- `docs/RASTREABILIDADE.md` (linha do Importar B/L, se listar campos)

**Out of scope** (NÃO tocar, mesmo parecendo relacionado):

- `src/services/mercanteEdiGenerator.ts` — correções do gerador são o Plano 003.
- `src/services/manifestParser.ts` / `manifestImport.ts` — fluxo do manifesto
  não muda aqui.
- `preserveExistingContainerPhysicalAttributes` — a preservação de IMO/OOG em
  reimport é decisão registrada; não enfraquecer.
- `src/lib/ncm.ts` — a regex atual já trata `UN NCM`; NCM continua derivado,
  sem coluna própria.
- Qualquer migration existente (arquivos de migration são protegidos).
- Gatilho de billing — Plano 002.

## Git workflow

- Branch: a designada pelo operador; na ausência, `claude/plan-001-bl-parser-edi`.
- Commits em português, prefixo convencional (`feat:`, `docs:`), mensagem
  explicando o porquê (ver `git log --oneline -10` para o estilo).
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Parser — capturar descrição, total de volumes e DG

Em `src/services/blParser.ts`:

1. Estender `ParsedBLDocument` com:

```ts
  cargo: {
    description: string          // R44 J, texto integral com quebras de linha
    totalPackages: number | null // R46 C → 200
    packagesUnit: string | null  // R46 C → 'UNITS'
    dgClass: string | null       // 'DG CLASS:9' → '9'
    unNumber: string | null      // 'UN NCM: 3556' → '3556'
  }
```

2. Localizar a descrição de forma tolerante a variação de linha: procurar, nas
   rows 40–50, a row cujo col J contém `Description of Goods`; a descrição é a
   col J da **row seguinte**. Fallback: `cell(rows, 44, 'J')`.
3. Localizar o total: procurar nas rows 44–60 a row cujo col A (trim) é
   `TOTAL:`; ler col C e parsear com regex `^\s*(\d[\d.,]*)\s+([A-Z]+)\s*$`
   (ex.: `          200 UNITS` → `200` + `UNITS`). Sem match → ambos `null`.
4. Extrair DG da descrição com as regexes:

```ts
const DG_CLASS_PATTERN = /DG\s*CLASS\s*[:.]?\s*([0-9](?:\.[0-9])?)/i
const UN_NUMBER_PATTERN = /UN\s*(?:NCM|NO\.?|NUMBER)?\s*[:.]?\s*(\d{4})\b/i
```
   - Ambos presentes → carga IMO. Apenas um presente → preencher o que houver
     e ainda considerar IMO (o Mercante exige os dois; o EDI sai com o que
     existir e o operador corrige na conciliação Baplie).

**Verify**: `npx vitest run src/services/__tests__/blParser.test.ts` → pass
(após Step 4 adicionar os casos).

### Step 2: Payload — persistir os novos campos e aplicar DG aos containers

Em `src/services/blFreightImport.ts`:

1. Adicionar ao tipo `BlFreightRpcPayload` (linhas 40–105):
   `cargo_description: string | null`, `total_packages: number | null`,
   `packages_unit: string | null`, `consignee_phone: string | null`.
2. Em `buildBlFreightPayload`:
   - `cargo_description: doc.cargo.description || null`
   - `total_packages: doc.cargo.totalPackages`
   - `packages_unit: doc.cargo.packagesUnit`
   - `consignee_phone`: extrair do bloco do consignatário com
     `/TEL[.:]?\s*([+0-9()\s\-]{8,25})/i` sobre `doc.parties.consigneeBlock`
     (best-effort; ausente → `null`).
   - Containers: quando `doc.cargo.dgClass` ou `doc.cargo.unNumber` presentes,
     criar cada container com `is_imo: true`, `imo_class: doc.cargo.dgClass`,
     `un_number: doc.cargo.unNumber` (substituindo os literais `false/null`
     das linhas 313–316). `is_oog` permanece `false`.
3. NÃO alterar `preserveExistingContainerPhysicalAttributes` — em reimport,
   containers já existentes continuam preservando as flags atuais (Baplie/
   manifesto soberanos); apenas containers novos nascem com o DG do B/L.
4. Adicionar os novos campos ao diff de preview (`diffExistingBl`, linha ~481):
   `addDiff(diffs, 'cargo_description', ...)`, `total_packages`,
   `packages_unit`, `consignee_phone` — todos com `impact=false` (campos
   comerciais, sempre corrigíveis por ADR 0017).
5. Estender `ExistingBl` (linha 107) e o `select` da consulta de existentes
   (linha ~526) com os quatro campos, usando extensão de tipo local se
   `database.ts` ainda não os expõe (padrão `MercanteBlSource`).

**Verify**: `npx vitest run src/services/__tests__/blFreightImport.test.ts` →
pass (após Step 4).

### Step 3: Migration 171 — RPC aceita os novos campos

Criar `supabase/migrations/171_bl_import_edi_fields.sql` com
`CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid)`,
copiando o corpo integral da versão em `166_bl_import_party_blocks.sql` e
aplicando exatamente o padrão que a 166 usou para `cargo_description`:

1. Colunas `total_packages INTEGER`, `packages_unit TEXT`,
   `consignee_phone TEXT` na tmp table (`pg_temp.tmp_bl_freight_import`,
   espelhar linha 85).
2. Extração `NULLIF(bl->>'consignee_phone', '')` etc. no INSERT da tmp
   (espelhar linha 168; `total_packages` com cast `::INTEGER` via
   `NULLIF(bl->>'total_packages','')::INTEGER`).
3. INSERT/UPSERT em `bls` incluindo os três campos, com guard por presença no
   payload no UPDATE (espelhar o CASE da linha 386:
   `CASE WHEN ... t.payload ? 'total_packages' THEN EXCLUDED.total_packages ELSE bls.total_packages END`).
4. Adicionar os três campos a `v_audited_fields` (linha 28) para a auditoria
   de diff continuar cobrindo-os.
5. Cabeçalho comentado no padrão das migrations vizinhas (nº, issue/motivo,
   "assinatura inalterada: CREATE OR REPLACE preserva grants").

Consultar a skill do repositório `.claude/skills/supabase-migration.skill`
antes de escrever (regras de review de migration do projeto).

**Verify**: `npm run docs:check` → pass; se o repo tiver Postgres descartável
disponível (ver `WORKFLOW.md` e testes `*Migration.test.ts`), replay da
migration + teste de upsert (ver Test plan). Sem banco disponível: validar
sintaxe com leitura cuidadosa e marcar no relatório final que o replay ficou
pendente.

### Step 4: Testes

Ver seção Test plan.

**Verify**: `npm test` → all pass.

### Step 5: Documentação viva

- `docs/modules/manifesto-edi.md`, seção "**Importar B/L:**" (linha ~228):
  registrar que o import agora captura descrição da mercadoria (R44/J), total
  de volumes/unidade (R46/C), telefone do consignatário (`TEL:` best-effort) e
  DG Class/ONU da descrição aplicados aos containers criados; citar a
  migration 171.
- `docs/RASTREABILIDADE.md`: atualizar a linha do Importar B/L se ela
  enumerar campos/migrations.

**Verify**: `npm run docs:check` → "Documentation checks passed".

## Test plan

Novos casos em `src/services/__tests__/blParser.test.ts` (usar o builder
sintético de planilha já existente no arquivo como padrão estrutural —
função que monta `rows` e converte com `XLSX.utils`):

1. Descrição multi-linha em R44/J é capturada integralmente.
2. `TOTAL:` em R46/A com `   200 UNITS` em R46/C → `{ totalPackages: 200, packagesUnit: 'UNITS' }`.
3. Descrição com `NCM : 8703.80.00`, `DG CLASS:9`, `UN NCM: 3556` →
   `{ dgClass: '9', unNumber: '3556' }`; e `extractNcmCodes` sobre a mesma
   descrição retorna `['87038000']` (sem o 3556 — regressão do filtro UN).
4. Descrição sem DG → `dgClass/unNumber` null.
5. Linha `TOTAL:` ausente → totais null, parse não quebra.

Novos casos em `src/services/__tests__/blFreightImport.test.ts` (padrão dos
testes existentes de `buildBlFreightPayload`):

6. Payload carrega `cargo_description`, `total_packages`, `packages_unit`.
7. `consignee_phone` extraído de bloco com `TEL: +55 27 2124-1654`; null sem TEL.
8. Doc com DG → todos os containers do payload com
   `is_imo: true, imo_class: '9', un_number: '3556'`.
9. Reimport com container existente: flags existentes preservadas
   (comportamento atual de `preserveExistingContainerPhysicalAttributes` não
   regride).

Migration (padrão `src/services/__tests__/blFreightLinesMigration.test.ts`,
que roda contra Postgres descartável): upsert com e sem os novos campos no
payload — com campo presente sobrescreve, ausente preserva. Se o harness de
Postgres não estiver disponível no ambiente, criar
`blImportEdiFieldsMigration.test.ts` seguindo o padrão estático dos testes de
migration existentes (asserções sobre o SQL) e registrar a pendência.

## Done criteria

- [ ] `npm test` exit 0; novos testes acima existem e passam
- [ ] `npm run lint` exit 0; `npm run build` exit 0
- [ ] `grep -n "is_imo: false" src/services/blFreightImport.ts` não retorna a
      linha do `buildBlFreightPayload` (DG aplicado) — a ocorrência em
      `preserveExisting...` não existe (ela usa `Boolean(current.is_imo)`)
- [ ] `grep -c "total_packages" supabase/migrations/171_bl_import_edi_fields.sql` ≥ 4
- [ ] `npm run docs:check` exit 0
- [ ] `git status` sem arquivos fora do escopo
- [x] Linha deste plano atualizada em `docs/archive/plans/2026-07-08-transhipping-desk-edi-taxas/README.md`

## STOP conditions

Pare e reporte (não improvise) se:

- Os excertos de "Current state" não baterem com o código (drift).
- A RPC em `166_bl_import_party_blocks.sql` não contiver o guard
  `payload ? 'cargo_description'` (o plano assume esse padrão como molde).
- O teste de parser exigir mudar o loop de containers (rows 46+) — as novas
  capturas não devem alterar o parse físico existente.
- Descobrir que `bls` NÃO possui as colunas `consignee_phone`/`total_packages`/
  `packages_unit` (o plano assume a migration 161 aplicada).
- Precisar tocar arquivo fora do escopo.

## Maintenance notes

- Reimportar o arquivo do B/L é o backfill natural dos campos novos para B/Ls
  antigos — não há backfill automático (forward-only, mesmo padrão do
  `notify_party`).
- Containers criados por B/L com DG herdado podem ser refinados pelo Baplie
  (conciliação); revisor deve conferir que o preview de reimport não zera
  flags.
- Se aparecer arquivo COSCO com descrição fora de R44/J, a busca pelo
  cabeçalho `Description of Goods` (Step 1.2) absorve; se o layout mudar mais
  que isso, considerar o upgrade do `ponytail` já registrado no parser
  ("detectar layout por armador/template").
- Arquivos COSCO reais de referência existem com o operador (3 B/Ls: veículos
  IMO/Vitória, FCL packages, FCL rolls). Não foram commitados por conterem
  dados reais de clientes; se o operador os fornecer, movê-los para
  `src/services/__tests__/fixtures/` e criar teste real no padrão de
  `manifestFixtures.real.test.ts`.
