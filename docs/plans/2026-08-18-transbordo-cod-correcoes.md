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

Toda RPC antiga deve ser editada a partir da definição viva depois da migration
`295`, nunca copiando cegamente o corpo da `215`: a `295` reescreve funções com
`pg_get_functiondef` dentro de `DO $$`, e remove `can_edit_voyages()` do schema.
Toda RPC nova deve declarar `REVOKE`/`GRANT` explicitamente porque a `297`
removeu o `EXECUTE` padrão. Helpers financeiros internos não recebem
`EXECUTE` de clientes; derivam o ator de `auth.uid()` ou validam qualquer ator
recebido contra ele.

**Tech Stack:** React + TypeScript, TanStack Query, Vitest, Supabase
(migrations SQL numeradas sequencialmente a partir de `308` — ADR 0016),
PostgreSQL local descartável via `scripts/setup-local-pg.sh` para contratos de
definição final.

**Fontes obrigatórias:** [auditoria de 2026-08-18](../archive/audits/2026-08-18-revisao-transbordo-cod.md);
[ADR 0051](../adr/0051-cod-reprecifica-no-destino-final.md);
[ADR 0022](../adr/0022-omissao-escala-transbordo-cod-registro-operacional.md);
[ADR 0038](../adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md) e
[ADR 0040](../adr/0040-vigencia-da-tabela-de-taxas-e-informativa.md);
`supabase/migrations/174`, `177`, `201`, `215`, `274`, `295`, `297`; migration
`108` para o bloqueio financeiro; migrations `111` e `112` para restituições;
skill `supabase-migration`.

**Pré-condição confirmada pela operação:** não existem CODs nem transbordos em
produção. Nenhuma task precisa de backfill ou migração de dados.

**Pré-condição para fechar as portas de re-omissão/fallback:** a operação
confirmou que não existe B/L importado depois da omissão. Por isso a Task 3
transforma a segunda omissão em erro e a Task 12 remove o fallback por porto.
Se essa premissa mudar, parar antes dessas tasks e abrir uma decisão de domínio
com um caminho explícito de relink/backfill para B/L tardio; não reintroduzir o
fallback silenciosamente.

## Base: o que a PR 550 mudou embaixo deste plano

A auditoria que originou este plano foi escrita contra `1d95a7c`. Depois dela a
PR 550 (escala com múltiplos terminais, migrations `306` e `307`) entrou no
`main`. Nenhum achado caiu — a `306` não recria `omit_voyage_escala`,
`set_bl_cod` nem `set_bl_transshipment`, então as duas regressões P0 continuam
vivas exatamente como descritas. O que mudou é o terreno:

- **Números de migration.** `306` e `307` estão ocupados; este plano começa em
  `308`.
- **A flag `omitted` ganhou consumidores novos.** Além de
  `voyageRouteSchedules.ts`, a migration `306` lê o último `audit_logs` de
  `voyage_pod_schedule`/`omitted` em `save_voyage_escala_terminal_state` (para
  recomputar o status da viagem ignorando escalas omitidas) e em
  `detect_agency_report_deadline_missed`. A reversão da Task 3 escreve
  `new_value='false'` e portanto *volta* a escala para essas contagens — é
  efeito desejado, mas precisa estar no teste.
- **Escala e terminal são ortogonais à omissão.** A identidade da escala
  continua `(voyage_id, port)`, a mesma da omissão. Terminais
  (`voyage_escala_terminal_state`), frentes (`voyage_escala_operation_fronts`) e
  ADRs (`agency_departure_reports`, agora `(viagem, porto, terminal)`) penduram
  nessa mesma chave. **Nenhuma task deste plano cria, move ou apaga essas
  linhas**: omitir ou reverter não mexe em terminal, frente nem ADR. Um ADR de
  escala omitida simplesmente não gera alerta, porque
  `detect_agency_report_department_pending` só dispara depois do ATD e escala
  omitida nunca recebe ATD.
- **A carga em transbordo continua contada pelo porto de descarga real.**
  `getAgencyReportDerivedData(voyageId, port)` apura por porto; o recorte por
  terminal vem da atribuição da frente em `deriveAgencyReportByTerminal`. Isso
  já funciona e não é escopo deste plano — não reabrir.
- **Line-Up foi reescrito.** `fetchLineUpSnapshot` agora emite até duas linhas
  por escala (`rowType: 'import' | 'export'`) e projeta terminais em
  `importTerminal`/`exportTerminal`. A Task 10 mudou de alvo por causa disso.
- **Query keys novas.** `queryKeys.voyages.escalaTerminalAll()`,
  `queryKeys.voyages.escalaSchedules()` (sem argumento) e
  `queryKeys.agencyReports.all()` existem desde a `550`; toda invalidação de
  omissão precisa considerá-las.
- **`/taxas-locais` é a operação e `/taxas-locais/tabelas` é o cadastro**
  (ADR 0050, PR 549). `Faturamento.tsx` não existe mais e `/faturamento` é
  apenas redirect — nenhuma task pode apontar para lá.

---

## Onda 1 — Regressões P0 (independentes, podem ir primeiro)

