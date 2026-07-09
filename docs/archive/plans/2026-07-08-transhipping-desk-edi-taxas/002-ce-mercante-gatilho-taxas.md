# Plan 002: CE Mercante vira o gatilho único do cálculo/emissão automática de taxas locais (ADR 0020)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/archive/plans/2026-07-08-transhipping-desk-edi-taxas/README.md`.
>
> **Drift check (run first)**: `git diff --stat b2461da..HEAD -- src/services/manifestImport.ts src/services/blFreightImport.ts src/services/reviewBillingAutomation.ts src/services/ceMercanteImport.ts src/hooks/useBlEditForm.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (muda o momento do faturamento automático)
- **Depends on**: none (independente do 001; ver nota de ordem no README)
- **Category**: tech-debt/feature (decisão ADR 0020)
- **Planned at**: commit `b2461da`, 2026-07-08

## Why this matters

O motor de taxas divide cobranças por container entre os B/Ls que o
compartilham (`1/share_count`). Essa divisão só é correta se todos os B/Ls que
compartilham o container já existem no momento do cálculo — e a operação sobe
os B/Ls de uma viagem **em uploads separados no mesmo dia**. Calcular no import
gera cobrança 1,5× (o primeiro B/L paga o container inteiro e trava por
invoice). A decisão registrada em
`docs/adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md` resolve: **o
cadastro do CE Mercante é o gatilho único** do cálculo+emissão automática para
B/L de container — nessa altura, todos os B/Ls da viagem já foram importados
(o CE só existe depois do EDI transmitido). A operação confirmou: *"apenas
calculamos e faturamos após CE Mercante cadastrado"*.

## Current state

Gatilhos de billing automático hoje (todos client-side, best-effort):

1. **Import de manifesto** — `src/services/manifestImport.ts:186`
   (`queueImportBilling(batchIdNum, uploadedBy)`) chama via `setTimeout` a RPC
   `run_billing_for_import_batch`:

```ts
function queueImportBilling(batchId: number, uploadedBy: string) {
  setTimeout(() => {
    supabase.rpc('run_billing_for_import_batch', {
      p_batch_id: batchId,
      p_actor: uploadedBy,
      p_recalculate: true,
    }).then(() => undefined, () => undefined)
  }, 0)
}
```

2. **Importar B/L** — `src/services/blFreightImport.ts:298`
   (`void triggerAutoBillingForImportedBls(payload, changedBy)`) e a função em
   413–422, que chama `tryAutoIssueInvoice` por B/L com
   `customer_reconciliation_status === 'matched_document'`.

3. **Revisão de cliente** — `src/pages/Revisao.tsx` (linhas 134, 271, 314) e
   `src/components/review/ReviewDrawer.tsx:180` chamam `tryAutoIssueInvoice`
   ao reconciliar cliente. **Estes chamadores permanecem** — passam a ser
   naturalmente gateados pela pré-condição de CE adicionada no Step 3.

A automação (`src/services/reviewBillingAutomation.ts:11-45`):

```ts
export async function tryAutoIssueInvoice({ blId, customerId, actorId }) {
  try {
    const calculation = await calculateBlLocalCharges(blId, { actorId, recalculate: true })
    if (calculation.review_required || calculation.status === 'review_required') {
      return { status: 'blocked', message: ..., calculation }
    }
    ...
    const invoiceResult = await markBlReadyAndCreateInvoice({ blId, customerId, actorId })
    return { status: 'invoiced', invoiceResult }
```

Canais de cadastro de CE Mercante (nenhum dispara billing hoje):

- `src/services/ceMercanteImport.ts:81` — `importCeMercanteRows` (planilha,
  linha a linha) → RPC `apply_ce_mercante_update` por linha.
- `src/services/ceMercanteImport.ts:177` — caminho EDI → RPC
  `apply_ce_mercante_manifest` (all-or-nothing sobre um batch).
- `src/hooks/useBlEditForm.ts` — `ce_mercante` está em `editableFields`
  (linha 31) e é salvo via RPC `save_bl_review` (edição manual na ficha).

### Decisões que este plano deve honrar (o executor não leu os docs)

- ADR 0020, Decisão 1: *"O cadastro do CE Mercante é o gatilho único do
  cálculo automático de Taxas Locais para B/Ls de container. Qualquer canal de
  cadastro de CE (planilha por linha, EDI de retorno do manifesto, edição na
  ficha do B/L) dispara o cálculo daquele B/L."*
- ADR 0020, Decisão 2: *"Os imports deixam de calcular."*
- ADR 0020, Decisão 3: gates permanecem (reconciliação de cliente, review
  gate, holds) — CE com gate pendente calcula quando o gate liberar (por isso
  os chamadores da Revisão continuam existindo).
- ADR 0020, Decisão 4 (fronteira): **somente B/Ls de container** — carga solta
  (`breakbulkImport.ts`) e Granito não mudam.
- Cálculo+**emissão** automática quando tudo passa (decisão da sessão de
  design): o comportamento fim-a-fim de `tryAutoIssueInvoice` é o desejado no
  novo gatilho — não parar no cálculo.
- Cálculo manual pelo operador (`BlCobrancasSection`, botão de calcular) NÃO é
  bloqueado por este plano — o gatilho por CE governa a automação; a ação
  manual permanece a critério do operador.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Testes (foco) | `npx vitest run src/services/__tests__/manifestImport.test.ts src/services/__tests__/blFreightImport.test.ts src/services/__tests__/ceMercanteImport.test.ts src/services/__tests__/reviewBillingAutomation.test.ts` | all pass |
| Testes (suíte) | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Docs | `npm run docs:check` | "Documentation checks passed" |

## Scope

**In scope**:

- `src/services/manifestImport.ts` (remover gatilho)
- `src/services/blFreightImport.ts` (remover gatilho)
- `src/services/reviewBillingAutomation.ts` (pré-condição de CE)
- `src/services/ceMercanteImport.ts` (novo gatilho pós-CE)
- `src/hooks/useBlEditForm.ts` OU o ponto de sucesso do save na ficha
  (gatilho pós-CE manual — ver Step 4)
- Testes correspondentes em `src/services/__tests__/` e
  `src/hooks/__tests__/`
- `docs/modules/manifesto-edi.md`, `docs/modules/faturamento.md`,
  `docs/modules/taxas-locais.md`, `docs/RASTREABILIDADE.md` (invariantes do
  gatilho)

**Out of scope** (NÃO tocar):

- `src/services/breakbulkImport.ts` e fluxo Granito — fronteira explícita do
  ADR 0020 (carga solta continua calculando pós-commit no import).
- Migrations/SQL: a RPC `run_billing_for_import_batch` fica no banco (vira
  código sem chamador de produção; remoção é follow-up, não deste plano).
- `src/pages/Revisao.tsx` / `ReviewDrawer.tsx` — os chamadores existentes
  ficam; a pré-condição dentro de `tryAutoIssueInvoice` os gateia sem mudança
  neles. Só ajustar seus testes se a mensagem de bloqueio nova aparecer.
- `calculate_bl_local_charges` (RPC) — o gate de CE é client-side neste plano,
  coerente com os gatilhos client-side existentes (ponytail registrado no
  Maintenance).
- Plano 001/003 (parser e gerador de EDI).

## Git workflow

- Branch: a designada pelo operador; na ausência, `claude/plan-002-ce-gatilho`.
- Commits em português (`feat:`/`refactor:`/`docs:`); citar ADR 0020 na
  mensagem principal.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Remover o billing do import de manifesto

Em `src/services/manifestImport.ts`: remover a chamada
`queueImportBilling(batchIdNum, uploadedBy)` (linha ~186) e a função
`queueImportBilling` (linhas ~189–198). Não remover mais nada — batch id,
erros e retries ficam como estão.

**Verify**: `grep -n "queueImportBilling\|run_billing_for_import_batch" src/services/manifestImport.ts`
→ nenhuma ocorrência. `npx vitest run src/services/__tests__/manifestImport.test.ts`
→ ajustar/remover asserções do gatilho e passar.

### Step 2: Remover o billing do Importar B/L

Em `src/services/blFreightImport.ts`: remover a linha
`void triggerAutoBillingForImportedBls(payload, changedBy)` (linha ~298) e a
função `triggerAutoBillingForImportedBls` (linhas ~413–422). Remover o import
de `tryAutoIssueInvoice` se ficar órfão. **Manter**
`applyBapliePhysicalFlags` (linhas 290–296) — não é billing.

**Verify**: `grep -n "tryAutoIssueInvoice" src/services/blFreightImport.ts` →
nenhuma ocorrência; `npx vitest run src/services/__tests__/blFreightImport.test.ts`
→ pass após ajustar asserções.

### Step 3: Pré-condição de CE em `tryAutoIssueInvoice`

Em `src/services/reviewBillingAutomation.ts`, no início do `try`: buscar
`ce_mercante` e `cargo_mode` do B/L (`supabase.from('bls').select('ce_mercante, cargo_mode').eq('id', blId).single()`).
Se `cargo_mode === 'container'` (ou null, default do domínio) e `ce_mercante`
vazio/null → retornar
`{ status: 'blocked', message: 'Aguardando cadastro do CE Mercante para calcular taxas (ADR 0020).' }`
sem calcular. `cargo_mode === 'carga_solta'` ou `'granito'` não são gateados
(fronteira do ADR).

**Verify**: novo teste em `reviewBillingAutomation.test.ts` (ver Test plan) →
pass.

### Step 4: Disparar a automação nos três canais de CE

1. `src/services/ceMercanteImport.ts` — em `importCeMercanteRows`, após cada
   `apply_ce_mercante_update` bem-sucedido, e no caminho EDI após
   `apply_ce_mercante_manifest` retornar `ok=true` (para cada B/L coberto):
   buscar `customer_id` e `customer_reconciliation_status` do B/L; quando
   `matched_document` e `customer_id` presente, chamar
   `void tryAutoIssueInvoice({ blId, customerId, actorId }).catch(() => {})`
   — best-effort pós-commit, espelhando o padrão removido no Step 2 (falha de
   automação não desfaz o CE).
2. Edição manual na ficha: no ponto em que o save da revisão retorna sucesso
   com `ce_mercante` alterado de vazio→preenchido (em
   `src/hooks/useBlEditForm.ts`, que conhece os valores anterior e novo),
   disparar a mesma automação com os dados do B/L carregado. Se o hook não
   tiver acesso ao `customer_id`/status, buscar do banco como no item 1.
3. Extrair um helper único (ex.:
   `maybeAutoBillAfterCeMercante(blId, actorId)` em
   `reviewBillingAutomation.ts`) que encapsula "buscar B/L → checar
   matched_document + container → tryAutoIssueInvoice", para os três canais
   não duplicarem a regra.

**Verify**: `npx vitest run src/services/__tests__/ceMercanteImport.test.ts`
→ pass com novos casos; `npm test` → pass.

### Step 5: Documentação viva

- `docs/modules/manifesto-edi.md`: invariante 17 ("Importar B/L não toca
  faturamento...") — atualizar: o pós-commit não tenta mais
  `tryAutoIssueInvoice`; apontar ADR 0020. Ação "importar manifesto CNTR" —
  remover menção a billing no pós-import.
- `docs/modules/taxas-locais.md` e `docs/modules/faturamento.md`: registrar o
  gatilho por CE (cadastro do CE → cálculo+emissão automática com gates).
- `docs/RASTREABILIDADE.md`: atualizar as linhas de manifesto/Importar
  B/L/CE Mercante.

**Verify**: `npm run docs:check` → "Documentation checks passed".

## Test plan

- `reviewBillingAutomation.test.ts` (padrão dos testes existentes no arquivo):
  1. B/L container sem `ce_mercante` → `blocked` com mensagem de CE, e
     `calculateBlLocalCharges` NÃO chamado.
  2. B/L container com CE + matched_document → fluxo segue (cálculo chamado).
  3. B/L `carga_solta` sem CE → NÃO bloqueado por CE (fronteira ADR 0020).
- `ceMercanteImport.test.ts`: import de linha com sucesso em B/L
  matched_document dispara `tryAutoIssueInvoice` (mock); B/L com
  `missing_customer` não dispara; falha da automação não falha o import.
- `manifestImport.test.ts` / `blFreightImport.test.ts`: asserções de que os
  gatilhos antigos NÃO são mais chamados (espionar `supabase.rpc` /
  `tryAutoIssueInvoice`).
- Padrão estrutural: `src/services/__tests__/reviewBillingAutomation.test.ts`
  existente.

## Done criteria

- [ ] `grep -rn "run_billing_for_import_batch" src/ --include="*.ts" --include="*.tsx" | grep -v test | grep -v types/database` → nenhuma ocorrência
- [ ] `grep -n "tryAutoIssueInvoice" src/services/blFreightImport.ts` → nenhuma
- [ ] `tryAutoIssueInvoice` bloqueia B/L container sem CE (teste 1 passa)
- [ ] Os 3 canais de CE disparam a automação (testes passam)
- [ ] `npm test`, `npm run lint`, `npm run build`, `npm run docs:check` → exit 0
- [ ] `git status` sem arquivos fora do escopo
- [x] Linha deste plano atualizada em `docs/archive/plans/2026-07-08-transhipping-desk-edi-taxas/README.md`

## STOP conditions

Pare e reporte se:

- Os excertos de "Current state" não baterem com o código (drift).
- Descobrir gatilho de billing automático ADICIONAL não listado aqui (ex.:
  dentro de alguma RPC SQL chamada pelos imports) — o plano assume que os
  gatilhos client-side listados são exaustivos para container.
- `apply_ce_mercante_manifest` não expuser quais B/Ls foram atualizados (o
  Step 4.1 precisa da lista; se a RPC só retorna ok/contagem, usar a lista de
  linhas parseadas que a própria chamada enviou).
- Os testes de Revisão (`Revisao.test.tsx`) quebrarem por motivo diferente da
  nova mensagem de bloqueio por CE.

## Maintenance notes

- `run_billing_for_import_batch` fica órfã no banco — candidata a remoção em
  migration futura (registrar como dead code, não remover aqui).
- ponytail: o gate de CE é client-side (coerente com os gatilhos atuais);
  ceiling: um caminho novo que chame `calculate_bl_local_charges` direto não
  passa pelo gate. Upgrade: mover a checagem para dentro da RPC
  `calculate_bl_local_charges` quando houver segundo consumidor.
- Se o Plano 001 já tiver aplicado antes deste, o diff de
  `blFreightImport.ts` terá mudado — o drift check acusa; os pontos de remoção
  (linhas 298 e 413–422) são estáveis por símbolo, não por número de linha.
- Revisor deve conferir no PR que carga solta continua calculando no import
  (fronteira deliberada, não esquecimento).
