# Bloco 3 — Financeiro: implementação de alertas e notificações

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** implementar o contrato funcional do Bloco 3 — issue #522 — para
as telas financeiras, sem criar ocorrências para estados normais e sem violar
as invariantes de PIX, local charges, Granito e Demurrage.

**Arquitetura:** manter a decisão de negócio no produtor que conhece a
transição autoritativa: cálculo/emissão para bloqueios, cron para vencimentos,
importação para PIX inseguro e abertura de disputa para Portal. Todos esses
produtores atualizam o único alerta agregado da entidade `(entity_type,
entity_id)` e seus itens de pendência; condições simultâneas não criam alertas
duplicados. Alertas e Notificações Internas continuam canais distintos, e a
notificação usa a união dos departamentos dos itens ativos. O tratamento sempre
navega para a tela de correção definida na spec, e a resolução deriva do estado
financeiro confirmado.

**Stack:** React 19, React Router, TanStack Query, Supabase/Postgres,
`pg_cron`, Vitest, migrations SQL e os serviços de billing/reconciliação
existentes.

**Spec:** [`docs/spec/2026-08-16-bloco-522-financeiro-alertas-design.md`](../spec/2026-08-16-bloco-522-financeiro-alertas-design.md)

---

## Evidência e pré-condições

- [ ] Rebasear a branch de implementação sobre o `main` que contiver a
  documentação aprovada e conferir o estado final da PR #517 antes de alterar
  código.
- [ ] Ler o schema/RPCs efetivamente mergeados pela fundação E3/PR #517. Se a
  fundação de Notificações Internas ainda não estiver disponível, marcar as
  tasks de notificação como **BLOCKED** e não criar tabela, enum, RPC ou
  migration inventada no Bloco 3.
- [ ] Confirmar novamente as invariantes em
  `docs/adr/0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md`,
  `supabase/migrations/111_pix_exact_and_manual_overpayment_refunds.sql` e
  `supabase/migrations/158_demurrage_pix_window_conciliation.sql`.
- [ ] Confirmar que a integração do #520 expõe a revisão de cliente de modo
  consumível, para não duplicar ocorrências de cliente ausente/revisão.
- [ ] Confirmar que a mudança de qualidade de vínculo da PR #518 está presente
  ou, se não estiver, tratar a divergência como integração independente; ela
  não pode bloquear o catálogo financeiro de Granito.

## Task 1: Ajustar o catálogo e a resolução de destino

**Arquivos prováveis:**

- Modificar: `src/services/alerts.ts`
- Modificar: `src/pages/Alertas.tsx`
- Modificar: `src/components/billing/FinancialAlertsPanel.tsx`
- Testar: testes existentes de alerts e novos testes focados do catálogo

- [ ] Definir os tipos dos eventos ativos sem reutilizar rótulos genéricos como
  `billing` ou `demurrage` quando eles não identificarem uma ocorrência real.
- [ ] Representar a audiência e a unidade do evento no contrato usado pelos
  produtores, respeitando a fundação E3 para a entrega interna.
- [ ] Garantir deduplicação por tipo/unidade enquanto a condição estiver aberta
  e fechamento idempotente; não abrir uma pendência nova a cada renderização.
- [ ] Completar o destino de `portal_dispute_opened` quando
  `entity_type=demurrage_invoice`, levando o usuário para `/demurrage`.
- [ ] Não fazer o rótulo legado `demurrage` produzir alerta sem produtor
  correspondente.

## Task 2: Implementar bloqueios de cálculo e emissão automática

**Arquivos prováveis:**

- Modificar: `src/services/reviewBillingAutomation.ts`
- Modificar: `src/components/billing/validacaoPipeline.ts`
- Modificar: `src/pages/Faturamento.tsx`
- Modificar: `src/pages/Granite.tsx`
- Testar: testes de `reviewBillingAutomation`, pipeline de validação e fluxos
  Granito

- [ ] Produzir A2 somente quando uma tentativa autoritativa deixar uma
  pendência real, distinguindo `review:no_table`, revisão de cálculo, linhas
  inválidas e ausência inesperada de valor de `aguardando_ce`, `sem_cliente`,
  isenção e retornos previstos de `awaiting_flow`.
- [ ] Rotear causas de tabela/configuração para `/taxas-locais` e as demais
  causas locais para `/faturamento`.
- [ ] Manter `billing_auto_issue_failed` apenas para falhas efetivas de
  emissão, em Documentação para local e Equipamentos para Granito.
- [ ] Produzir o evento de taxa Granito ausente somente quando o cálculo
  confirmar que o BL deveria ser calculado e não há taxa ativa aplicável;
  direcionar para `/granito/taxas`.
- [ ] Não alertar `Aguardando CE` nem criar duplicata do fluxo #520.
- [ ] Testar fechamento após cálculo/emissão válida e reabertura após retorno
  da causa.

## Task 3: Separar vencimentos locais e Granito do Demurrage

**Arquivos prováveis:**

- Modificar: `src/services/alerts.ts`
- Modificar: `src/pages/Faturamento.tsx`
- Revisar sem alterar retroativamente: migrations que produzem
  `invoice_overdue`
- Testar: detector de vencimento e classificação de invoices

- [ ] Fazer o detector diário classificar invoice local como Documentação e
  invoice Granito como Equipamentos.
- [ ] Excluir Demurrage do detector, preservando a remoção de enforcement em
  `supabase/migrations/157_demurrage_drop_overdue.sql`.
- [ ] Fechar a ocorrência apenas com saldo zero/pagamento confirmado e cobrir
  reversão ou novo vencimento como reabertura.
- [ ] Manter severidade Normal e não implementar escalonamento por idade.
- [ ] Validar que `/faturamento` continua sendo a tela de correção para ambas
  as famílias.