### Task 1: Teste de contrato que enxerga a definição final

**Files:**
- Create: `src/integration/rpcFinalDefinition.local-pg.test.ts`
- Modify: `src/services/__tests__/voyageOmissionGlobalMigration.test.ts`

Este é o achado P0-3: os testes atuais fixam um arquivo de migration, então a
`215` desfez a `201` sem que nada quebrasse.

- [ ] **Step 1: Write the failing test** — seguir o padrão já existente em
  `src/integration/*.local-pg.test.ts` (`adminUsuarios`,
  `agencyReportCloserName`): `describe.skip` sem `LOCAL_PG_INTEGRATION=1` e
  `psql -v ON_ERROR_STOP=1` contra `LOCAL_DATABASE_URL`. Usar o banco
  descartável criado por `bash scripts/setup-local-pg.sh --reset`, reaplicar
  todas as migrations — incluindo a `306` e a `307` — e consultar
  `pg_get_functiondef` no banco para as
  assinaturas finais de `omit_voyage_escala`, `set_bl_cod`,
  `set_bl_transshipment` e `update_voyage_omission`. Para
  `omit_voyage_escala`, asserir os cinco campos `onward_*`, ausência de
  `v_omitted = v_discharge` e `bl_id` na notificação. O teste deve ser rodado
  **antes da migration 308** e falhar por observar a definição efetiva da
  `215`, não por uma regex.
- [ ] **Step 2:** Manter um scanner textual como rede secundária, se útil, mas
  documentar no teste que ele é cego a reescritas por `DO`/`pg_get_functiondef`
  e a grants. Ele não pode ser a prova do P0-3.
- [ ] **Step 3:** Aplicar as mesmas consultas de definição final a
  `set_bl_cod`, `set_bl_transshipment` e `update_voyage_omission`, congelando os
  invariantes da ADR 0051 e a ausência de `can_edit_voyages()`.
- [ ] **Step 4:** Ajustar `voyageOmissionGlobalMigration.test.ts` para deixar de
  afirmar comportamento a partir do arquivo `201` isolado; a prova de
  composição passa a ser o teste local-PG desta task.
- [ ] **Step 5:** Rodar este teste novamente depois da Task 2 — Expected: PASS.
- [ ] **Step 6:** Commit: `test: contrato SQL consulta a definicao final composta das RPCs`

### Task 2: Migration — restaurar `omit_voyage_escala`

**Files:**
- Create: `supabase/migrations/308_restore_omit_voyage_escala.sql`

