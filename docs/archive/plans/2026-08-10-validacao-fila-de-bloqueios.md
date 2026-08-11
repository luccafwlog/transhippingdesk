# Validação do Faturamento como Fila de Bloqueios

**Goal:** Reduzir a aba Validação de `/faturamento` a uma fila de bloqueios com
três blocos derivados, removendo os quatro cards acima da tabela e os atos de
aprovação/marcação manual que o fluxo automático já tornou desnecessários.

**Architecture:** Nenhuma migration. A tela passa a **derivar** o estado do B/L
dos dados que já existem, em vez de exibir `charge_status` cru. O motor de
cálculo, as RPCs e as demais telas ficam intactos; muda a apresentação e a
limpeza do código que fica sem chamador.

**Tech Stack:** React + TypeScript, TanStack Query, Vitest.

## Modelo acordado

Cadastrar o **CE Mercante é o ato de confirmação** do cálculo — confirmar e
emitir são o mesmo ato, e ele acontece na ficha do B/L ou no modal de import,
não nesta tela. O operador aqui não marca estados: ele desbloqueia.

Um B/L só pode estar parado em três lugares:

| Bloco | Causa | Onde se conserta |
|---|---|---|
| **Sem cliente vinculado** | Consignatário não virou Cliente | Reconciliação / Cadastro de Clientes |
| **Cálculo incompleto** | Faltou dado para calcular, no todo ou em parte | Ficha do B/L ou Cadastro de Taxas |
| **Aguardando CE Mercante** | Calculou; espera normal do fluxo | Cadastro do CE |

"Cálculo incompleto" agrupa as seis pendências do motor (`review:no_table`,
`review:no_containers`, `review:imo_oog_thd`, `review:weight_missing`,
`review:thd_any_profile`, `review:unsupported_basis`) num bloco só, com a frase
específica do motor visível na linha. Duas delas são erro de cadastro da tabela
de taxas, não do B/L; se na prática o dono do conserto divergir sempre, elas
pedem bloco próprio numa mudança posterior.

**Aguardando CE tem tom neutro:** é espera do mundo, não pendência de alguém.

## Global Constraints

- Sem migration. `charge_status` (`review_required`, `reviewed`,
  `ready_for_billing`) continua existindo no banco e nas outras telas.
- A RPC `mark_bl_charges_reviewed` e a ação por B/L da ficha permanecem; só o
  lote desta tela sai.
- Nada pode sair da tela sem antes ter outra superfície: o caso "faturamento
  falhou" só deixa a grade depois que o Alerta existir (Task 2 antes da Task 6).
- Granito precisa continuar faturável durante todo o PR (Task 5).

---

### Task 1: Motivo de Bloqueio como categoria fechada

`getBillingBlockReason` devolve hoje uma frase — em 4 dos 10 ramos, texto livre
do banco. Vira uma categoria fechada com a frase junto, e passa a cobrir a falta
de CE Mercante, que hoje **não é verificada** e cai no ramo genérico
"Ainda nao marcado como pronto para faturar".

**Files:**
- Modify: `src/components/billing/validacaoPipeline.ts`
- Modify: `src/components/billing/validacaoTypes.ts`
- Test: `src/components/billing/__tests__/validacaoFunnel.test.ts`

**Interfaces:**
- `export type BillingBlockCode = 'sem_cliente' | 'calculo_incompleto' | 'aguardando_ce' | 'faturado' | 'isento'`
- `getBillingBlock(row): { code: BillingBlockCode; label: string; detail: string }` —
  `detail` carrega a frase específica (`billing_hold_reason`,
  `customer_reconciliation_notes`, `review_reason`, `charge_exemption_reason`).
- `getBillingBlockReason` permanece exportada como `detail` do novo retorno,
  para não quebrar chamadores.

- [ ] **Step 1: Write the failing test** cobrindo: B/L de container reconciliado,
      calculado e **sem `ce_mercante`** classifica como `aguardando_ce` (hoje cai
      no ramo genérico); B/L com `billing_hold_reason` livre não reconhecido
      classifica pela causa estrutural, não pelo texto; carga solta sem CE
      também classifica como `aguardando_ce`.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/components/billing/__tests__/validacaoFunnel.test.ts`.
- [ ] **Step 3: Write minimal implementation** mapeando os ramos existentes para
      os cinco códigos e acrescentando a verificação de `ce_mercante`.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(faturamento): classificar bloqueio em categoria fechada`.

### Task 2: Alerta de falha de emissão

Hoje `bl_auto_billing_failed` vai para `audit_logs` como telemetria, **não** para
`alerts`. Pior: `maybeAutoBillAfterCeMercante` só registra quando
`result.unexpected` é true — falha com motivo conhecido ("sem valor faturável",
erro da RPC de invoice) não deixa rastro algum, e `logOperationalEvent` descarta
em silêncio quando `changedBy` é nulo.

