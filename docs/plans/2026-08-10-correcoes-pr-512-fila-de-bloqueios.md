# Correções da PR #512 — Validação como fila de bloqueios

**Goal:** Fechar os 14 achados da revisão da PR #512
(`codex/validacao-fila-bloqueios`) antes do merge, com prioridade para a
regressão que deixa **Granito sem via de faturamento** — a mesma que hoje mantém
o CI vermelho.

**Architecture:** Nenhuma migration, nenhuma mudança de contrato de banco. As
correções ficam em quatro arquivos de UI (`ValidacaoTab.tsx`,
`ValidacaoControls.tsx`, `ValidacaoOperationsTable.tsx`, `validacaoPipeline.ts`)
e três de serviço (`graniteBillingWorkflow.ts`, `reviewBillingAutomation.ts`,
`exports.ts`).

**Tech Stack:** React + TypeScript, TanStack Query, Vitest.

**Base:** branch `codex/validacao-fila-bloqueios` (commit `e39ef7a`), sobre
`main` em `28e85a8`.

**Relação com os planos vivos:** este plano **não substitui**
[`2026-08-10-ce-mercante-granito.md`](./2026-08-10-ce-mercante-granito.md). Ele
restaura a ponte de granito que aquele plano ainda pressupõe existir (Task 3 e
Task 4 daquele plano) e que a PR #512 removeu antes da hora.

---

## Por que a ordem importa

O achado 1 e o achado 2 são a **mesma regressão vista de dois lados**: a PR
removeu ao mesmo tempo o único caminho de recálculo de granito
(`runGraniteBatch`, chamado só por `ValidacaoTab.tsx`) e o único caminho de
marcação `ready_for_billing` de granito (`runGraniteBatch(ids, 'ready')` →
`markGraniteBlReady`).

**Evidência — Código:** `create_invoice_from_granite_bls`
(`supabase/migrations/064_fix_granite_invoice_cancel_reissue.sql:181`) recusa com
`PT409: ... nao estao prontos para faturar (charge_status != ready_for_billing)`.
O botão "Emitir fatura" por linha só habilita com `isChargeReady(row.charge_status)`
(`src/lib/chargeStatus.ts:9`), isto é, já `ready_for_billing`. Um B/L de granito
em `calculated` não tem nenhuma superfície viva que o promova.

**Evidência — Teste:** `Test (2/3)` falha em `validacaoGraniteWorkflowContract.test.ts`
na própria PR; o teste que apanhou o buraco foi silenciado com `it.skip` +
`as never` (achado 14).

Isso viola a restrição escrita no plano original: *"Granito precisa continuar
faturável durante todo o PR (Task 5)"* e a decisão 4 da ADR 0041 (*"a emissão
operacional por linha usa o workflow que preserva o caminho de Granito"*).

Por isso a Task 1 vem antes de tudo: ela sozinha fecha os achados 1, 2 e 14 e
volta o CI ao verde.

---

### Task 1 — Restaurar o caminho de Granito (achados 1, 2, 14) — **P0**

`runBatchOperation` hoje manda todos os ids selecionados para
`calculateLocalChargesBatch`, que só conhece a tabela `bls`. Ids de `granite_bls`
falham em massa, e `runGraniteBatch`/`calculateAndIssueGraniteInvoice` ficam sem
chamador de produção.

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Modify: `src/services/graniteBillingWorkflow.ts`
- Modify: `src/components/billing/ValidacaoOperationsTable.tsx`
- Test: `src/services/__tests__/graniteBillingWorkflow.test.ts`
- Test: `src/services/__tests__/validacaoGraniteWorkflowContract.test.ts`

**Interfaces:**
- `runBatchOperation` volta a particionar a seleção por `cargo_mode`:
  `granito` → `runGraniteBatch`, o resto → `batchCalculateMutation`. Os dois
  resultados somam em um único `{ total, successCount, errorCount, errors }`.
- `runGraniteBatch(ids, action: 'recalculate' | 'ready')` — a ação `'review'`
  fica removida (o lote de revisão saiu da tela por decisão da ADR 0041), mas
  `'ready'` **volta**, porque é o único promotor de `ready_for_billing` de
  granito até a Task 3 de `2026-08-10-ce-mercante-granito.md`.
- Na tabela, o B/L de granito em `calculated`, reconciliado e com linhas
  calculadas ganha ação de linha **"Marcar pronto p/ faturar"**
  (`runGraniteBatch([id], 'ready')`), visível só para `cargo_mode === 'granito'`.
  Marque-a com `ponytail:` — é ponte temporária, com o teto e o caminho de
  saída nomeados: sai quando o CE de Granito virar o confirmador.