## Task 4: Persistir e resolver PIX sem conciliação segura

**Arquivos prováveis:**

- Modificar: `src/services/reconciliacao.ts`
- Modificar: `src/pages/Reconciliacao.tsx`
- Modificar: tipos/hooks de reconciliação relacionados
- Criar migration/RPC somente após validar o schema da fundação e o schema
  financeiro atual
- Testar: `src/services/__tests__/reconciliacao*.test.ts` e testes SQL de
  contrato das RPCs

- [ ] Persistir, durante a importação, cada transação `unmatched` ou
  `ambiguous` que impeça confirmação segura, com `txid`, valor, data, motivo e
  identidade suficiente para a unidade ser uma transação, não uma invoice
  artificial.
- [ ] Emitir a ocorrência imediatamente para Documentação e Equipamentos; não
  emitir para Financeiro e não criar evento de “subida atrasada do extrato”.
- [ ] Exibir as ocorrências persistidas na reconciliação mesmo depois de a
  leitura do arquivo terminar ou a tela ser recarregada.
- [ ] Permitir que o usuário escolha/vincule uma invoice em `/reconciliacao`,
  mas fazer a confirmação final passar pelas RPCs financeiras existentes.
- [ ] Preservar para local o `txid` normalizado e valor exato da migration 111.
- [ ] Preservar para Demurrage as duas PTAX mais recentes aplicáveis à data do
  pagamento, o próprio `txid` e a quitação integral da ADR 0015/migration 158.
- [ ] Fechar a ocorrência somente após vínculo e liquidação confirmados; manter
  ou reabrir quando o vínculo for inválido/removido.
- [ ] Cobrir órfão estrito, `txid` duplicado, divergência de valor, conflito de
  data e match Demurrage fora da janela PTAX, sem permitir falso positivo.
- [ ] Se o schema necessário não puder ser derivado do banco atual e da
  fundação, parar a task como **BLOCKED** com o nome do objeto ausente e sua
  justificativa; não adivinhar migration.

## Task 5: Tratar disputa Demurrage e remover produtores sem ação

**Arquivos prováveis:**

- Revisar/alterar o produtor SQL de `portal_dispute_opened` em migration nova,
  sem editar migrations históricas
- Alterar produtores atuais de `portal_invoice_created` e
  `portal_consolidation_obsoleted` para histórico sem ocorrência de trabalho
- Modificar: `src/components/billing/InvoiceDetailModal.tsx`
- Testar: contratos SQL e testes de ações de invoice/Portal

- [ ] Manter `portal_dispute_opened` como Alerta + Notificação Interna para
  Equipamentos, com fechamento quando a disputa for resolvida.
- [ ] Retirar o Alerta/Notificação persistente de criação e obsolescência de
  consolidada, preservando auditoria/histórico quando o fluxo exigir.
- [ ] Retirar ou rebaixar os produtores persistentes de
  `invoice_payment_invalid` e `invoice_cancel_blocked`: feedback imediato da
  ação pode permanecer na interface, mas não é pendência do catálogo.
- [ ] Não reintroduzir alertas de Demurrage por vencimento, rótulo de UI, taxa
  ausente ou PTAX fora da janela sem ADR explícita.

## Task 6: Verificação de canais, fechamento e não-produção

**Arquivos:** os arquivos alterados nas Tasks 1–5 e testes de integração
disponíveis.

- [ ] Para cada evento ativo, executar o caminho produtor → item no agregado →
  audiência derivada dos itens ativos → destino → fechamento do item →
  atualização/fechamento do agregado → reabertura no mesmo agregado.
- [ ] Testar que cálculo, vencimento, PIX e disputa para a mesma entidade
  atualizam um único alerta, preservando itens resolvidos no histórico e
  removendo somente o departamento do item resolvido da audiência.
- [ ] Para cada decisão “Nenhum”, provar por teste ou inspeção de contrato que
  não há insert persistente; especialmente `Aguardando CE`, consolidada do
  Portal, Demurrage overdue e guards transitórios.
- [ ] Verificar que não existe chamada direta para Financeiro em nenhum evento
  do bloco.
- [ ] Verificar que a importação PIX não perde candidatos órfãos ao desmontar
  a tela e que a resolução não ignora as validações financeiras.
- [ ] Executar `npm run typecheck`, `npm run lint`, testes focados, `npm test`,
  `npm run build`, `npm run docs:check` e `git diff --check`.
- [ ] Revisar migrations com `supabase db diff`/validação equivalente do
  workflow do projeto antes de abrir a PR de implementação.

## Task 7: Entrega e encerramento do bloco

**Arquivos:** documentação de entrega e índices, conforme o estado real.

- [ ] Abrir PR separada com o corpo:

  ```text
  PR type: implementation
  Part of #519
  Closes #522
  ```

- [ ] Não fechar #522 enquanto implementação e verificação não estiverem
  mergeadas.
- [ ] Atualizar #519 com o formato do épico, distinguindo documentação,
  implementação, dependências e bloqueios.
- [ ] Só depois da verificação completa mover esta spec e este plano para os
  arquivos históricos e retirar suas linhas dos índices vivos.

## Bloqueios conhecidos

- **BLOCKED:** Notificações Internas dependem da fundação E3/PR #517 e do
  schema/RPCs que forem efetivamente mergeados. O bloco não deve inventar esse
  contrato.
- **Não bloqueado:** a persistência de PIX órfão é uma lacuna de implementação
  identificada no schema atual; deve ser desenhada contra o banco real na task
  correspondente.
- **Não bloqueado:** Granito segue com Equipamentos mesmo que a qualidade do
  vínculo de cliente precise de evolução no #520 ou em trabalho posterior.
