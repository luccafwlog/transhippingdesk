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

**Bloqueio atual:** a fundação transversal de alertas/notificações ainda não
existe no repositório. Não iniciar as tasks dependentes até o contrato canônico
e sua persistência estarem disponíveis.

## Resultado esperado

- Importação em lote com erro por linha no modal, sem alertas persistentes.
- Um alerta canônico por B/L de `bls` ou `granite_bls` que entra em Revisão Manual.
- Painel contextual no topo da ficha do B/L, com correção direta ou link para
  outro módulo.
- Projeções sem duplicação em listas, containers, carga solta, sino e Alertas.
- Veículo inválido rejeitado antes da persistência, sem pendência própria.

## Task 1 — Confirmar contratos e modelo de alerta

**Arquivos prováveis:** serviços da fundação transversal; tipos gerados;
`src/services/alerts.ts`; `src/pages/Alertas.tsx`.

- [ ] Consumir o contrato canônico de alerta por entidade e tipo.
- [ ] Definir o tipo de alerta de Revisão Manual com chave única por
  `(entity_type, entity_id)`, distinguindo `bl` de `granite_bl`.
- [ ] Definir como a mensagem agrega e remove motivos sem duplicar registros.
- [ ] Definir a projeção de um alerta de viagem/Baplie em B/Ls e containers,
  sem criar alerta filho.
- [ ] Preservar leitura individual, resolução coletiva e auditoria.
- [ ] Bloquear fechamento manual de alertas derivados enquanto a origem ainda
  tiver motivos pendentes; somente a recomputação pode fechá-los.
- [ ] Criar testes de deduplicação, atualização parcial e resolução.

## Task 2 — Importação de B/Ls e carga solta

**Arquivos prováveis:** serviços/parsers de importação, modais das páginas de
manifestos e carga solta, `import_manifest_transactional`, `import_errors` e
testes de importação.

- [ ] Exibir resultado por linha no modal, incluindo falha e motivo.
- [ ] Continuar o processamento das linhas válidas em importação em lote.
- [ ] Registrar falhas por lote/linha usando a tabela existente `import_errors`,
  sem criar nova tabela e sem inserir `alerts`.
- [ ] Aplicar o mesmo comportamento ao importador de carga solta.
- [ ] Criar testes de lote parcial, erro de parsing e erro de validação.

## Task 3 — Gate e fila de Revisão Manual

**Arquivos prováveis:** `src/pages/Revisao.tsx`, `src/hooks/useReview.ts`,
serviços de revisão, RPCs do gate e integração com alertas.

Se a integração exigir alteração de banco, a migration nova deve usar o próximo
prefixo disponível (`304` neste checkout); nunca editar
`188_review_gate_remove_portal.sql`. Migrations são arquivos protegidos: antes
de criá-las ou editá-las, obter autorização explícita e usar o override previsto
em `CLAUDE.md` apenas para essa sessão.

- [ ] Garantir que todo B/L de `bls` ou `granite_bls` na fila de revisão tenha um
  alerta canônico, com motivos vindos da fonte correta de cada origem.
- [ ] Consolidar os motivos de cada origem em um único alerta por origem e B/L;
  para `bls`, usar cliente não vinculado, cliente sem e-mail e peso de carga
  solta, e para `granite_bls`, usar a fila própria do Granito.
- [ ] Atualizar a mensagem quando houver correção parcial.
- [ ] Fechar o alerta e retirar o B/L da fila somente quando todos os motivos
  forem resolvidos; bloquear fechamento manual enquanto houver motivo pendente.
- [ ] Encaminhar notificações de revisão para Documentação.
- [ ] Permitir tratamento na fila sem tornar a fila a única origem da correção.
- [ ] Criar testes de entrada, permanência, correção parcial e saída da fila.

## Task 4 — Ficha do B/L e projeções

**Arquivos prováveis:** `src/pages/BlDetalhe.tsx`, componentes de ficha, listas
de manifestos, containers e carga solta.

- [ ] Adicionar painel contextual persistente no topo da ficha, visível em
  todas as abas.
- [ ] Mostrar descrição, impacto, departamento, ambiente de correção e ação.
- [ ] Permitir vincular/cadastrar cliente diretamente quando essa for a correção
  aplicável.
- [ ] Encaminhar divergência de Baplie ao módulo de viagem/Baplie.
- [ ] Exibir exclamação enquanto existir motivo pendente do B/L.
- [ ] Projetar contexto nas listas sem criar alertas duplicados.
- [ ] Adicionar testes de navegação e visibilidade por aba.

## Task 5 — Containers e Demurrage

**Arquivos prováveis:** página/serviços de containers, regras de Demurrage e
componentes de projeção.

- [ ] Exibir na lista de containers os alertas canônicos relacionados a B/L ou
  viagem e o Indicador Operacional de Demurrage.
- [ ] Não alertar container dentro do free time sem devolução.
- [ ] Consumir o Indicador Operacional próprio de Demurrage quando o container
  exceder free time e permanecer sem devolução, sem criar `alerts` ou
  notificações.
- [ ] Garantir que a projeção não crie alerta duplicado no container.
- [ ] Criar testes para origem e desaparecimento do marcador.

## Task 6 — Importação de veículos

**Arquivos prováveis:** `src/services/vehicleImport.ts`, parser de veículos e
testes.

- [ ] Verificar e preservar a validação já existente em
  `src/services/vehicleImport.ts:250-302`, que cobre B/L, viagem, container,
  tipo, lacre e match ambíguo antes do insert.
- [ ] Rejeitar veículo sem container válido sem reintroduzir fallback silencioso.
- [ ] Mostrar o motivo no resultado da importação.
- [ ] Não criar alerta para veículo que não foi persistido.
- [ ] Manter falhas de faturamento/Portal nos blocos correspondentes.
- [ ] Criar ou completar testes de rejeição antes da persistência e de importação
  válida; não reescrever a validação sem evidência de regressão.

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
- [ ] Registrar a entrega em `docs/CHANGELOG.md`.
- [ ] Após a conclusão, mover spec e plano para os diretórios de arquivo e
  atualizar os índices.

## Checkpoints de revisão

1. Após Task 1: validar contrato de alerta e unidade canônica.
2. Após Task 3: validar que correção parcial não cria duplicatas.
3. Após Task 4: revisar o painel da ficha e os links de correção.
4. Antes do rollout: executar matriz de importação, revisão e projeções.