- [ ] **Step 1: Reativar o teste** removendo o `it.skip` e o `as never` de
      `graniteBillingWorkflow.test.ts:101`; adaptar a asserção para a ação
      `'ready'` (a `'review'` deixou de existir por decisão, não por acidente —
      trocar o caso para "ação desconhecida não é suportada" ou removê-lo com
      justificativa no commit).
- [ ] **Step 2: Escrever o teste que falha** exigindo que
      `runBatchOperation('recalculate')` sobre uma seleção mista roteie os ids de
      granito para `runGraniteBatch` e os demais para `calculateLocalChargesBatch`,
      somando os contadores.
- [ ] **Step 3: Rodar e ver falhar** com
      `npx vitest run src/services/__tests__/graniteBillingWorkflow.test.ts src/services/__tests__/validacaoGraniteWorkflowContract.test.ts`.
- [ ] **Step 4: Implementar** o split e a ação de linha.
- [ ] **Step 5: Rodar e ver passar** — inclui o contrato que hoje deixa o CI vermelho.
- [ ] **Step 6: Commit** `fix(faturamento): restaurar recalculo e marcacao de granito`.

### Task 2 — Erro de lote volta a virar toast (achados 3, 7) — **P0**

`runBatchOperation` perdeu o `try/catch` e é invocada como
`void runBatchOperation(action)`: um throw do RPC vira **unhandled rejection**,
sem nenhum retorno visual. E quando todos os ids selecionados estão travados por
`isBlLockedForRecalc`, a função retorna em silêncio (`if (!eligible.length) return`)
— o botão por linha só desabilita em `invoiced`, então "Recalcular" num B/L
`paid`/`partially_paid` não faz nada e não diz nada.

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Modify: `src/components/billing/ValidacaoOperationsTable.tsx`
- Test: `src/components/billing/__tests__/validacaoFunnel.test.ts`

**Interfaces:**
- `runBatchOperation` envolve a chamada em `try/catch` e emite
  `showToast(message, 'error')` na falha.
- Toast de pulados: `N ignorado(s) (já faturados).` quando
  `invoiced.size > 0`.
- Toast de escopo vazio: `'Nenhum B/L elegível para recálculo na seleção.'`
  quando `eligible.length === 0`.
- Na tabela, o botão de recálculo por linha passa a usar `isBlLockedForRecalc`
  (não `financial_status !== 'invoiced'`) como condição de `disabled`, com
  `title` explicando o motivo. **Consertar no predicado compartilhado, não por
  guarda em cada call site.**

- [ ] **Step 1: Escrever o teste que falha** cobrindo os três casos: throw do
      lote produz toast de erro; seleção só de travados produz toast informativo;
      seleção mista reporta a contagem de ignorados.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `fix(faturamento): reportar falha e escopo vazio do lote`.

### Task 3 — `getBillingBlock` classifica certo (achados 4, 5) — **P1**

Dois defeitos no mesmo bloco de `validacaoPipeline.ts`:

1. **Linha 71** — a regra de CE exclui apenas `granito`, então `carga_solta` cai
   em "Aguardando CE Mercante". Mas o gate real
   (`maybeAutoBillAfterCeMercante`, `src/services/reviewBillingAutomation.ts:88`)
   só atende `container` e `''`. B/L de carga solta fica **preso para sempre**
   num bloco que ninguém vai destravar.
2. **Linha 77** — o fallback terminal devolve `code: 'aguardando_ce'` com label
   "Aguardando CE Mercante" e detalhe "Pronto para emissão individual.".
   Contradição visível na linha, e — pior — B/Ls totalmente prontos (e **todas**
   as linhas de granito, que a regra anterior deixa passar) permanecem na fila de
   bloqueios em vez de sair dela.

**Files:**
- Modify: `src/components/billing/validacaoPipeline.ts`
- Modify: `src/components/billing/validacaoTypes.ts`
- Modify: `src/components/billing/ValidacaoControls.tsx`
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Test: `src/components/billing/__tests__/validacaoFunnel.test.ts`

**Interfaces:**
- A regra de CE passa a ser **inclusiva**, espelhando o gate real:
  `const mode = row.cargo_mode ?? 'container'; if (!row.ce_mercante?.trim() && (mode === 'container' || mode === ''))`.
  Quando a Task 4 do plano de CE de Granito entrar, `granito` entra nessa lista —
  não sai de uma exclusão.
- `BillingBlockCode` ganha `'pronto'`: `{ code: 'pronto', label: 'Pronto para emitir', detail: 'Pronto para emissão individual.' }`.
- `'pronto'` entra na lista de códigos resolvidos junto com `'faturado'` e
  `'isento'`, ou seja, fica **fora da fila por padrão** — a fila é de bloqueios,
  e "pronto" não é bloqueio.
