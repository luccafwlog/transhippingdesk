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

**Bloqueio parcial atual:** a persistência da Notificação Interna da arquitetura
transversal ainda não existe no repositório. Ela bloqueia somente as partes das
Tasks 1, 3 e 7 que dependem do sino e do fan-out. As Tasks 2 (resultado de
importação) e 6 (validação de veículos), que não dependem de Notificação
Interna, podem avançar com os contratos já existentes.

## Resultado esperado

- Importação em lote com erro por linha no modal, sem alertas persistentes.
- Um alerta agregado canônico por B/L de `bls` ou `granite_bls`, com itens de
  pendência para cada motivo ativo da Revisão Manual.
- Painel contextual no topo da ficha do B/L, com correção direta ou link para
  outro módulo.
- Projeções sem duplicação em listas, containers, carga solta, sino e Alertas.
- Veículo inválido rejeitado antes da persistência, sem pendência própria.

## Task 1 — Confirmar contratos e modelo de alerta

**Arquivos prováveis:** serviços da fundação transversal; tipos gerados;
`src/services/alerts.ts`; `src/pages/Alertas.tsx`.

- [x] Consumir o contrato canônico de alerta agregado por entidade.
- [x] Definir a chave única do agregado como `(entity_type, entity_id)`; `type`
  identifica o item de pendência e a origem `bl`/`granite_bl` compõe a identidade
  canônica do B/L quando necessário, sem separar alertas da mesma entidade.
- [x] Integrar as PRs #550/#553: manter terminal fora da chave do B/L, mas
  preservar terminal/`report_id` em links para ADR/frente; não criar motivo de
  revisão ou produtor paralelo para Omissão, Transbordo, COD ou Ajuste de COD.
- [x] Definir como a mensagem agrega e remove motivos sem duplicar registros.
- [x] Definir a projeção de um alerta de viagem/Baplie em B/Ls e containers,
  sem criar alerta filho.
- [x] Preservar leitura individual, triagem coletiva temporária e auditoria; não
  implementar `reconhecer` como estado ou ação.
- [x] Modelar dispensa como metadado/registro temporário do Alerta aberto, com
  motivo, autor, data/hora e data futura de revisão; nunca como fechamento ou
  dispensa indefinida.
- [x] Bloquear fechamento manual de alertas derivados enquanto a origem ainda
  tiver motivos pendentes; somente a recomputação pode fechá-los. Implementar
  a guarda no contrato server-side (RPC, trigger ou policy/RLS apropriada),
  acompanhada de teste de contrato SQL, para que um UPDATE direto não contorne
  a proteção da UI.
- [x] Definir o rótulo e o destino compartilhados para `bl` e `granite_bl`;
  incluir paginação/filtro para que a lista de 200 alertas não esconda
  pendências de revisão.
- [x] Criar testes de deduplicação, atualização parcial e resolução.

## Task 2 — Importação de B/Ls e carga solta

**Arquivos prováveis:** serviços/parsers de importação, modais das páginas de
manifestos e carga solta, `import_manifest_transactional`, `import_errors`,
`ensure_customer_contact_email` (migration 322) e testes de importação.

- [x] Exibir resultado por linha no modal, incluindo falha e motivo.
- [x] Continuar o processamento das linhas válidas em importação em lote.
- [x] Registrar falhas por lote/linha usando a tabela existente `import_errors`,
  sem criar nova tabela e sem inserir `alerts`.
- [x] Consumir a inclusão idempotente de e-mails via `ensure_customer_contact_email`
  já introduzida na migration 322 para clientes reconhecidos por documento.
- [x] Aplicar o mesmo comportamento ao importador de carga solta.
- [x] Criar testes de lote parcial, erro de parsing e erro de validação.

## Task 3 — Gate e fila de Revisão Manual

**Arquivos prováveis:** `src/pages/Revisao.tsx`, `src/hooks/useReview.ts`,
`src/components/review/ReviewGroupBlock.tsx`,
`src/components/review/ReviewCustomerOnboarding.tsx`,
`src/hooks/useReviewCustomerGroup.ts`, `src/services/reviewCustomerGroup.ts`,
serviços de revisão, RPCs do gate e integração com alertas.

