# Implementação do Bloco #521 — Clientes, Portal e Disputes

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:executing-plans`
> (ou `superpowers:subagent-driven-development`) para executar tarefa a tarefa.
> Passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** implementar o comportamento aprovado na especificação do Bloco
#521 para pendências de clientes, provisionamento do Portal, faturamento
dependente do Portal e Disputes de Demurrage.

**Especificação:**
[`2026-08-15-clientes-portal-alertas-design.md`](../spec/2026-08-15-clientes-portal-alertas-design.md)

**Issue:** [#521](https://github.com/luccafwlog/transhippingdesk/issues/521)

**Dependências:** arquitetura transversal de alertas/notificações; PR [#518](https://github.com/luccafwlog/transhippingdesk/pull/518), relevante
somente para implementar A3 (cliente sem e-mail agrupado por cliente), sem
bloquear as demais tarefas do bloco; regras do Bloco #520 para Revisão Manual;
bloco transversal de e-mails/notificações para os canais concretos do Portal.

## Resultado esperado

- Uma fonte canônica para pendências, com projeções em cliente, B/L, fila do
  Portal, `/alertas` e sino interno.
- Portal ativo e e-mail de recuperação utilizável como gate final obrigatório
  de faturamento.
- Ativação do Portal reprocessando B/Ls elegíveis de forma idempotente.
- Eventos normais registrados no histórico sem gerar ruído de alertas.
- Dispute de Demurrage como conversa estruturada entre cliente e Equipamentos,
  com mensagens, anexos, responsável pela próxima resposta e reabertura
  controlada.

## Evidência técnica de partida

- `/clientes`, `/clientes/:cnpj` e `/clientes/portal` possuem dados de Portal,
  mas ainda não uma projeção unificada de pendências.
- `alerts` ainda utiliza estados técnicos `open`, `acknowledged` e `closed`,
  não possui itens de pendência agregados nem uma audiência derivada dos itens,
  enquanto o produto deve expor uma pendência agregada por entidade.
- `portal-invite-activate` ativa a conta, mas ainda não reprocessa os B/Ls do
  cliente.
- O gate de Portal/e-mail não está garantido em todos os caminhos finais de
  emissão.
- `alerts.assigned_to` é uma FK para `auth.users(id)`, mas permanece sem uso
  nesta arquitetura: não representa departamento nem o destinatário do sino.
  A implementação precisa declarar a audiência por item de pendência e fazer
  fan-out para uma Notificação Interna por usuário ativo, sem escolher
  arbitrariamente um usuário e sem retirar a visibilidade dos demais.
- `portal_invoice_exception_on_issue` só está ligado a `UPDATE OF status`, mas
  os fluxos de emissão podem inserir invoices já como `issued`; existe uma
  lacuna de detecção para a exceção histórica.
- O gate atual aceita `matched_document` e `reconciled`; o segundo é o vínculo
  confirmado manualmente e não pode ser removido por uma redação de plano.
- `portal_open_demurrage_dispute` grava a contestação inicial, mas o modelo
  atual usa campos de texto em `demurrage_invoices`; não há conversa estruturada
  nem anexos por mensagem.
- A implantação deve preservar os fluxos já existentes de reconciliação do
  extrato do Itaú e o acesso amplo auditado dos usuários internos.
- Financeiro pode executar a consulta/reconciliação do extrato, mas não recebe
  alertas ou notificações deste bloco para enviar o StratoPIX ou tratar Portal.

## Ordem e bloqueios

As tarefas devem ser executadas nesta ordem lógica:

1. modelo canônico e auditoria;
2. projeções de cliente/Portal e ações de correção;
3. gate financeiro e reprocessamento pós-ativação;
4. Dispute e anexos;
5. interfaces, notificações e histórico;
6. rollout, testes e verificação.

O canal concreto de e-mail/notificação do Portal pode ser desenvolvido em
paralelo pelo bloco transversal, mas esta implementação deve publicar eventos e
destinatários de forma estável para consumi-lo.

## Task 1 — Modelo canônico de pendências e auditoria

**Arquivos prováveis:** migrations novas; `src/services/alerts.ts`; tipos
gerados; serviços compartilhados de projeção.

- [ ] Definir a representação persistente do alerta agregado por entidade e de
  seus itens de pendência. O par `(entity_type, entity_id)` identifica uma
  única fila agregada não resolvida; cada item mantém chave de origem, tipo,
  departamento, mensagem, destino, causa, timestamps, estado e histórico
  próprios.
- [ ] Criar a ligação persistente entre alerta agregado e itens, permitindo
  recomputar a lista ativa sem interpretar texto concatenado. Resolver um item
  não pode fechar os demais; o alerta só fecha quando não restar item que exija
  ação interna.
- [ ] Criar a representação persistente da audiência departamental por item,
  sem gravar o departamento em `alerts.assigned_to` e sem introduzir atribuição
  individual nesta rodada. O alerta agregado usa a união dos departamentos dos
  itens ativos; a entrega deve gerar uma Notificação Interna por usuário ativo
  de cada papel definido para esses itens.
- [ ] Definir a projeção de uma pendência para `/alertas`, sino, lista, ficha e
  entidade sem duplicar registros.
- [ ] Preservar resolução coletiva do alerta e leitura individual das
  notificações.
- [ ] Implementar deduplicação por entidade, com índice/guarda server-side que
  impeça mais de um alerta não resolvido para o mesmo `(entity_type,
  entity_id)`, independentemente do tipo. Os itens usam uma chave própria de
  origem para impedir duplicação da mesma condição dentro do agregado.
- [ ] Consolidar no rollout os alertas não resolvidos já existentes para a
  mesma entidade, unindo seus itens, mensagens, departamentos e destinos antes
  de encerrar duplicatas; nenhum histórico pode ser descartado.
- [ ] Criar auditoria para criação, atualização, resolução, reabertura e ações
  manuais sensíveis.
- [ ] Definir a migração dos estados técnicos atuais para a apresentação
  `Pendente`/`Resolvido`, sem reconhecimento como resolução e sem apagar
  histórico. Fechamento deriva da recomputação dos itens; leitura individual
  nunca altera o alerta. Se a fundação oferecer dispensa temporária, o plano
  deve consumir metadado com motivo, autor e revisão futura, sem fechar item,
  alerta ou liberar faturamento.
- [ ] Criar backfill que consolide, por cliente, as linhas não resolvidas de
  `portal_convite_expirado`, `portal_falha_envio`, `portal_email_suprimido`,
  `portal_abuso_login` e a pendência geral em um único alerta agregado,
  preservando cada razão como item e encerrando as linhas legadas com
  auditoria. A exceção crítica de invoice deve ser convertida em item do
  alerta agregado do B/L afetado, com referência à invoice. Linhas já fechadas
  permanecem no histórico.
- [ ] Catalogar para cada tipo a gravidade e o gatilho/frequência de detecção
  definidos na spec, incluindo a reconciliação de 15 minutos quando aplicável.
- [ ] Adicionar testes SQL-contract e testes de serviço para deduplicação,
  agregação por entidade, projeção, audiência por união de departamentos,
  resolução individual de item e resolução coletiva do alerta.

## Task 2 — Cliente, fila do Portal e reconciliação

**Arquivos prováveis:**
`src/pages/Clientes.tsx`, `src/pages/ClienteFicha.tsx`,
`src/pages/ClientesPortal.tsx`, componentes de clientes, serviços e RPCs
do Portal.

- [ ] Rejeitar CNPJ inválido e duplicado no cadastro/importação sem criar
  alerta persistente.
- [ ] Manter cliente sem processo ativo e sem contatos utilizáveis sem alerta.
- [ ] Criar/normalizar a conta de Portal antecipadamente em `Aguardando
  análise`, removendo `Provisionamento não necessário` de estados, filtros,
  labels, ações e decisões. A migration deve fazer backfill idempotente das
  contas históricas para `aguardando_analise`, preservar os eventos de auditoria,
  substituir a exclusão/fechamento baseada no literal por uma condição de B/L
  ativo, atualizar os read-models e substituir/revogar as RPCs que ainda
  gravam o estado removido.
- [ ] Promover cliente com processo ativo e Portal/e-mail pendente para um item
  no alerta agregado do cliente, agrupando razões simultâneas sem duplicar a
  linha da entidade.
- [ ] Confirmar reconciliação automática somente para `matched_document`, sem
  promover a pendência ao alerta geral do cliente; preservar `reconciled` como
  estado válido de vínculo manual e manter sugestão por nome/fuzzy match como
  pendência de validação.
- [ ] Adicionar no `/clientes` a exclamação para pendências próprias e resumo
  quantitativo/acionável dos B/Ls pendentes.
- [ ] Adicionar na ficha do cliente painel persistente com pendências próprias,
  B/Ls afetados, histórico e links de correção.
- [ ] Garantir que a fila do Portal permita a todos os usuários internos
  executar ações, mantendo justificativa e auditoria.
- [ ] Implementar ação explícita de usar e-mail de contato no Portal, com
  validação, supressão, invalidação de convites e reavaliação.
- [ ] Adicionar testes de comportamento para lista, ficha, fila, permissões
  amplas e correção de e-mail.

## Task 3 — Gate financeiro e reprocessamento após ativação

**Arquivos prováveis:**
`supabase/functions/portal-invite-activate/index.ts`, migrations de billing,
`src/services/reviewBillingAutomation.ts`, serviços de faturamento e páginas de
faturamento/B/L.

- [ ] Extrair uma verificação final única de Portal ativo e e-mail de
  recuperação utilizável.
- [ ] Aplicar a verificação no caminho final de toda emissão individual e
  consolidada, sem confiar apenas em `ready_for_billing` ou na interface.
- [ ] Criar item de pendência financeira por B/L quando o gate bloquear
  faturamento, incorporando a causa ao alerta agregado do B/L quando ele já
  existir.
- [ ] Fazer a ativação do Portal localizar B/Ls ativos ainda não faturados e
  reexecutar todas as verificações de elegibilidade.
- [ ] Incluir `matched_document` e `reconciled` como vínculos elegíveis para o
  reprocessamento. Nenhum B/L não faturado pode desaparecer por retorno nulo:
  se houver bloqueio, registrar a causa funcional no item do alerta agregado;
  se houver falha técnica, registrar alerta/item específico e ação de
  reprocessamento.
- [ ] Emitir individualmente cada B/L elegível, com idempotência e vínculo
  correto ao ledger.
- [ ] Manter itens funcionais para CE Mercante, revisão, taxa ou reconciliação
  que ainda impeçam emissão, dentro do alerta agregado do B/L.
- [ ] Criar alerta técnico específico e ação de reprocessamento quando a
  emissão automática falhar depois da ativação.
- [ ] Corrigir a exceção crítica de invoice para detectar tanto `INSERT` já em
  `issued` quanto a transição para `issued`, gerar alerta por B/L afetado com
  referência à invoice e executar backfill dos registros históricos que foram
  emitidos sem Portal/e-mail utilizável. A inserção deve atualizar o item do
  alerta agregado do B/L, não criar uma linha independente por invoice. Cobrir
  esse comportamento em critério de aceite e teste de contrato SQL.
- [ ] Garantir disponibilidade da invoice emitida nas consultas do Portal e
  registrar os eventos no cliente e no B/L.
- [ ] Preservar o comportamento de pagamento individual que obsoleta a
  consolidação relacionada; alertar apenas falhas de atualização.
- [ ] Adicionar testes de RPC, idempotência, gate final, ativação e falhas
  parciais por B/L.

## Task 4 — Histórico e classificação de eventos normais

**Arquivos prováveis:** `src/services/customerFicha.ts`, componentes das fichas,
serviços de eventos e migrations de histórico.

- [ ] Registrar criação de invoice pelo Portal na ficha do cliente e dos B/Ls,
  com link direto para a invoice.
- [ ] Registrar desconsolidação válida, pagamento individual e obsolescência
  automática da consolidada sem criar alerta pendente.
- [ ] Registrar bloqueio temporário normal de login como evento de segurança.
- [ ] Registrar convite pendente dentro da validade, quando não houver bloqueio
  de B/L, apenas como estado/histórico.
- [ ] Registrar motivo, histórico e resultado da Dispute também na ficha do
  cliente e na ficha da fatura; essas superfícies devem projetar o histórico
  canônico da conversa.
- [ ] Garantir que eventos não apareçam na fila de pendências nem criem
  exclamação vermelha.
- [ ] Adicionar testes de classificação evento versus pendência.

## Task 5 — Dispute de Demurrage como conversa

**Arquivos prováveis:** migrations novas para Dispute, serviços de Demurrage e
Portal, `/demurrage`, componentes de conversa, RLS e Storage.

- [ ] Criar entidade de conversa/Dispute preservando as Disputes históricas e
  vinculando cada caso à fatura de Demurrage.
- [ ] Separar os rótulos funcionais do estado do caso (Aberta, Resolvida,
  Cancelada) dos literais persistidos existentes (`aberto`, `resolvido`,
  `cancelado`) e do responsável pela próxima resposta (`cliente`,
  `equipamentos`, `ninguém`), sem quebrar as Disputes históricas.
- [ ] Criar mensagens imutáveis com autor/origem, data/hora, conteúdo e
  mudança de responsável pela próxima resposta.
- [ ] Criar anexos por mensagem, com Storage privado, metadados, RLS,
  validação de tipo/tamanho e auditoria de acesso.
- [ ] Permitir que cliente abra a Dispute e responda quando solicitado.
- [ ] Permitir que Equipamentos responda, solicite documentos, resolva,
  cancele e reabra.
- [ ] Permitir solicitação de reabertura pelo cliente sem alterar o estado até
  ação de Equipamentos.
- [ ] Criar nova Dispute para nova contestação sem sobrescrever a anterior.
- [ ] Manter o acompanhamento de Demurrage como ambiente operacional principal.
- [ ] Projetar pendência para Equipamentos somente quando a próxima ação for
  interna; quando aguardar cliente, manter o caso aberto sem nova cobrança
  interna.
- [ ] Publicar eventos para o bloco transversal de notificações, sem duplicar
  sua implementação de e-mail/Portal.
- [ ] Adicionar testes de RLS, conversa, anexos, reabertura e alternância de
  responsável.

## Task 6 — Interfaces e projeções visuais

**Arquivos prováveis:** páginas e componentes de clientes, B/L, Demurrage,
alertas e notificações.

- [ ] Exibir painel persistente de pendências na ficha do cliente e nas fichas
  das entidades afetadas.
- [ ] Exibir exclamação vermelha em listas de clientes/B/Ls enquanto existir
  pelo menos uma pendência de origem não resolvida.
- [ ] Exibir origem, departamento responsável, descrição, local de correção e
  ação direta.
- [ ] Implementar filtros da fila do Portal por estado e motivo, sem expor o
  estado removido.
- [ ] Adicionar no acompanhamento de Demurrage a conversa, mensagens, anexos,
  estado do caso e próxima resposta.
- [ ] Adicionar no Portal do cliente a visualização da conversa, envio de
  respostas e anexos, solicitação de reabertura e histórico.
- [ ] Projetar o motivo, histórico e resultado da Dispute na ficha do cliente e
  na ficha da fatura, sem criar cópias editáveis do histórico.
- [ ] Integrar links das projeções com as rotas já definidas, sem criar telas
  duplicadas de correção.
- [ ] Cobrir estados vazios, carregamento, erro, acesso negado e falha de
  upload.
- [ ] Adicionar testes de comportamento para cada uma das três telas do bloco
  e para a conversa de Demurrage.

## Task 7 — Notificações e integração com o bloco transversal

**Arquivos prováveis:** contratos de eventos, serviços de notificações e
componentes do sino/Portal, conforme o bloco transversal.

- [ ] Publicar eventos com destinatário departamental, entidade, ação e link
  de destino. O evento atualiza o item correspondente do alerta agregado e
  nunca cria outra linha para a mesma entidade.
- [ ] Usar os destinos canônicos: pendência geral em
  `/clientes/portal?cliente={id}`; bloqueio ou falha de B/L em
  `/manifestos/{blId}?tab=faturamento`; invoice em
  `/taxas-locais?invoice={invoiceId}`; reconciliação em
  `/manifestos/{blId}?tab=detalhes`; e Dispute diretamente na conversa de
  `/demurrage` ou `/portal/billing` conforme o ambiente.
- [ ] Garantir Documentação como destinatário das pendências de Portal,
  bloqueios financeiros causados pelo Portal e falhas de reprocessamento.
- [ ] Garantir Equipamentos como destinatário das Disputes de Demurrage quando
  a próxima resposta for interna.
- [ ] Preservar leitura individual por usuário e resolução coletiva por
  departamento. A resolução individual de um item remove apenas seu
  departamento da audiência; o alerta fecha somente quando todos os itens forem
  resolvidos.
- [ ] Normalizar o identificador canônico usado nos destinos de invoice e
  disponibilizar os links de cada item, evitando que número textual de invoice
  caia em `/taxas-locais` sem selecionar a fatura.
- [ ] Delegar o envio de e-mail ao cliente e a notificação in-app do Portal ao
  bloco transversal, com contrato versionado.
- [ ] Testar que uma mensagem não cria notificações duplicadas nem altera a
  resolução por simples leitura.

## Task 8 — Verificação, rollout e documentação

- [ ] Executar migrations em ambiente local e validar backfill dos estados
  removidos e dos alertas existentes.
- [ ] Exercitar dados históricos com cliente sem Portal, cliente com vários
  B/Ls, invoice consolidada, disputa aberta e disputa resolvida.
- [ ] Rodar testes focados por task e testes de integração disponíveis.
- [ ] Rodar `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build` e `git diff --check`.
- [ ] Revisar RLS, Storage privado, idempotência dos RPCs e logs sem dados
  sensíveis desnecessários.
- [ ] Atualizar a especificação comportamental canônica quando o código
  implementado estiver verificado.
- [ ] Registrar a entrega no `CHANGELOG.md`.
- [ ] Após todos os critérios passarem, mover esta spec para
  `docs/archive/specs/` e este plano para `docs/archive/plans/`, removendo a
  entrada deste plano do índice.

## Checkpoints de revisão

1. Após Task 1: aprovar modelo canônico e migração antes de tocar nas telas.
2. Após Task 3: validar que nenhum caminho de faturamento contorna o gate.
3. Após Task 5: revisar RLS e experiência da conversa antes de liberar anexos.
4. Antes do rollout: executar a suíte completa e revisar o diff de dados.