- [ ] **Step 1:** Ler `201_voyage_omission_global_transshipment.sql` e
  `215_rbac_voyages_customers_writes.sql` lado a lado, mas partir da definição
  viva pós-`295`. Recriar `omit_voyage_escala` com a assinatura de 10 argumentos
  da `215`, restaurando do corpo da `201`:
  - o `INSERT INTO voyage_omissions` **com** `onward_vessel_name`,
    `onward_carrier`, `onward_voyage_number`, `onward_etd`, `onward_eta`, cada
    um normalizado por `NULLIF(btrim(COALESCE(...,'')),'')`;
  - o `ON CONFLICT` correspondente — que a Task 3 vai substituir por erro, mas
    que aqui é restaurado fielmente para manter a mudança pequena e revisável;
  - a remoção do guard `v_omitted = v_discharge` (issue #355, migration `177`),
    mantendo apenas a recusa de valores vazios.
- [ ] **Step 2:** Preservar da definição viva o `bl_id` na inserção de
  `portal_notifications` e a inserção em `bl_transshipments`. **Não** copiar
  `can_edit_voyages()` da `215`: a migration `295` (ADR 0046) o removeu de todo
  o schema.
- [ ] **Step 3:** Rodar o contrato da Task 1 e os testes unitários de migration:
  `npm test -- src/services/__tests__/voyageOmissionsMigration.test.ts src/services/__tests__/voyageOmissionGlobalMigration.test.ts` — Expected: PASS.
- [ ] **Step 4:** Commit: `fix: restaura captura de dados de transbordo e omissao de POD unico em omit_voyage_escala`

---

## Onda 2 — Ciclo de vida da omissão

### Task 3: Reversão de omissão e proibição de re-omitir em silêncio

**Files:**
- Create: `supabase/migrations/309_revert_voyage_omission.sql`
- Modify: `src/services/transshipments.ts`, `src/hooks/useTransshipments.ts`
- Modify: `src/components/voyages/TransshipmentInfoCard.tsx`
- Test: `src/services/__tests__/revertVoyageOmissionMigration.test.ts`

- [ ] **Step 1:** RPC `revert_voyage_omission(p_omission_id, p_justification, p_changed_by)`:
  exige `is_admin()` e justificativa não vazia; valida
  `p_changed_by = auth.uid()`; **recusa** se qualquer `bl_transshipments` da
  omissão estiver com `disposition = 'cod'`, com mensagem nomeando a
  quantidade; grava `audit_logs` de `voyage_pod_schedule` com
  `field_name='omitted'`, `new_value='false'`; remove as linhas de
  `bl_transshipments` da omissão; apaga a `voyage_omissions`; insere
  `portal_notifications` de correção por B/L com cliente vinculado. A linha de
  auditoria é obrigatória: `voyageRouteSchedules.ts:900` deriva dela a flag
  `omitted`; um simples `DELETE` deixaria a escala omitida para sempre. Depois
  da `306` essa flag tem mais dois leitores —
  `save_voyage_escala_terminal_state`, que recomputa o status da viagem
  ignorando escalas omitidas, e `detect_agency_report_deadline_missed` —, então
  o contrato deve asserir que a escala revertida volta a contar como ativa nos
  dois.
  `is_admin()` é a exceção de exclusão de registro operacional prevista na ADR
  0046; se a reversão virar soft-delete, reabrir a decisão antes de mudar esse
  gate.
- [ ] **Step 2:** No mesmo arquivo, trocar o `ON CONFLICT (voyage_id, omitted_pod) DO UPDATE`
  de `omit_voyage_escala` por `RAISE EXCEPTION` — omitir duas vezes o mesmo POD
  passa a ser erro. Um caminho para criar, um para desfazer, nenhum para
  sobrescrever sem avisar.
- [ ] **Step 3:** Conceder `EXECUTE` explicitamente em
  `revert_voyage_omission(...)` apenas a `authenticated`, revogando de `PUBLIC`
  e `anon` (a `297` removeu o default). Teste de contrato: reversão bloqueada
  com COD presente; reversão limpa `bl_transshipments`; notificação de correção
  criada; segunda omissão do mesmo POD levanta exceção; `anon` sem EXECUTE.
  Asserir também o que a RPC **não** faz: `voyage_escala_terminal_state`,
  `voyage_escala_operation_fronts` e `agency_departure_reports` da escala ficam
  intactos. Reverter uma omissão não desfaz alocação de terminal nem reabre
  ADR.
- [ ] **Step 4:** UI: ação "Reverter omissão" no `TransshipmentInfoCard`, visível
  só para Admin, com diálogo de justificativa obrigatória e resumo do impacto
  (quantos B/Ls; clientes com vínculo serão notificados, sem prometer uma
  contagem que a tela não possui). Invalidar as mesmas chaves de `useOmitEscala`
  mais as que a PR 550 criou: `queryKeys.voyages.escalaSchedules()` (sem
  argumento), `queryKeys.voyages.escalaTerminalAll()` e
  `queryKeys.agencyReports.all()`. `['voyage-timeline']` já está em
  `useOmitEscala`; o que falta é o par terminal/ADR — e a mesma lista precisa
  entrar em `useOmitEscala`, não só na reversão.
- [ ] **Step 5:** Run: `npm test -- src/services/__tests__/revertVoyageOmissionMigration.test.ts` — Expected: PASS.
- [ ] **Step 6:** Commit: `feat: omissao de escala reversivel por Admin com justificativa e notificacao de correcao`

### Task 4: Confirmação da omissão com resumo do impacto

**Files:**
- Modify: `src/components/voyages/OmitEscalaModal.tsx`
- Test: `src/components/voyages/__tests__/OmitEscalaModal.test.tsx`

- [ ] **Step 1: Write the failing test** — o submit não chama a mutation
  diretamente: exibe primeiro um resumo ("Salvador · N B/Ls afetados · clientes
  com vínculo serão notificados") e exige confirmação.
- [ ] **Step 2:** Implementar usando somente o `blCount` por rota já disponível
  no `VoyageCard`, passado por prop — ele sobreviveu à PR 550 em
  `voyageCardHelpers.tsx:87` (tipo) e `:184` (projeção). Não calcular nem exibir `M clientes`: o
  card não tem essa informação e a RPC só notifica B/Ls com `customer_id IS NOT
  NULL`; se a contagem de clientes virar requisito, criar uma query de prévia
  com exatamente o mesmo predicado da RPC antes de mudar o texto.
- [ ] **Step 3:** Run — Expected: PASS.
- [ ] **Step 4:** Commit: `feat: omissao de escala exige confirmacao com resumo do impacto`

---

## Onda 3 — Regra de negócio da ADR 0051

### Task 5: COD com confirmação e justificativa

**Files:**
- Create: `supabase/migrations/310_cod_justification.sql`
- Modify: `src/services/transshipments.ts`, `src/pages/BlDetalhe.tsx`, `src/components/bl/BlTransshipmentCard.tsx`
- Test: `src/components/bl/__tests__/BlTransshipmentCard.test.tsx`

- [ ] **Step 1:** Editar as definições vivas pós-`295`, não copiar as funções da
  `215`. `set_bl_cod` ganha `p_justification TEXT`, obrigatório e não vazio,
  gravado em `audit_logs.justification` no lugar da literal fixa
  `'COD apos omissao da escala de X'` — que passa a ser prefixo do texto do
  operador; validar `p_changed_by = auth.uid()`. Idem para
  `set_bl_transshipment` na reversão. Antes de criar a assinatura nova, executar
  `DROP FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID)` para não deixar a
  sobrecarga antiga como caminho de COD sem justificativa.
- [ ] **Step 1b:** Como a `297` remove o `EXECUTE` padrão, revogar
  `PUBLIC`/`anon` e conceder explicitamente `EXECUTE` de cada assinatura pública
  (`set_bl_cod` e `set_bl_transshipment`) a `authenticated`; testar que a
  assinatura antiga não existe e que a nova é chamável.
- [ ] **Step 1c:** Fixar a ordem dos efeitos: capturar o POD anterior, atualizar
  `bls.pod` para o novo destino e só então chamar o efeito financeiro da Task 6b.
  Na reversão, restaurar o POD original antes de chamar o efeito simétrico.
  Nenhuma RPC pode recalcular enquanto `bls.pod` ainda aponta para o destino
  antigo.
- [ ] **Step 2:** UI: "Marcar COD" abre diálogo com justificativa obrigatória e
  o aviso de que a ação altera o destino final e notifica o cliente. Hoje
  `BlDetalhe.tsx:203` dispara a mutation direto no clique.
- [ ] **Step 3:** Run: `npm test -- src/components/bl/__tests__/BlTransshipmentCard.test.tsx` — Expected: PASS.
- [ ] **Step 4:** Commit: `feat: COD exige confirmacao e justificativa auditada`

### Task 6a: Extrair a resolução de preço de `calculate_bl_local_charges`

**Files:**
- Create: `supabase/migrations/311_extract_local_charge_resolution.sql`
- Test: `src/services/__tests__/localChargeResolutionMigration.test.ts`

Pré-requisito da Task 6b, e a parte mais arriscada do plano — por isso é task
própria. `calculate_bl_local_charges` tem ~500 linhas na migration `274`, com o
caminho de escrita entranhado no corpo: `DELETE FROM charge_calculations`,
`UPDATE public.bls` e **quatro** ramos distintos de `INSERT INTO
charge_calculations`. Não existe hoje um lugar único que responda "quais itens e
quais valores, para este B/L, neste POD".

A alternativa — escrever uma prévia que reimplemente essa resolução — foi
recusada deliberadamente: este plano existe porque uma definição duplicada
divergiu em silêncio (a `215` desfez a `201`). Duplicar a resolução de preço
repetiria o mesmo defeito, agora no motor de cobrança.

- [ ] **Step 1:** Ler `274_charge_table_validity_is_informational.sql` inteiro e
  mapear os quatro ramos de `INSERT`, anotando o que cada um resolve
  (tabela vigente, item, valor unitário, quantidade, override) e o que é
  específico daquele ramo.
- [ ] **Step 2:** Criar `resolve_bl_local_charge_items(p_bl_id, p_pod)`
  `RETURNS TABLE`, pura: sem `DELETE`, sem `INSERT`, sem `UPDATE`, sem a trava
  de B/L faturado. Ela recebe o POD **explicitamente** em vez de ler `bls.pod`,
  que é justamente o que a Task 6b precisa. Revogar `EXECUTE` de `PUBLIC`,
  `anon` e `authenticated`: é helper interno.
- [ ] **Step 3:** Reescrever os quatro ramos de `calculate_bl_local_charges`
  para consumirem essa função, passando `bls.pod`. O comportamento observável
  não muda — esta é uma refatoração, e os testes existentes de Taxas Locais são
  a rede.
- [ ] **Step 4:** Rodar a suíte de faturamento **antes e depois**, comparando os
  resultados: `npm test -- src/services/__tests__ src/pages/__tests__/TaxasLocais.test.ts` — Expected: PASS
  nos dois momentos, com os mesmos números. Se algum ramo mudar de resultado, a
  extração perdeu uma condição; parar e revisar em vez de ajustar o teste.
- [ ] **Step 5:** Teste de contrato: a função pura não escreve (chamá-la dentro
  de transação revertida e conferir `charge_calculations` intacta); ela aceita um
  POD diferente do `bls.pod` e devolve os itens daquele POD; `authenticated` não
  tem `EXECUTE`.
- [ ] **Step 6:** Commit: `refactor: resolucao de itens de Taxa Local vira funcao pura por POD explicito`

### Task 6b: Reprecificação da Taxa Local no COD

**Files:**
- Create: `supabase/migrations/312_cod_reprices_local_charges.sql`
- Test: `src/services/__tests__/codRepricingMigration.test.ts`

Implementa as decisões 1, 2 e 4 da ADR 0051, em cima da função pura da Task 6a.
`calculate_bl_local_charges` já recusa recálculo para
`financial_status IN ('invoiced','partially_paid','paid')`, e é essa recusa que
separa o primeiro ramo dos demais. A tabela `cod_adjustments` é criada nesta
migration antes da RPC que a grava; a Task 7 consome sua fila.

- [ ] **Step 1:** Criar `cod_adjustments` no grão B/L × omissão, com valor
  original, valor no novo destino, diferença assinada, `action` (incluindo
  `cancel_and_reissue`, `manual_charge_review`, `offset_open_balance` e
  `refund_overpayment`), estado (`pending` →
  `settled`/`cancelled`), flag de revisão manual e vínculo com o documento
  resultante. Guardar também **quanto já foi pago** no instante do COD: é o que
  separa abatimento de restituição, e ler isso depois, do saldo corrente, daria
  outro número. Aplicar RLS de leitura por `is_active_user()` e escrita só por
  RPC.
- [ ] **Step 2:** Usar `resolve_bl_local_charge_items(p_bl_id, p_pod)` da Task 6a
  como a prévia. Ela é obrigatória para os ramos faturados: a função de escrita
  é mutável e recusa exatamente esses estados. Não usar regex, `simulate`
  fictício, nem chamar a função de escrita em modo que produza efeitos.
- [ ] **Step 3:** Criar `apply_cod_financial_effect(p_bl_id, p_omission_id,
  p_previous_pod)` como helper interno, sem `p_changed_by`: derivar o ator por
  `auth.uid()`. Revogar `EXECUTE` de `PUBLIC`, `anon` **e** `authenticated` e
  testar a fronteira; apenas as RPCs `SECURITY DEFINER` pai o chamam.
- [ ] **Step 4:** Com `bls.pod` já atualizado pela Task 5, executar três ramos:
  - **não faturado** → chamar `calculate_bl_local_charges(p_recalculate => true)`
    pela tabela do novo POD; se houver linhas manuais, preservar sua intenção,
    criar `cod_adjustments` pendente com `manual_charge_review` e não esconder
    a revisão;
  - **faturado, não pago** → registrar `cod_adjustments` com
    `cancel_and_reissue`, sem cancelar sozinho (ADR 0007/0009: cancelamento é
    ato deliberado do Financeiro);
  - **faturado, pago em parte** → usar a prévia pura para comparar o total
    vigente com o total do novo POD e apurar a diferença **contra o saldo em
    aberto primeiro**. Diferença positiva vira Fatura Complementar de COD;
    diferença negativa vira `offset_open_balance` até o limite do saldo devedor,
    e só o excedente sobre o valor já pago vira `refund_overpayment`. Devolver a
    diferença cheia aqui devolveria dinheiro que nunca entrou;
  - **faturado e pago integralmente** → mesma prévia, e a diferença vira o
    **Ajuste de COD** pendente direto.
- [ ] **Step 5:** Fixar em teste a ordem `UPDATE bls.pod` → chamada do helper e
  asserir que a tabela resultante é a do novo destino, não apenas que o ramo
  rodou. A reversão deve restaurar o POD e repetir a mesma regra com os valores
  invertidos.
- [ ] **Step 6:** Nenhum ramo emite documento fiscal nem devolve dinheiro
  (decisão 3 da ADR 0051). O COD só calcula, registra e sinaliza.
- [ ] **Step 7:** Teste de contrato: cada ramo produz o efeito esperado; linhas
  manuais geram revisão explícita; prévia não escreve; chamadas diretas ao
  helper falham por privilégio; o COD nunca falha por causa do estado financeiro;
  a reversão é simétrica. Fixar o caso numérico da ADR 0051 — fatura de R$ 100
  com R$ 10 pagos reprecificada para R$ 80 produz abatimento de R$ 20 e
  **nenhuma** restituição —, mais o espelho em que o pago supera o devido e a
  restituição sai apenas pelo excedente.
- [ ] **Step 8:** Run: `npm test -- src/services/__tests__/codRepricingMigration.test.ts` — Expected: PASS.
- [ ] **Step 9:** Commit: `feat: COD reprecifica a Taxa Local no destino final (ADR 0051)`

### Task 7: Ajuste de COD — pendência, complementar e restituição

**Files:**
- Create: `supabase/migrations/313_cod_adjustment_settlement.sql`
- Modify: `src/hooks/useAuth.tsx`, `src/pages/TaxasLocais.tsx`, `src/components/billing/`
- Test: `src/services/__tests__/codAdjustmentsMigration.test.ts`

- [ ] **Step 1:** Usar a tabela `cod_adjustments` criada na migration `312`; não
  criar uma segunda tabela nem deixar a Task 6b referenciar uma migration futura.
- [ ] **Step 2:** Lado credor: separar **abatimento** de **restituição**. O
  abatimento (`offset_open_balance`) reduz o saldo em aberto da fatura original
  e nunca vira dinheiro de volta. Só o excedente sobre o que já entrou
  (`refund_overpayment`) chega ao lado credor propriamente dito.
- [ ] **Step 2b:** Para esse excedente, reusar `invoice_refunds` (tabela na
  migration `111`; RPCs `list_invoice_refunds` e `settle_invoice_refund` na
  migration `112`), que já tem estados, RLS e UI em `InvoiceDetailModal` — sem
  mecanismo paralelo. Duas mudanças de schema/autorização entram na migration
  `313`, ambas já decididas:
  - **Origem do crédito.** `invoice_refunds.payment_id` passa a aceitar `NULL` e
    entra `cod_adjustment_id BIGINT REFERENCES cod_adjustments(id)`, com
    `CHECK` exigindo **exatamente uma** das duas origens preenchida. A tabela
    deixa de ser "excedente de pagamento" e vira "crédito ao cliente" com
    procedência declarada. Isso preserva o `ON DELETE CASCADE` onde ele faz
    sentido — estornar o pagamento apaga a restituição que nasceu dele — sem
    aplicá-lo a um crédito de COD, que não veio de pagamento nenhum. Ancorar o
    crédito de COD num pagamento existente foi recusado justamente por isso:
    estornar aquele pagamento apagaria a restituição em silêncio.
  - **Quem liquida.** Criar `public.is_financeiro_user()` — `role IN ('admin',
    'administrativo', 'financeiro')` e `active` —, com `REVOKE`/`GRANT`
    explícitos (a `297` removeu o `EXECUTE` padrão). Trocar `is_admin()` por ele
    **somente** nas policies de `INSERT`/`UPDATE` de `invoice_refunds`, nas de
    escrita de `cod_adjustments` e no gate de `settle_invoice_refund`. Não
    alargar `is_admin()`: ele aparece em ~60 migrations como porta geral de
    administração, e alargá-lo daria a `financeiro` painel admin, gestão de
    usuários e provisionamento do Portal de uma vez. A leitura já está aberta a
    qualquer usuário ativo desde a `291` — o buraco é só na escrita.
- [ ] **Step 2c:** Teste de contrato da `313`: `financeiro` liquida uma
  restituição e escreve em `cod_adjustments`; `operacoes` e `equipamentos` são
  recusados com `42501`; `anon` sem `EXECUTE`; crédito com as duas origens
  preenchidas viola o `CHECK`; crédito com nenhuma também; estorno de pagamento
  não apaga restituição de origem COD.
- [ ] **Step 2d:** Espelhar o gate no front. Hoje o `switch` de
  `roleHasPermission` (`src/hooks/useAuth.tsx:24-32`) devolve `false` para
  `financeiro` em toda permissão, então a ação de liquidar ficaria visível e
  falharia com `42501` no clique. Acrescentar o valor à união `Permission`
  (`useAuth.tsx:13-16`) e concedê-lo a `administrativo` e `financeiro`, com
  teste em `src/hooks/__tests__/roleHasPermission.test.ts`, que já varre os três
  perfis sem permissão.
- [ ] **Step 3:** Lado devedor (faltou dinheiro): emissão de **Fatura
  Complementar de COD** pelo fluxo de invoice individual já existente, disparada
  pelo Financeiro a partir da pendência — nunca pelo COD.
- [ ] **Step 4:** Para o ramo faturado e não pago, a fila exibe a pendência de
  cancelar e reemitir. A ADR 0051 já está redigida assim (a RPC registra, o
  Financeiro executa); a fila não pode executar o cancelamento sozinha.
- [ ] **Step 5:** Superfície: as pendências de Ajuste de COD aparecem na fila da
  **operação** de Taxas Locais (`/taxas-locais`, `src/App.tsx:179`,
  `src/pages/TaxasLocais.tsx`), não na ficha do B/L — quem resolve é o
  Financeiro. Pela ADR 0050, `/taxas-locais/tabelas` é cadastro de tabelas e
  overrides e **não** recebe pendência; `/faturamento` virou redirect e
  `Faturamento.tsx` não existe mais, então nenhum link novo aponta para lá.
- [ ] **Step 6:** Run: `npm test -- src/services/__tests__/codAdjustmentsMigration.test.ts` — Expected: PASS.
- [ ] **Step 7:** Commit: `feat: Ajuste de COD com fatura complementar e restituicao (ADR 0051)`

### Task 8: Notificação de correção ao reverter COD

**Files:**
- Create: `supabase/migrations/314_revert_cod_notification.sql`
- Test: cobrir no teste de contrato da Task 5

- [ ] **Step 1:** `set_bl_transshipment` passa a inserir `portal_notifications`
  de correção quando `v_was = 'cod'`. Hoje o cliente recebe "Destino alterado
  (COD)" e nunca é avisado da reversão (achado P2-11). Editar a definição viva
  pós-`295`, validar `p_changed_by = auth.uid()` e repetir os grants explícitos
  da Task 5; não reintroduzir `can_edit_voyages()` a partir da `215`.
- [ ] **Step 2:** Run — Expected: PASS.
- [ ] **Step 3:** Commit: `fix: reverter COD notifica o cliente da correcao`

---

## Onda 4 — Superfícies

### Task 9: Rota desviada por omissão e pendência de manifesto

**Files:**
- Modify: `src/components/voyages/voyageCardHelpers.tsx`, `src/components/voyages/VoyageManifestosTab.tsx`
- Test: `src/components/voyages/__tests__/voyageCardHelpers.test.tsx`

Implementa a consequência da decisão 6 da ADR 0051 e os achados 8–9 da
auditoria — não existem decisões 8 e 9 na ADR 0051.

- [ ] **Step 1: Write the failing test** — `routeLabel` de uma rota cujo POD tem
  omissão vigente sai como `QINGDAO → SALVADOR → VITÓRIA` com o POD omitido
  marcado para tachado, mais um badge `OMISSÃO`. Rota sem omissão sai inalterada.
- [ ] **Step 2:** Implementar em `voyageCardHelpers.tsx:113`, recebendo as
  omissões da viagem. **Nenhuma mudança de schema**: a linha
  `(voyage, POL, POD omitido)` de `voyage_route_ce_master` permanece onde está,
  com o mesmo número — só a exibição ganha o desvio, e a `UNIQUE (voyage_id, pol, pod)`
  continua satisfeita porque as rotas documentais seguem distintas.
- [ ] **Step 3:** Quando uma rota tem B/Ls e **não** tem CE Master, trocar o `-`
  mudo de `VoyageManifestosTab.tsx:119` por pendência visível ("manifesto não
  informado"), apontando para o lápis da linha, que já edita o CE Master via
  `onEditPol`. É o caso do B/L em COD que cria uma rota nova.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `feat: rota desviada por omissao exibe o desvio e sinaliza manifesto pendente`

### Task 10: Line-Up marca escala omitida

**Files:**
- Modify: `src/services/lineup.ts`, `src/components/lineup/LineUpTable.tsx`, `src/pages/LineUpTVDisplay.tsx`
- Test: `src/services/__tests__/lineupSnapshot.test.ts`

Esta task foi reescrita depois da PR 550: o Line-Up mudou de forma, não de
intenção. Ler `src/services/lineup.ts` antes de mexer.

- [ ] **Step 1: Write the failing test** — estender
  `lineupSnapshot.test.ts` (criado pela PR 550, já com fixtures de escala,
  terminal e frente) em vez de abrir um arquivo novo: escala omitida produz
  linha com `omitted: true` e fica **fora** das contagens de pendência; a flag
  já vem de `listVoyageEscalaSchedulesByVoyageIds` em
  `VoyageEscalaSchedule.omitted`.
- [ ] **Step 2:** Acrescentar `omitted: boolean` ao tipo `LineUpRow`
  (`lineup.ts:48-79`) e preenchê-lo dentro de `fetchLineUpSnapshot`
  (`lineup.ts:162-376`), no laço `for (const pod of routePods)`, a partir de
  `escalasByPort.get(pod)`. A PR 550 passou a emitir **até duas linhas por
  escala** (`rowType: 'import' | 'export'`): as duas descrevem a mesma escala,
  então as duas recebem a mesma flag. Não remover a linha: a operação precisa
  ver que aquela carga desceu em outro lugar. O que não pode é ela contar como
  chegada pendente para sempre — escala omitida nunca recebe ATA/ATD.
- [ ] **Step 3:** Chip "Omitida" no Line-Up (`LineUpTable.tsx`) e no Line-Up TV
  (`LineUpTVDisplay.tsx`), mesmo padrão visual já usado pelo ADR de escala
  omitida. A coluna de terminal introduzida pela PR 550 continua a mesma: o
  chip convive com `importTerminal`/`exportTerminal` e **não** substitui o
  `TBC` de frente sem terminal — são dois sinais distintos (escala que não
  acontece × terminal ainda não atribuído).
- [ ] **Step 4:** Não mexer em `projectLineUpTerminals` nem em
  `hasActiveEscalaScheduleData`: a omissão não é ausência de dados de escala, e
  esconder a linha aqui desfaria o Step 2.
- [ ] **Step 5:** Run: `npm test -- src/services/__tests__/lineupSnapshot.test.ts` — Expected: PASS.
- [ ] **Step 6:** Commit: `fix: Line-Up marca escala omitida e a tira das pendencias`

### Task 11: Portal — card de COD, datas e motivo

**Files:**
- Modify: `src/pages/PortalOperacao.tsx`
- Modify: `src/services/portalOperation.ts`
- Create: `supabase/migrations/315_portal_operation_hide_omission_reason.sql`
- Test: `src/pages/__tests__/PortalOperacao.test.tsx`
- Test: `src/services/__tests__/portalOperation.test.ts`

- [ ] **Step 1: Write the failing test** — testar o payload retornado por
  `portal_list_operation_bls`, não só o DOM: B/L com `disposition = 'cod'` não
  recebe `reason`, e B/L em transbordo mantém os campos globais previstos. Na
  tela, B/L com `disposition = 'cod'` renderiza card próprio ("Destino alterado
  para VITÓRIA (COD) — sua carga não seguirá em transbordo"), **sem**
  navio/armador/viagem/ETD/ETA; B/L em transbordo mantém o card atual; ETD/ETA
  saem formatados em pt-BR; o campo **Motivo** não aparece.
- [ ] **Step 2:** Implementar em `PortalOperacao.tsx:479`, que hoje recebe
  `disposition` e a ignora. Reusar o helper de data já usado em
  `TransshipmentInfoCard` em vez de imprimir o `TIMESTAMPTZ` cru.
- [ ] **Step 3:** Criar a migration `315` para remover `reason` da projeção
  server-side de `portal_list_operation_bls`; atualizar
  `PortalOperationTransshipment` e o normalizador em `src/services/portalOperation.ts`
  para que o contrato não preserve esse campo. Revogar/reconceder os grants da
  função exatamente como nas migrations anteriores. Esconder `Motivo` apenas no
  JSX não é suficiente: hoje o texto interno ainda iria para todo cliente.
- [ ] **Step 4:** Run: `npm test -- src/pages/__tests__/PortalOperacao.test.tsx src/services/__tests__/portalOperation.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `fix: Portal distingue COD de transbordo, formata datas e nao publica o motivo interno`

---

## Onda 5 — Limpeza e documentação

### Task 12: Limpeza estrutural

**Files:**
- Modify: `src/components/voyages/VoyageCard.tsx`, `src/components/voyages/TransshipmentPanel.tsx`
- Modify: `src/hooks/useBlCockpit.ts`, `src/services/transshipments.ts`
- Create: `supabase/migrations/316_drop_dead_bl_transshipment_columns.sql`

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
  os parâmetros correspondentes de `set_bl_transshipment`. A migration exige
  regenerar `src/types/database.ts`: não editar o arquivo gerado manualmente;
  usar o gerador oficial e revisar o diff — a PR 550 já regenerou esse arquivo
  com as tabelas de terminal/frente, então o diff esperado é só a remoção das
  colunas `onward_*`; qualquer perda das tabelas da `306` indica geração contra
  um schema desatualizado. Como o arquivo e migrations são
  protegidos por `.claude/hooks/protect-files.sh`, qualquer override
  (`CLAUDE_ALLOW_PROTECTED=1`) só pode ser feito com autorização explícita e
  apenas durante a geração/aplicação necessária.
- [ ] **Step 3b:** Todas as alterações de RPC desta task partem da definição viva
  pós-`295`; confirmar no contrato da Task 1 que nenhum `can_edit_voyages()` ou
  grant implícito voltou.
- [ ] **Step 4:** `update_voyage_omission` só audita quando algum campo mudou de
  fato, e deixa de sobrescrever `reason` com `NULL` quando o campo vem vazio sem
  ter sido editado.
- [ ] **Step 5:** Run: `npm test && npm run lint` — Expected: PASS.
- [ ] **Step 6:** Commit: `refactor: um card de transbordo, colunas mortas removidas e auditoria sem ruido`

### Task 13: Documentação viva

**Files:**
- Modify: `docs/modules/viagens.md`, `docs/modules/portal-cliente.md`, `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`
- Modify: `docs/adr/0051-cod-reprecifica-no-destino-final.md`
- Modify: `docs/plans/README.md` (remover a linha deste plano ao concluir)

As correções de `CONTEXT.md`, da ADR 0038 e do índice de ADRs já foram feitas
junto com a ADR 0051; esta task cobre o que depende do código entregue.

- [ ] **Step 1:** `docs/modules/viagens.md` — catálogo de ações: corrigir a
  pré-condição de "Omitir escala" (não é Admin, é usuário ativo — ADR 0046);
  registrar que a omissão captura os dados de transbordo; acrescentar as ações
  "Reverter omissão" e "Marcar COD com justificativa"; registrar o efeito
  financeiro da ADR 0051.
- [ ] **Step 1b:** Conferir que a execução não divergiu da decisão 2 da ADR 0051:
  para B/L faturado e não pago, a RPC **registra a pendência** de cancelar e
  reemitir e o Financeiro executa o ato documental. A ADR já está redigida
  assim; se a implementação tiver cancelado sozinha, o defeito é do código, não
  do texto.
- [ ] **Step 2:** `docs/RASTREABILIDADE.md` — a troca de `can_edit_voyages()` por
  `is_active_user()` (migration `295`, ADR 0046) já foi aplicada junto com a
  ADR 0051; aqui resta apenas acrescentar as RPCs novas
  (`revert_voyage_omission`, `apply_cod_financial_effect`) e a tabela
  `cod_adjustments` à linha de `bl_transshipments`.
- [ ] **Step 3:** `docs/modules/portal-cliente.md` — card de COD distinto do de
  transbordo; motivo da omissão não é publicado.
- [ ] **Step 4:** Registrar a entrega em `docs/CHANGELOG.md`.
- [ ] **Step 5:** Run: `npm run docs:check && npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 6:** Mover este plano para `docs/archive/plans/` e remover a linha
  de `docs/plans/README.md`, no mesmo change.
- [ ] **Step 7:** Commit: `docs: transbordo e COD alinhados ao codigo (ADR 0051)`

---

## Fora de escopo

A regra para **escala somente de exportação** (`row.temImportacao === false`)
não foi decidida por documento de domínio. Este plano não pode inferir que ela
é omitível nem criar um bloqueio novo: a decisão deve ser registrada em ADR
própria, com teste de contrato e tarefa de UI/RPC antes de entrar no escopo de
uma execução futura.

Promover o **manifesto a entidade própria** — número, rota, porto de descarga
efetivo, estado ativo/cancelado e vínculo explícito B/L→manifesto — para
suportar cancelar um manifesto e consolidar seus CEs em outro. Hoje, em viagem
só-B/L, a associação é derivada de `(pol, pod)` e não há estado de cancelamento;
o cenário de consolidação não é representável. Exige desenho e entrevista
próprios, com perguntas que este plano não respondeu: um manifesto pode cobrir
mais de uma rota? o cancelamento é estado ou exclusão? o EDI Mercante acompanha?