Se a integração exigir alteração de banco, a migration nova deve usar o próximo
prefixo disponível (`324` neste checkout); nunca editar
`188_review_gate_remove_portal.sql` ou `322_review_customer_group_onboarding.sql`.
Migrations são arquivos protegidos: antes de criá-las ou editá-las, obter
autorização explícita e usar o override previsto em `CLAUDE.md` apenas para essa
sessão. A ADR 0054 estabelece o Portal como gate de faturamento; a implementação
deve fazê-lo em migration nova sem reter o operador na fila de revisão documental
enquanto o cliente externo não ativar a conta.

- [x] Integrar a fila ao modelo de Grupo de Cliente (PR #569), operando
  onboarding e vínculos em lote via `complete_review_customer_group` e exibindo
  B/Ls individuais como exceções operacionais ou conflitos documentais.
- [x] Garantir que todo B/L de `bls` ou `granite_bls` na fila de revisão tenha um
  alerta canônico, com motivos vindos da fonte correta de cada origem; em
  `bls`, incluir cliente não vinculado, cliente sem e-mail e peso BB.
- [x] Consolidar os motivos de cada origem em itens do único alerta agregado do
  B/L; para `bls`, usar cliente não vinculado, cliente sem e-mail e peso de carga
  solta, e para `granite_bls`, usar a condição vigente `client_id IS NULL`.
- [x] Conforme a ADR 0054, a prontidão do Portal é gate server-side para
  avanço e emissão do faturamento; ela compõe alertas financeiros quando
  aplicável sem bloquear a conclusão do onboarding de cliente na fila de revisão
  documental.
- [x] Substituir a extração de motivos de notas em `src/hooks/useReview.ts`
  por uma fonte canônica server-side (RPC/view sobre
  `compute_bl_review_pendencies`) e tornar a abertura imediata nas mutações
  autoritativas, com cron idempotente a cada 15 minutos como segurança.
- [x] Preservar a remoção do predicado morto `needsCeMercante` em
  `src/pages/revisaoHelpers.ts` (já executada); o bloqueio por CE Mercante vive
  em `src/components/billing/validacaoPipeline.ts:120`, outra fila.
- [x] Atualizar a mensagem quando houver correção parcial.
- [x] Fechar o alerta e retirar o B/L da fila somente quando todos os motivos
  documentais forem resolvidos; nenhum reconhecimento; a dispensa é temporária,
  exige motivo/data futura e não encerra nem libera o gate.
- [x] Encaminhar notificações de revisão para Documentação.
- [x] Permitir tratamento na fila sem tornar a fila a única origem da correção.
- [x] Criar testes de entrada, permanência, correção parcial e saída da fila.

## Task 4 — Ficha do B/L e projeções

**Arquivos prováveis:** `src/pages/BlDetalhe.tsx`, `src/components/review/ReviewDrawer.tsx`,
componentes de ficha, listas de manifestos, containers e carga solta.

- [x] Adicionar painel contextual persistente no topo da ficha, visível em
  todas as abas.
- [x] Mostrar descrição, impacto, departamento, ambiente de correção e ação.
- [x] Permitir vincular/cadastrar cliente diretamente na ficha do B/L quando
  essa for a correção aplicável, preservando a regra de CNPJ válido e e-mail.
- [x] Manter o `ReviewDrawer` focado em correções de campos operacionais do B/L
  (`shipper`, `consignee`, `pol`, `pod`, `peso BB`, `notas`), com cliente em
  modo leitura conforme PR #569.
- [x] Encaminhar divergência de Baplie ao módulo de viagem/Baplie.
- [x] Exibir exclamação enquanto existir motivo pendente do B/L.
- [x] Projetar contexto nas listas sem criar alertas duplicados; a resolução de
  um item atualiza a lista corrente do agregado e preserva seu histórico.
- [x] Definir rótulo/destino de `granite_bl` e não deixar a revisão ocupar
  silenciosamente o teto de 200 linhas de `listAlerts`; paginar ou filtrar a
  fila.
- [x] Adicionar testes de navegação e visibilidade por aba.

## Task 5 — Containers e Demurrage

**Arquivos prováveis:** página/serviços de containers, regras de Demurrage e
componentes de projeção.

- [x] Exibir na lista de containers os alertas canônicos relacionados a B/L ou
  viagem e o Indicador Operacional de Demurrage.
- [x] Não alertar container dentro do free time sem devolução.
- [x] Consumir o Indicador Operacional próprio de Demurrage quando o container
  exceder free time e permanecer sem devolução, sem criar `alerts` ou
  notificações.
- [x] Garantir que a projeção não crie alerta duplicado no container.
- [x] Criar testes para origem e desaparecimento do marcador.

## Task 6 — Importação de veículos

**Arquivos prováveis:** `src/services/vehicleImport.ts`, parser de veículos e
testes.

- [x] Verificar e preservar a validação já existente em
  `src/services/vehicleImport.ts:246-302`, que cobre B/L, viagem, container,
  tipo, lacre e match ambíguo antes do insert.
- [x] Rejeitar veículo sem container válido sem reintroduzir fallback silencioso.
- [x] Mostrar o motivo no resultado da importação.
- [x] Não criar alerta para veículo que não foi persistido.
- [x] Manter falhas de faturamento/Portal nos blocos correspondentes.
- [x] Criar ou completar testes de rejeição antes da persistência e de importação
  válida; não reescrever a validação sem evidência de regressão.

## Task 7 — Integração transversal

- [x] Publicar eventos de revisão para o contrato de notificações, com
  departamento Documentação e link de correção.
- [x] Publicar projeções de Baplie sem assumir a implementação do #523.
- [x] Integrar com o hook `useReviewCustomerGroup` e a RPC
  `complete_review_customer_group` (PR #569) para o onboarding em lote.
- [x] Garantir que a ficha do cliente do #521 possa resumir B/Ls deste bloco.
- [x] Garantir que o faturamento do #522 possa consumir o estado de revisão.
- [x] Garantir que a emissão/faturamento respeite a prontidão do Portal como
  gate server-side, conforme ADR 0054, sem editar a migration 188.
- [x] Testar resolução da origem refletida em todas as projeções.

## Task 8 — Verificação e rollout

- [x] Exercitar importação parcial com linhas válidas e inválidas.
- [x] Exercitar B/L com múltiplos motivos e correção em etapas.
- [x] Exercitar Baplie como alerta de viagem com projeções em B/L/container.
- [x] Exercitar veículo inválido e confirmar ausência de entidade/alerta.
- [x] Exercitar a dispensa com data futura: o alerta sai da fila prioritária,
  retorna se a origem persistir e fecha automaticamente se a origem resolver.
- [ ] Rodar testes focados, `npm run docs:check`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build` e `git diff --check`.
- [ ] Atualizar a spec comportamental canônica após verificação do código.
- [ ] Registrar a entrega em `docs/CHANGELOG.md`.
- [ ] Após a conclusão, mover spec e plano para os diretórios de arquivo e
  atualizar os índices.

## Nota factual para o bloco de viagens

O D−5 de CE Mercante deve considerar exclusivamente `public.bls` com POD,
incluindo `cargo_mode = 'container'` e `cargo_mode = 'carga_solta'`; carga solta
é B/L comum com campos BB próprios, não um container. `granite_bls` não entra
nesse detector. O helper atual de faturamento
`src/services/reviewBillingAutomation.ts:15-70` bloqueia explicitamente CE
ausente apenas para `cargo_mode = 'container'`; a regra documental de CE para
todos os modos da ADR 0042 exige correção/teste no bloco de implementação, não
uma afirmação de que o código já está correto.
POD omitido não é elegível. COD conserva o CE Mercante e não deve produzir uma
segunda pendência de CE nem trocar o terminal físico da descarga.

## Checkpoints de revisão

1. Após Task 1: validar contrato de alerta e unidade canônica.
2. Após Task 3: validar que correção parcial não cria duplicatas.
3. Após Task 4: revisar o painel da ficha e os links de correção.
4. Antes do rollout: executar matriz de importação, revisão e projeções.