Sem esta task, tirar o caso da tela o **apaga** em vez de movê-lo.

**Files:**
- Modify: `src/services/reviewBillingAutomation.ts`
- Test: `src/services/__tests__/reviewBillingAutomation.test.ts`

**Interfaces:**
- Reusa `createAlert` de `src/services/alerts.ts` (sem migration: `alerts.type`
  é `TEXT` livre, sem CHECK).
- Novo tipo: `type: 'billing_auto_issue_failed'`, `entityType: 'bl'`,
  `entityId: blId`, `message` = motivo do bloqueio.

- [ ] **Step 1: Write the failing test** exigindo Alerta criado quando a emissão
      automática falha por motivo **conhecido** (não só `unexpected`), e que o
      caminho não crie Alerta quando o bloqueio é espera normal (sem CE, cliente
      pendente, cálculo incompleto) — esses são fila, não falha.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation:** separar em
      `tryAutoIssueInvoice` os bloqueios de fluxo (sem CE / sem cliente / cálculo
      incompleto) dos de falha (sem valor faturável, erro da RPC), e criar Alerta
      só para os segundos. Manter o `logOperationalEvent` atual.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(faturamento): alertar falha de emissão automática`.

### Task 3: Barra de filtros, contador e exportação

**Files:**
- Modify: `src/components/billing/ValidacaoControls.tsx`
- Modify: `src/components/billing/validacaoTypes.ts`
- Test: `src/components/billing/__tests__/ValidacaoControls.test.tsx`

**Interfaces:**
- `OpsFilters` troca `chargeStatus` por `blockCode: '' | BillingBlockCode` e
  ganha `includeResolved: boolean`.
- `ValidacaoControls` deixa de receber `provisional`, `awaitingCe`,
  `reconciliationPending`, `reviewPending`, `reviewPendencyCount`, `ready`,
  `readyInvoiced`, `readyPendingInvoice`, `pipelineBottleneck`,
  `reconciliationFilter`, `reviewFilter`, `onPipelineStep`,
  `onRunBatchOperation`, `onRecalculateAllInReview`.

**Sai:** os quatro `Card`, o funil de 3 passos, `PipelineStep`, a tarja âmbar,
"Tudo em dia", o tile "Selecionados", o select "Status taxas", os botões
"Aprovar revisao", "Marcar pronto faturar" e "Recalcular todas em revisão".

**Fica:** barra sem card com **Texto livre, Modo, Viagem, POD, Motivo**; uma
linha `N B/L bloqueados — M selecionados` com aviso ao bater o teto de 1200;
botão **Recalcular** (lote sobre a seleção, desabilitado com seleção vazia); menu
único **Exportar** com o escopo escrito em cada opção.

- [ ] **Step 1: Write the failing test** exigindo que os botões de lote fiquem
      **desabilitados** com seleção vazia (hoje disparam toast de erro), que o
      contador reflita filtro e seleção, e que o aviso de teto apareça em 1200.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `refactor(faturamento): barra única no lugar dos quatro cards`.

### Task 4: Exportação de conferência em xlsx

A planilha de conferência é a superfície que o CONTEXT.md nomeia para a fase
provisória; hoje sai em CSV enquanto a outra exportação sai em xlsx.

**Files:**
- Modify: `src/services/exports.ts`
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Test: `src/services/__tests__/exports.test.ts`

- [ ] **Step 1: Write the failing test** exigindo workbook xlsx com as mesmas
      colunas do CSV atual e o rótulo de escopo preservado.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** (`exportLocalChargeConferenceWorkbook`,
      espelhando `exportLocalChargeOperationsWorkbook`).
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(faturamento): exportar conferência em xlsx`.

### Task 5: Tabela — motivo em destaque e ações por linha

**Files:**
- Modify: `src/components/billing/ValidacaoOperationsTable.tsx`
- Test: `src/components/billing/__tests__/ValidacaoOperationsTable.test.tsx`

**Interfaces:**
- "Por que nao fatura?" sai do fim e vira a **segunda coluna**, com badge da
  categoria e `detail` como texto secundário. Tom neutro para `aguardando_ce`.
- Ação **Recalcular** por linha.
- Ação **Emitir fatura** por linha passa a chamar `issueOperationalInvoice`
  (`src/services/graniteBillingWorkflow.ts`) em vez de `createInvoiceFromBls`.

> **Por que isto é obrigatório neste PR:** `runGraniteBatch` — importado só por
> `ValidacaoTab.tsx` — é a **única entrada viva** do faturamento de granito.
> `calculateAndIssueGraniteInvoice` e `issueOperationalInvoice` não têm chamador
> fora de testes. Remover o botão de lote (Task 3) sem esta troca deixa granito
> sem via de faturamento até o PR do CE de Granito.

