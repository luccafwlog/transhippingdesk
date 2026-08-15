# Implementação do Bloco #520 — B/L e Revisão Manual

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:executing-plans`
> (ou `superpowers:subagent-driven-development`) para executar tarefa a tarefa.
> Passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** implementar as pendências aprovadas para importação de B/Ls,
Revisão Manual, ficha do B/L, carga solta, containers e veículos.

**Especificação:**
[`2026-08-15-bloco-520-bl-revisao-design.md`](../spec/2026-08-15-bloco-520-bl-revisao-design.md)

**Issue:** [#520](https://github.com/luccafwlog/transhippingdesk/issues/520)

**Dependências:** fundação transversal de alertas/notificações; fluxo de
Clientes/Portal do #521; alerta de viagem/Baplie do #523; regras financeiras de
Demurrage do #522.

## Resultado esperado

- Importação em lote com erro por linha no modal, sem alertas persistentes.
- Um alerta canônico por B/L que entra em Revisão Manual.
- Painel contextual no topo da ficha do B/L, com correção direta ou link para
  outro módulo.
- Projeções sem duplicação em listas, containers, carga solta, sino e Alertas.
- Veículo inválido rejeitado antes da persistência, sem pendência própria.

## Task 1 — Confirmar contratos e modelo de alerta

**Arquivos prováveis:** migrations e serviços da fundação transversal; tipos
gerados; `src/services/alerts.ts`.

- [ ] Consumir o contrato canônico de alerta por entidade e tipo.
- [ ] Definir o tipo de alerta de Revisão Manual com chave única por B/L.
- [ ] Definir como a mensagem agrega e remove motivos sem duplicar registros.
- [ ] Definir a projeção de um alerta de viagem/Baplie em B/Ls e containers,
  sem criar alerta filho.
- [ ] Preservar leitura individual, resolução coletiva e auditoria.
- [ ] Criar testes de deduplicação, atualização parcial e resolução.

## Task 2 — Importação de B/Ls e carga solta

**Arquivos prováveis:** serviços/parsers de importação, modais das páginas de
manifestos e carga solta, testes de importação.

- [ ] Exibir resultado por linha no modal, incluindo falha e motivo.
- [ ] Continuar o processamento das linhas válidas em importação em lote.
- [ ] Registrar falhas no histórico técnico sem inserir `alerts`.
- [ ] Aplicar o mesmo comportamento ao importador de carga solta.
- [ ] Criar testes de lote parcial, erro de parsing e erro de validação.

## Task 3 — Gate e fila de Revisão Manual

**Arquivos prováveis:** `src/pages/Revisao.tsx`, serviços de revisão, RPCs e
migrations do gate `compute_bl_review_pendencies`.

- [ ] Garantir que todo B/L em `pending_review` tenha um alerta canônico.
- [ ] Consolidar os motivos cliente não vinculado, cliente sem e-mail e peso
  de carga solta em um único alerta por B/L.
- [ ] Atualizar a mensagem quando houver correção parcial.
- [ ] Resolver o alerta e retirar o B/L da fila somente quando todos os motivos
  forem resolvidos.
- [ ] Encaminhar notificações de revisão para Documentação.
- [ ] Permitir tratamento na fila sem tornar a fila a única origem da correção.
- [ ] Criar testes de entrada, permanência, correção parcial e saída da fila.

## Task 4 — Ficha do B/L e projeções

**Arquivos prováveis:** `src/pages/ManifestoDetalhe.tsx`, componentes de ficha,
listas de manifestos, containers e carga solta.

- [ ] Adicionar painel contextual persistente no topo da ficha, visível em
  todas as abas.
- [ ] Mostrar descrição, impacto, departamento, ambiente de correção e ação.
- [ ] Permitir vincular/cadastrar cliente diretamente quando essa for a correção
  aplicável.
- [ ] Encaminhar divergência de Baplie ao módulo de viagem/Baplie.
- [ ] Exibir exclamação enquanto existir motivo pendente do B/L.
- [ ] Projeter contexto nas listas sem criar alertas duplicados.
- [ ] Adicionar testes de navegação e visibilidade por aba.

## Task 5 — Containers e Demurrage

**Arquivos prováveis:** página/serviços de containers, regras de Demurrage e
componentes de projeção.

- [ ] Exibir na lista de containers os alertas canônicos relacionados a B/L,
  viagem ou Demurrage.
- [ ] Não alertar container dentro do free time sem devolução.
- [ ] Consumir alerta próprio de Demurrage quando o container exceder free time
  e permanecer sem devolução.
- [ ] Garantir que a projeção não crie alerta duplicado no container.
- [ ] Criar testes para origem e desaparecimento do marcador.

## Task 6 — Importação de veículos

**Arquivos prováveis:** `src/services/vehicleImport.ts`, parser de veículos,
RPC/migration de persistência e testes.

- [ ] Validar chassi, B/L, viagem, container, tipo e lacre antes do insert.
- [ ] Rejeitar veículo sem container válido.
- [ ] Mostrar o motivo no resultado da importação.
- [ ] Não criar alerta para veículo que não foi persistido.
- [ ] Manter falhas de faturamento/Portal nos blocos correspondentes.
- [ ] Criar testes de rejeição antes da persistência e de importação válida.

## Task 7 — Integração transversal

- [ ] Publicar eventos de revisão para o contrato de notificações, com
  departamento Documentação e link de correção.
- [ ] Publicar projeções de Baplie sem assumir a implementação do #523.
- [ ] Garantir que a ficha do cliente do #521 possa resumir B/Ls deste bloco.
- [ ] Garantir que o faturamento do #522 possa consumir o estado de revisão.
- [ ] Testar resolução da origem refletida em todas as projeções.

## Task 8 — Verificação e rollout

- [ ] Exercitar importação parcial com linhas válidas e inválidas.
- [ ] Exercitar B/L com múltiplos motivos e correção em etapas.
- [ ] Exercitar Baplie como alerta de viagem com projeções em B/L/container.
- [ ] Exercitar veículo inválido e confirmar ausência de entidade/alerta.
- [ ] Rodar testes focados, `npm run docs:check`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build` e `git diff --check`.
- [ ] Atualizar a spec comportamental canônica após verificação do código.
- [ ] Registrar a entrega no `CHANGELOG.md`.
- [ ] Após a conclusão, mover spec e plano para os diretórios de arquivo e
  atualizar os índices.

## Checkpoints de revisão

1. Após Task 1: validar contrato de alerta e unidade canônica.
2. Após Task 3: validar que correção parcial não cria duplicatas.
3. Após Task 4: revisar o painel da ficha e os links de correção.
4. Antes do rollout: executar matriz de importação, revisão e projeções.
