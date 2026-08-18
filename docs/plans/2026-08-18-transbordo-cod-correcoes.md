# Transbordo e COD — correções de regressão, regra de negócio e UI

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans` para executar task a task. Steps usam
> checkbox (`- [ ]`).

**Goal:** restaurar duas regressões P0 introduzidas pela migration `215`,
implementar a regra da [ADR 0051](../adr/0051-cod-reprecifica-no-destino-final.md)
(COD reprecifica a Taxa Local no destino final, com Ajuste de COD registrado),
tornar a omissão reversível e auditável, e corrigir as superfícies de Viagens,
ficha do B/L, Line-Up e Portal.

**Architecture:** as RPCs de `supabase/migrations/174`/`201`/`215` continuam
sendo a fronteira de escrita (`SECURITY DEFINER`, `auth.uid()`,
`is_active_user()`, `changed_by = auth.uid()`), conforme ADR 0004 e ADR 0046. O
registro global da omissão permanece em `voyage_omissions`; a disposição
individual permanece em `bl_transshipments`. O efeito financeiro novo entra por
RPC própria chamada dentro da transação do COD, e a **emissão** do documento de
ajuste permanece no módulo de Taxas Locais.

**Tech Stack:** React + TypeScript, TanStack Query, Vitest, Supabase
(migrations SQL numeradas sequencialmente a partir de `306` — ADR 0016).

**Fontes obrigatórias:** [auditoria de 2026-08-18](../archive/audits/2026-08-18-revisao-transbordo-cod.md);
[ADR 0051](../adr/0051-cod-reprecifica-no-destino-final.md);
[ADR 0022](../adr/0022-omissao-escala-transbordo-cod-registro-operacional.md);
[ADR 0038](../adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md) e
[ADR 0040](../adr/0040-vigencia-da-tabela-de-taxas-e-informativa.md);
`supabase/migrations/174`, `177`, `201`, `215`, `274`; skill `supabase-migration`.

**Pré-condição confirmada pela operação:** não existem CODs nem transbordos em
produção. Nenhuma task precisa de backfill ou migração de dados.

---

## Onda 1 — Regressões P0 (independentes, podem ir primeiro)

### Task 1: Migration — restaurar `omit_voyage_escala`

**Files:**
- Create: `supabase/migrations/306_restore_omit_voyage_escala.sql`

- [ ] **Step 1:** Ler `201_voyage_omission_global_transshipment.sql` e
  `215_rbac_voyages_customers_writes.sql` lado a lado. Recriar
  `omit_voyage_escala` com a assinatura de 10 argumentos da `215`, restaurando
  do corpo da `201`:
  - o `INSERT INTO voyage_omissions` **com** `onward_vessel_name`,
    `onward_carrier`, `onward_voyage_number`, `onward_etd`, `onward_eta`, cada
    um normalizado por `NULLIF(btrim(COALESCE(...,'')),'')`;
  - o `ON CONFLICT` correspondente — que a Task 3 vai substituir por erro, mas
    que aqui é restaurado fielmente para manter a mudança pequena e revisável;
  - a remoção do guard `v_omitted = v_discharge` (issue #355, migration `177`),
    mantendo apenas a recusa de valores vazios.
- [ ] **Step 2:** Preservar da `215` o `bl_id` na inserção de
  `portal_notifications` e a inserção em `bl_transshipments`. **Não** reintroduzir
  `can_edit_voyages()`: a migration `295` (ADR 0046) o removeu de todo o schema.
- [ ] **Step 3:** Run: `npm test -- src/services/__tests__/voyageOmissionsMigration.test.ts src/services/__tests__/voyageOmissionGlobalMigration.test.ts` — Expected: PASS.
- [ ] **Step 4:** Commit: `fix: restaura captura de dados de transbordo e omissao de POD unico em omit_voyage_escala`

### Task 2: Teste de contrato que enxerga a definição final

**Files:**
- Create: `src/services/__tests__/rpcFinalDefinition.test.ts`
- Modify: `src/services/__tests__/voyageOmissionGlobalMigration.test.ts`

Este é o achado P0-3: os testes atuais fixam um arquivo de migration, então a
`215` desfez a `201` sem que nada quebrasse.

- [ ] **Step 1: Write the failing test** — helper que varre
  `supabase/migrations/*.sql` em ordem numérica, encontra a **última**
  ocorrência de `CREATE [OR REPLACE] FUNCTION public.<nome>` para uma função e
  devolve esse corpo. Sobre `omit_voyage_escala`, asserir: grava os cinco campos
  `onward_*`; não contém `v_omitted = v_discharge`; insere `bl_id` na
  notificação. Rode **antes** da Task 1 para vê-lo falhar.
- [ ] **Step 2:** Run — Expected: FAIL (antes da Task 1), PASS (depois).
- [ ] **Step 3:** Aplicar o mesmo helper a `set_bl_cod`, `set_bl_transshipment`
  e `update_voyage_omission`, congelando os invariantes que a ADR 0051 vai
  passar a depender.
- [ ] **Step 4:** Ajustar `voyageOmissionGlobalMigration.test.ts` para deixar de
  afirmar comportamento a partir do arquivo `201` isolado — o que ele verifica
  passa a ser a definição final.
- [ ] **Step 5:** Commit: `test: contrato SQL le a definicao final composta das RPCs, nao um arquivo isolado`

---

## Onda 2 — Ciclo de vida da omissão

### Task 3: Reversão de omissão e proibição de re-omitir em silêncio

**Files:**
- Create: `supabase/migrations/307_revert_voyage_omission.sql`
- Modify: `src/services/transshipments.ts`, `src/hooks/useTransshipments.ts`
- Modify: `src/components/voyages/TransshipmentInfoCard.tsx`
- Test: `src/services/__tests__/revertVoyageOmissionMigration.test.ts`

- [ ] **Step 1:** RPC `revert_voyage_omission(p_omission_id, p_justification, p_changed_by)`:
  exige `is_admin()` e justificativa não vazia; **recusa** se qualquer
  `bl_transshipments` da omissão estiver com `disposition = 'cod'`, com mensagem
  nomeando a quantidade; grava `audit_logs` de `voyage_pod_schedule` com
  `field_name='omitted'`, `new_value='false'`; remove as linhas de
  `bl_transshipments` da omissão; apaga a `voyage_omissions`; insere
  `portal_notifications` de correção por B/L com cliente vinculado.
- [ ] **Step 2:** No mesmo arquivo, trocar o `ON CONFLICT (voyage_id, omitted_pod) DO UPDATE`
  de `omit_voyage_escala` por `RAISE EXCEPTION` — omitir duas vezes o mesmo POD
  passa a ser erro. Um caminho para criar, um para desfazer, nenhum para
  sobrescrever sem avisar.
- [ ] **Step 3:** Teste de contrato: reversão bloqueada com COD presente;
  reversão limpa `bl_transshipments`; notificação de correção criada;
  segunda omissão do mesmo POD levanta exceção; `anon` sem EXECUTE.
- [ ] **Step 4:** UI: ação "Reverter omissão" no `TransshipmentInfoCard`, visível
  só para Admin, com diálogo de justificativa obrigatória e resumo do impacto
  (quantos B/Ls, quantos clientes serão notificados). Invalidar as mesmas chaves
  de `useOmitEscala` mais `['voyage-timeline']`.
- [ ] **Step 5:** Run: `npm test -- src/services/__tests__/revertVoyageOmissionMigration.test.ts` — Expected: PASS.
- [ ] **Step 6:** Commit: `feat: omissao de escala reversivel por Admin com justificativa e notificacao de correcao`

### Task 4: Confirmação da omissão com resumo do impacto

**Files:**
- Modify: `src/components/voyages/OmitEscalaModal.tsx`
- Test: `src/components/voyages/__tests__/OmitEscalaModal.test.tsx`

- [ ] **Step 1: Write the failing test** — o submit não chama a mutation
  diretamente: exibe primeiro um resumo ("Salvador · N B/Ls · M clientes serão
  notificados") e exige confirmação.
- [ ] **Step 2:** Implementar, lendo a contagem dos B/Ls do POD já disponível no
  `VoyageCard`. Passar a contagem por prop em vez de nova query.
- [ ] **Step 3:** Run — Expected: PASS.
- [ ] **Step 4:** Commit: `feat: omissao de escala exige confirmacao com resumo do impacto`

---

## Onda 3 — Regra de negócio da ADR 0051

### Task 5: COD com confirmação e justificativa

**Files:**
- Create: `supabase/migrations/308_cod_justification.sql`
- Modify: `src/services/transshipments.ts`, `src/pages/BlDetalhe.tsx`, `src/components/bl/BlTransshipmentCard.tsx`
- Test: `src/components/bl/__tests__/BlTransshipmentCard.test.tsx`

- [ ] **Step 1:** `set_bl_cod` ganha `p_justification TEXT`, obrigatório e não
  vazio, gravado em `audit_logs.justification` no lugar da literal fixa
  `'COD apos omissao da escala de X'` — que passa a ser prefixo do texto do
  operador. Idem para `set_bl_transshipment` na reversão.
- [ ] **Step 2:** UI: "Marcar COD" abre diálogo com justificativa obrigatória e
  o aviso de que a ação altera o destino final e notifica o cliente. Hoje
  `BlDetalhe.tsx:203` dispara a mutation direto no clique.
- [ ] **Step 3:** Run: `npm test -- src/components/bl/__tests__/BlTransshipmentCard.test.tsx` — Expected: PASS.
- [ ] **Step 4:** Commit: `feat: COD exige confirmacao e justificativa auditada`

### Task 6: Reprecificação da Taxa Local no COD

**Files:**
- Create: `supabase/migrations/309_cod_reprices_local_charges.sql`
- Test: `src/services/__tests__/codRepricingMigration.test.ts`

Implementa as decisões 1, 2 e 4 da ADR 0051. Ler `274_charge_table_validity_is_informational.sql`
inteiro antes de escrever: `calculate_bl_local_charges` já recusa recálculo para
`financial_status IN ('invoiced','partially_paid','paid')`, e é essa recusa que
define os três ramos.

- [ ] **Step 1:** RPC `apply_cod_financial_effect(p_bl_id, p_omission_id, p_changed_by)`,
  chamada de dentro de `set_bl_cod` e de `set_bl_transshipment` (reversão), com
  três ramos por `bls.financial_status`:
  - **não faturado** → chama `calculate_bl_local_charges(p_recalculate => true)`;
  - **faturado, não pago** → registra pendência de "cancelar e reemitir",
    **sem** cancelar sozinha (ADR 0007/0009: cancelamento é ato deliberado);
  - **faturado e pago** → calcula a diferença entre o total vigente e o total
    pela tabela do novo destino e registra o **Ajuste de COD** pendente.
- [ ] **Step 2:** Nenhum ramo emite documento fiscal nem devolve dinheiro
  (decisão 3 da ADR 0051). O COD só calcula, registra e sinaliza.
- [ ] **Step 3:** Teste de contrato: cada ramo produz o efeito esperado; o COD
  nunca falha por causa do estado financeiro; a reversão é simétrica.
- [ ] **Step 4:** Run: `npm test -- src/services/__tests__/codRepricingMigration.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat: COD reprecifica a Taxa Local no destino final (ADR 0051)`

### Task 7: Ajuste de COD — pendência, complementar e restituição

**Files:**
- Create: `supabase/migrations/310_cod_adjustments.sql`
- Modify: `src/components/billing/` (fila de pendências de Taxas Locais)
- Test: `src/services/__tests__/codAdjustmentsMigration.test.ts`

- [ ] **Step 1:** Tabela `cod_adjustments` (grão: B/L × omissão) com o valor
  original, o valor no novo destino, a diferença assinada, o estado
  (`pending` → `settled` / `cancelled`) e o vínculo com o documento resultante.
  RLS de leitura por `is_active_user()`; escrita só por RPC.
- [ ] **Step 2:** Lado credor (sobrou dinheiro): reusar `invoice_refunds`
  (migration `111`), que já tem estados, RLS, RPCs (`list_invoice_refunds`,
  `settle_invoice_refund`) e UI em `InvoiceDetailModal`. Não criar mecanismo
  paralelo.
- [ ] **Step 3:** Lado devedor (faltou dinheiro): emissão de **Fatura
  Complementar de COD** pelo fluxo de invoice individual já existente, disparada
  pelo Financeiro a partir da pendência — nunca pelo COD.
- [ ] **Step 4:** Superfície: as pendências de Ajuste de COD aparecem na fila de
  Taxas Locais (`/taxas-locais`, ADR 0050), não na ficha do B/L — quem resolve é
  o Financeiro.
- [ ] **Step 5:** Run: `npm test -- src/services/__tests__/codAdjustmentsMigration.test.ts` — Expected: PASS.
- [ ] **Step 6:** Commit: `feat: Ajuste de COD com fatura complementar e restituicao (ADR 0051)`

### Task 8: Notificação de correção ao reverter COD

**Files:**
- Modify: `supabase/migrations/308_cod_justification.sql` (ou migration própria)
- Test: cobrir no teste de contrato da Task 5

- [ ] **Step 1:** `set_bl_transshipment` passa a inserir `portal_notifications`
  de correção quando `v_was = 'cod'`. Hoje o cliente recebe "Destino alterado
  (COD)" e nunca é avisado da reversão (achado P2-11).
- [ ] **Step 2:** Run — Expected: PASS.
- [ ] **Step 3:** Commit: `fix: reverter COD notifica o cliente da correcao`

---

## Onda 4 — Superfícies

### Task 9: Rota desviada por omissão e pendência de manifesto

**Files:**
- Modify: `src/components/voyages/voyageCardHelpers.tsx`, `src/components/voyages/VoyageManifestosTab.tsx`
- Test: `src/components/voyages/__tests__/voyageCardHelpers.test.tsx`

Implementa as decisões 8 e 9 da ADR 0051.

- [ ] **Step 1: Write the failing test** — `routeLabel` de uma rota cujo POD tem
  omissão vigente sai como `QINGDAO → SALVADOR → VITÓRIA` com o POD omitido
  marcado para tachado, mais um badge `OMISSÃO`. Rota sem omissão sai inalterada.
- [ ] **Step 2:** Implementar em `voyageCardHelpers.tsx:113`, recebendo as
  omissões da viagem. **Nenhuma mudança de schema**: a linha
  `(voyage, POL, POD omitido)` de `voyage_route_ce_master` permanece onde está,
  com o mesmo número — só a exibição ganha o desvio, e a `UNIQUE (voyage_id, pol, pod)`
  continua satisfeita porque as rotas documentais seguem distintas.
- [ ] **Step 3:** Quando uma rota tem B/Ls e **não** tem CE Master, trocar o `-`
  mudo de `VoyageManifestosTab.tsx:118` por pendência visível ("manifesto não
  informado"), apontando para o lápis da linha, que já edita o CE Master via
  `onEditPol`. É o caso do B/L em COD que cria uma rota nova.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `feat: rota desviada por omissao exibe o desvio e sinaliza manifesto pendente`

### Task 10: Line-Up marca escala omitida

**Files:**
- Modify: `src/services/lineup.ts`
- Test: `src/services/__tests__/lineup.omitted.test.ts`

- [ ] **Step 1: Write the failing test** — escala omitida produz linha com
  `omitted: true` e fica **fora** das contagens de pendência; a flag já vem de
  `listVoyageEscalaSchedulesByVoyageIds`.
- [ ] **Step 2:** Implementar em `lineup.ts:128-205`. Não remover a linha: a
  operação precisa ver que aquela carga desceu em outro lugar. O que não pode é
  ela contar como chegada pendente para sempre — escala omitida nunca recebe
  ATA/ATD.
- [ ] **Step 3:** Chip "Omitida" no Line-Up e no Line-Up TV, mesmo padrão visual
  já usado pelo ADR de escala omitida.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `fix: Line-Up marca escala omitida e a tira das pendencias`

### Task 11: Portal — card de COD, datas e motivo

**Files:**
- Modify: `src/pages/PortalOperacao.tsx`
- Test: `src/pages/__tests__/PortalOperacao.test.tsx`

- [ ] **Step 1: Write the failing test** — B/L com `disposition = 'cod'` renderiza
  card próprio ("Destino alterado para VITÓRIA (COD) — sua carga não seguirá em
  transbordo"), **sem** navio/armador/viagem/ETD/ETA; B/L em transbordo mantém o
  card atual; ETD/ETA saem formatados em pt-BR; o campo **Motivo** não aparece.
- [ ] **Step 2:** Implementar em `PortalOperacao.tsx:479`, que hoje recebe
  `disposition` e a ignora. Reusar o helper de data já usado em
  `TransshipmentInfoCard` em vez de imprimir o `TIMESTAMPTZ` cru.
- [ ] **Step 3:** O motivo da omissão é texto livre interno e nunca foi decidido
  publicá-lo — remover da projeção do Portal, não só da tela.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `fix: Portal distingue COD de transbordo, formata datas e nao publica o motivo interno`

---

## Onda 5 — Limpeza e documentação

### Task 12: Limpeza estrutural

**Files:**
- Modify: `src/components/voyages/VoyageCard.tsx`, `src/components/voyages/TransshipmentPanel.tsx`
- Modify: `src/hooks/useBlCockpit.ts`, `src/services/transshipments.ts`
- Create: `supabase/migrations/311_drop_dead_bl_transshipment_columns.sql`

- [ ] **Step 1:** Unificar os dois cards concorrentes. `TransshipmentInfoCard`
  (aba Visão) e `TransshipmentPanel` (fora das abas) exibem o mesmo registro
  global com vocabulário divergente. Manter um só e adotar **Porto de
  Transbordo**, o termo do `CONTEXT.md`.
- [ ] **Step 2:** Remover o fallback por porto de `useBlCockpit.ts:23`. A
  operação confirmou que não existe B/L chegando depois da omissão, então o
  fallback não protege nada — ele desenha o card e habilita "Marcar COD" para um
  vínculo inexistente, e a RPC recusa.
- [ ] **Step 3:** Dropar `bl_transshipments.onward_*` (mortas desde a `201`) e
  removê-las de `BlTransshipment`, do `SELECT` do serviço e dos testes. Limpar
  os parâmetros correspondentes de `set_bl_transshipment`.
- [ ] **Step 4:** `update_voyage_omission` só audita quando algum campo mudou de
  fato, e deixa de sobrescrever `reason` com `NULL` quando o campo vem vazio sem
  ter sido editado.
- [ ] **Step 5:** Run: `npm test && npm run lint` — Expected: PASS.
- [ ] **Step 6:** Commit: `refactor: um card de transbordo, colunas mortas removidas e auditoria sem ruido`

### Task 13: Documentação viva

**Files:**
- Modify: `docs/modules/viagens.md`, `docs/modules/portal-cliente.md`, `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`
- Modify: `docs/plans/README.md` (remover a linha deste plano ao concluir)

As correções de `CONTEXT.md`, da ADR 0038 e do índice de ADRs já foram feitas
junto com a ADR 0051; esta task cobre o que depende do código entregue.

- [ ] **Step 1:** `docs/modules/viagens.md` — catálogo de ações: corrigir a
  pré-condição de "Omitir escala" (não é Admin, é usuário ativo — ADR 0046);
  registrar que a omissão captura os dados de transbordo; acrescentar as ações
  "Reverter omissão" e "Marcar COD com justificativa"; registrar o efeito
  financeiro da ADR 0051.
- [ ] **Step 2:** `docs/RASTREABILIDADE.md:290` — trocar `can_edit_voyages()` por
  `is_active_user()` (migration `295`, ADR 0046) e acrescentar as RPCs novas.
- [ ] **Step 3:** `docs/modules/portal-cliente.md` — card de COD distinto do de
  transbordo; motivo da omissão não é publicado.
- [ ] **Step 4:** Registrar a entrega em `docs/CHANGELOG.md`.
- [ ] **Step 5:** Run: `npm run docs:check && npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 6:** Mover este plano para `docs/archive/plans/` e remover a linha
  de `docs/plans/README.md`, no mesmo change.
- [ ] **Step 7:** Commit: `docs: transbordo e COD alinhados ao codigo (ADR 0051)`

---

## Fora de escopo

Promover o **manifesto a entidade própria** — número, rota, porto de descarga
efetivo, estado ativo/cancelado e vínculo explícito B/L→manifesto — para
suportar cancelar um manifesto e consolidar seus CEs em outro. Hoje, em viagem
só-B/L, a associação é derivada de `(pol, pod)` e não há estado de cancelamento;
o cenário de consolidação não é representável. Exige desenho e entrevista
próprios, com perguntas que este plano não respondeu: um manifesto pode cobrir
mais de uma rota? o cancelamento é estado ou exclusão? o EDI Mercante acompanha?