- [ ] **Step 1: Write the failing test** exigindo que emitir fatura de um B/L
      `cargo_mode='granito'` use o caminho de granito, e que a coluna de motivo
      renderize badge + detalhe na segunda posição.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(faturamento): motivo em destaque e emissão por linha`.

### Task 6: ValidacaoTab — derivar os três blocos

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Test: `src/components/billing/__tests__/validacaoFunnel.test.ts`

**Sai:** `operationsSummary` (funil), `pipelineBottleneck`,
`reconciliationFilter`, `reviewFilter`, `handlePipelineStep`,
`handleRecalculateAllInReview`, `runBatchOperation` nas ações `review` e `ready`.

**Fica:** `runBatchOperation('recalculate')`, os handlers de reconciliação, a
emissão individual e a exportação.

**Novo:** B/Ls `faturado` e `isento` ficam **fora da fila por padrão**, atrás do
filtro `includeResolved`. O caso "faturamento falhou" também não aparece — ele
vive no módulo de Alertas desde a Task 2.

- [ ] **Step 1: Write the failing test** exigindo que a grade padrão não traga
      faturados nem isentos, e que `includeResolved` os traga de volta.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `refactor(faturamento): validação deriva três blocos`.

### Task 7: Remover código sem chamador

**Files:**
- Modify: `src/services/charges/chargeOperationsService.ts` (remover
  `markLocalChargesReviewedBatch`, `markLocalChargesReadyBatch`)
- Modify: `src/hooks/useLocalCharges.ts` (remover
  `useBatchMarkLocalChargesReviewed`, `useBatchMarkLocalChargesReady`)
- Modify: `src/services/graniteBillingWorkflow.ts` (remover de `runGraniteBatch`
  as ações `review` e `ready`; manter `recalculate`)
- Modify: `src/services/__tests__/localCharges.test.ts`

**Preservar:** `mark_bl_charges_reviewed` e `mark_bl_ready_and_create_invoice`
(RPCs), `markBlChargesReviewed`/`markBlReadyForBilling` (ação por B/L na ficha),
`markGraniteBlReady` (usado por `calculateAndIssueGraniteInvoice`, e ainda o
gatilho de granito até o PR do CE).

- [ ] **Step 1: Confirmar ausência de chamadores** com
      `grep -rn "markLocalChargesReviewedBatch\|markLocalChargesReadyBatch\|useBatchMarkLocalCharges" src/`.
- [ ] **Step 2: Remover** as funções, hooks e seus testes.
- [ ] **Step 3: Run `npm run lint` e `npm test`.**
- [ ] **Step 4: Commit** `chore(faturamento): remover lote de revisão e marcação`.

### Task 8: Documentação viva

**Files:**
- Modify: `CONTEXT.md`
- Create: `docs/adr/0041-validacao-fila-de-bloqueios-ce-como-confirmacao.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/RASTREABILIDADE.md` (linha 68, `/faturamento`)
- Modify: `docs/CHANGELOG.md`

**CONTEXT.md — novo termo, na seção Faturamento, após "Taxas Locais":**

> **Motivo de Bloqueio de Faturamento** — Categoria fechada que responde por que
> um B/L ainda não virou fatura. São três, e nenhuma é status marcado por
> alguém: *Sem cliente vinculado*, *Cálculo incompleto* e *Aguardando CE
> Mercante*. A confirmação do cálculo é o cadastro do CE Mercante — não existe
> ato separado de aprovação ou de marcação como pronto. Distinto de
> `charge_status`, que é registro interno do motor de cálculo e não é exibido ao
> operador.

**ADR 0041** registra: (a) a Validação é fila de bloqueios derivados, não painel
de estados; (b) o CE Mercante é o único confirmador do cálculo; (c) os atos de
aprovação e marcação em lote saem da tela — `charge_status='reviewed'` não tinha
consumidor algum (`isPendingBillingReview` continuava contando o B/L, e
`tryAutoIssueInvoice` nunca lia o campo); (d) falha de emissão vira Alerta.

- [ ] **Step 1: Escrever a ADR** seguindo o formato de `docs/adr/`.
- [ ] **Step 2: Atualizar** CONTEXT.md, índice de ADRs, RASTREABILIDADE.md e CHANGELOG.
- [ ] **Step 3: Run `npm run docs:check`.**
- [ ] **Step 4: Commit** `docs(faturamento): ADR 0041 e linguagem dos bloqueios`.

### Task 9: Verificação final

- [ ] `npm run docs:check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de
      `docs/plans/README.md`, no mesmo commit que conclui a execução.

## Riscos aceitos

- **`charge_status` fica sem superfície de escrita em lote.** A ação por B/L da
  ficha permanece; se a operação depender do lote, isso aparece rápido.
- **Faturados e isentos saem da vista por padrão.** O filtro `includeResolved`
  os traz de volta; faturas têm aba própria.
- **"Cálculo incompleto" junta seis causas de dois donos diferentes.** Decisão
  consciente; revisitar se o conserto divergir sistematicamente.