- `ValidacaoControls` ganha a opção `Pronto para emitir` no select **Motivo**.

- [ ] **Step 1: Escrever o teste que falha** exigindo: carga solta sem CE **não**
      classifica como `aguardando_ce`; B/L reconciliado, calculado e com CE
      classifica como `pronto`; B/L de granito calculado classifica como `pronto`
      (não `aguardando_ce`); a fila padrão não traz `pronto`.
- [ ] **Step 2: Rodar e ver falhar** com
      `npx vitest run src/components/billing/__tests__/validacaoFunnel.test.ts`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `fix(faturamento): CE so bloqueia container e codigo proprio para pronto`.

### Task 4 — Invalidação de cache na emissão individual (achado 6) — **P1**

`handleIssueSingleInvoice` invalida só `queryKeys.charges.operations()`. A versão
anterior (`main`, `ValidacaoTab.tsx:365`) invalidava quatro chaves; as outras três
foram perdidas na reescrita, então a aba **Faturas**, a lista de B/Ls e o resumo
ficam obsoletos depois de emitir.

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Test: `src/components/billing/__tests__/validacaoFunnel.test.ts`

**Interfaces:** `Promise.all` com `charges.operations()`, `invoices.all()`,
`bls.all()`, `bls.summary()` — a mesma lista de `main`.

- [ ] **Step 1: Escrever o teste que falha** exigindo as quatro chaves invalidadas.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `fix(faturamento): reinvalidar faturas e B/Ls apos emissao`.

### Task 5 — Correções de UI (achados 8, 9, 10) — **P2**

Três defeitos independentes e pequenos:

- **Achado 8** — escolher Motivo = *Faturado* ou *Isento* renderiza grade vazia,
  porque o filtro de `includeResolved` roda **antes** do filtro por código
  (`ValidacaoTab.tsx:27`). O filtro parece quebrado.
- **Achado 9** — o aviso de truncamento em 1200 linhas é calculado sobre
  `displayedRows.length` (pós-filtro) em vez da contagem bruta da query
  (`ValidacaoControls.tsx:36`). Uma fila truncada com filtro ativo não avisa nada.
- **Achado 10** — `colSpan={11}` contra 10 `<th>` (a coluna *Motivo* substituiu
  "Por que nao fatura?", saldo zero): coluna fantasma nas linhas de carregamento,
  vazio e expandida (`ValidacaoOperationsTable.tsx:85`).

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Modify: `src/components/billing/ValidacaoControls.tsx`
- Modify: `src/components/billing/ValidacaoOperationsTable.tsx`
- Test: `src/components/billing/__tests__/ValidacaoControls.test.tsx`

**Interfaces:**
- Escolher um `blockCode` resolvido (`faturado`, `isento`, `pronto`) liga
  `includeResolved` automaticamente em `updateOpsFilter` — o operador pediu
  aquele conjunto, não precisa marcar duas caixas.
- `ValidacaoControls` recebe `totalRowCount` (contagem crua de `operationsRows`)
  além de `blockedCount`; o aviso de teto usa `totalRowCount >= 1200`.
- `colSpan={10}` nas três células que hoje usam 11.

- [ ] **Step 1: Escrever o teste que falha** para o aviso de teto com filtro
      ativo e para o auto-`includeResolved`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (o `colSpan` é one-liner e não pede teste próprio).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `fix(faturamento): filtro de resolvidos, aviso de teto e colspan`.

### Task 6 — Limpeza (achados 11, 12, 13) — **P2**

- **Achado 11** — `reviewBillingAutomation.ts:105` decide criar alerta comparando
  `result.message === 'B/L sem valor faturavel apos recalculo.'`, um literal
  duplicado da string produzida acima. Reescrever a mensagem mata o alerta em
  silêncio — exatamente o buraco que a Task 2 do plano original existia para
  fechar. Trocar por flag estruturada.
- **Achado 12** — `getLegacyBillingBlockReason` é export sem chamador, e suas
  regras de precedência **discordam** de `getBillingBlock` (ela devolve
  `billing_hold_reason` antes de checar cliente). Duas fontes de verdade para a
  mesma pergunta. `getBillingBlockReason`, `isPendingBillingReview` e
  `isAwaitingCeMercante` também ficaram sem chamador de produção — auditar as
  quatro no mesmo passo.
- **Achado 13** — `exportLocalChargeConferenceCsv` ficou morta (a Task 4 do plano
  original trocou por XLSX), sob um comentário que ainda afirma *"CSV, não XLSX"*.
  As duas funções de conferência estão indentadas dois espaços a mais que o resto
  do módulo (`src/services/exports.ts:243-262`).

**Files:**
- Modify: `src/services/reviewBillingAutomation.ts`
- Modify: `src/components/billing/validacaoPipeline.ts`
- Modify: `src/services/exports.ts`
- Test: `src/services/__tests__/reviewBillingAutomation.test.ts`

**Interfaces:**
- `ReviewBillingAutomationResult` ganha, no ramo `blocked`, um discriminante
  estruturado — `reason: 'no_billable_value' | 'rpc_error' | 'awaiting_flow'` —
  e o alerta passa a testar `result.reason !== 'awaiting_flow'` (ou
  `result.unexpected`), nunca o texto.
- `getLegacyBillingBlockReason` é removida. Antes de remover as outras três,
  rodar `grep -rn "getBillingBlockReason\|isPendingBillingReview\|isAwaitingCeMercante" src/`
  e remover só as que não sobrarem com chamador — inclusive de teste.
- `exportLocalChargeConferenceCsv` é removida; o comentário acima de
  `exportLocalChargeConferenceWorkbook` passa a descrever XLSX; indentação
  normalizada. Se `downloadCsv` (`src/lib/csv.ts`) ficar sem consumidor,
  registrar em uma linha no commit — não removê-la neste plano.

- [ ] **Step 1: Escrever o teste que falha** exigindo que o alerta
      `billing_auto_issue_failed` seja criado a partir do discriminante e
      **não** da mensagem — o teste reescreve o texto e ainda espera o alerta.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** o discriminante e as remoções.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `chore(faturamento): motivo estruturado e remocao de codigo morto`.

### Task 7 — Documentação viva

A ADR 0041 e o CONTEXT.md descrevem **três** bloqueios. A Task 3 acrescenta um
quinto código (`pronto`) que não é bloqueio, e a Task 1 mantém viva a marcação
manual de granito que a ADR dava como aposentada. Ambos precisam de nota
editorial — a ADR é registro de decisão e **não se reescreve**.

**Files:**
- Modify: `docs/adr/0041-validacao-fila-de-bloqueios-ce-como-confirmacao.md`
  (apenas nota editorial ao final, datada)
- Modify: `CONTEXT.md` (verbete *Motivo de Bloqueio de Faturamento*)
- Modify: `docs/CHANGELOG.md`

**Redação da nota editorial na ADR 0041:**

> **Nota editorial — 2026-08-10:** a decisão 2 continua valendo; a marcação
> manual de "pronto para faturar" de **Granito** permanece na tela como ponte
> até que o CE de Granito exista (plano `2026-08-10-ce-mercante-granito.md`,
> Task 3), porque `create_invoice_from_granite_bls` exige
> `charge_status = 'ready_for_billing'` e nenhuma outra superfície promove esse
> estado. A fila também expõe um código `pronto` (não-bloqueio), fora da vista
> padrão, para não classificar B/L pronto como "Aguardando CE Mercante".

- [ ] **Step 1: Escrever a nota editorial e ajustar o verbete do CONTEXT.md.**
- [ ] **Step 2: Registrar no CHANGELOG.**
- [ ] **Step 3: Rodar `npm run docs:check`.**
- [ ] **Step 4: Commit** `docs(faturamento): nota editorial da ADR 0041`.

### Task 8 — Verificação final

- [ ] `npm run docs:check`
- [ ] `npm run lint`
- [ ] `npm test` — em especial `validacaoGraniteWorkflowContract.test.ts`,
      que hoje é o teste vermelho do CI
- [ ] `npm run build`
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de
      `docs/plans/README.md`, no mesmo change que conclui a execução.

---

## Fora de escopo (registrado, não corrigido aqui)

- `loadGraniteOperationalRows` implementa `includeResolved` como
  `.neq('charge_status', '__never__')`
  (`src/services/charges/chargeOperationsService.ts:413`) — sentinela em vez de
  condicional. Funciona; é feio. Vale um `ponytail:` nomeando o truque, não uma
  refatoração dentro deste plano.
- A migração do gate de CE para incluir `granito` continua sendo a Task 4 de
  `2026-08-10-ce-mercante-granito.md`. A Task 3 daqui só deixa a regra na forma
  inclusiva que aquela task precisa.

## Riscos

- **A ponte de granito volta a existir.** É reintrodução consciente de código que
  a PR #512 tentou aposentar cedo demais. O `ponytail:` nomeia o teto e a saída;
  se o plano de CE de Granito atrasar, a ponte fica — e é melhor que granito sem
  faturamento.
- **O código `pronto` muda a contagem da fila.** B/Ls prontos saem do número
  exibido em `N B/L bloqueados`. É o comportamento correto para uma fila de
  bloqueios, mas é uma queda visível no contador no dia do deploy.
