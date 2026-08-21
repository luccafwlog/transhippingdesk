# Bloco 4 — Operação e Viagem: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implementar os contratos funcionais do Bloco 4 para BL, Baplie, CE
Mercante, exportação e a cadeia sequencial ETA/ATA/ETB/ATB/ETD/ATD, preservando
os eventos nulos e sem duplicar os ADRs do #524.

**Architecture:** A fundação transversal #517 fornece catálogo de gravidade,
detecção server-only, estado de dispensa/revisão e fan-out de Notificações.
BL, Baplie e CE usam a viagem como entidade pai; exportação pós-ATD usa o
terminal da frente como entidade pai. Os detectores atualizam um único alerta agregado por
`(entity_type, entity_id)` e não criam uma linha por container ou BL: cada
condição é um item de pendência dentro do agregado. A audiência é a união dos
departamentos dos itens ativos.
Alertas da viagem usam `entity_type = 'voyage'` e `entity_id = voyageId`;
marcos compartilhados usam `voyage_pod_schedule / voyageId::PORTO`; ATB/ATD e
exportação terminalizados usam `voyage_escala_terminal /
voyageId::PORTO::TERMINAL`.
O D−7 pode forçar a avaliação Baplie de rotas ainda sem BL; isso não mistura o
ciclo do alerta de BL faltante com o ciclo da divergência Baplie.
Todos os detectores usam `America/Sao_Paulo` para a aritmética de D−7/D−5 e
para comparar ETA, ETB e ETD com a data local da escala.

**Tech Stack:** React/TypeScript, Supabase PostgreSQL/RPCs, migrations,
TanStack Query, Vitest e testes de contrato SQL.

---

## Pré-condições e fundação

### Task 0: confirmar fundação transversal e migrations

**Files:**

- Read: fundação de alertas na PR #568 (migrations `317`–`321`)
- Read: ADR 0034, ADR 0053 e ADR 0054
- Read: schema atual de viagem, escala, BL, Baplie e alerts
- Read: src/services/baplieReconciliation.ts
- Read: migrations de alertas (`317`–`321`), onboarding (`322`), ADR (`323`), revisão B/L (`324`)

- [x] **Step 1: Confirmar merge da fundação transversal (PR #568 / migrations `317`–`321`).**

A fundação transversal E1–E4 foi entregue pelas migrations `317`–`321` e já
catalogou os tipos do Bloco 4 (`voyage_bl_expected`, `voyage_baplie_missing`,
`voyage_baplie_documentary_coverage`, `voyage_ce_mercante_missing`,
`voyage_schedule_date_pending`, `voyage_terminal_date_pending` e
`voyage_export_after_atd`) com suas gravidades e audiências.

- [ ] **Step 2: Confirmar o ponto server-only dos detectores.**

Não criar cron client-side, não depender de auth.uid de uma tela e conectar os
detectores ao runner server-only periódico (`run_alert_detectors` / Edge Function
`alerts-detector`).

- [ ] **Step 3: Confirmar tabelas e próxima migration sequencial.**

Conferir o próximo prefixo de migration no branch integrado (as migrations `322`,
`323` e `324` foram reservadas/entregues pelas PRs #569, #570 e #571; as novas
migrations deste bloco e sucessores devem usar prefixos a partir de `325`, ex.:
nas PRs #573 e #574).

A projeção por porto é reconstruída de `audit_logs` (`voyage_pod_schedule`,
`voyageId::PORTO`), com `deleted` e `omitted`. A PR #550 acrescentou
`voyage_escala_terminal_state` e `voyage_escala_operation_fronts`; este bloco
deve consumi-las sem criar modelo paralelo. O planejamento de exportação continua em
`voyage_export_schedules`, chaveado por `(voyage_id, pol)` e projetado na mesma
identidade canônica da escala.

Confirmar que `terminal_atd` é a fonte do prazo do ADR terminalizado e que o
ATD unificado permanece somente para ADR legado; qualquer alerta desse fluxo
permanece no #524 e não é duplicado aqui.

## Modelo de dados e configuração

### Task 1: indicar outro 1º porto brasileiro e ETA

**Files:**

- Modify: escrita/auditoria existente de viagem, após inspeção do schema
- Modify: modal de viagem
- Test: comportamento do modal e contrato SQL

- [ ] **Step 1: Persistir a indicação no agregado correto.**

O modal oferece o botão/toggle **“Indicar outro 1º porto brasileiro”**. Ao
ativá-lo, porto e ETA são obrigatórios. O dado é uma âncora de prazo da viagem,
não uma escala operacional, e deve ser auditado em `audit_logs` com
`entity_type = 'voyages'`, `entity_id = voyageId`,
`indicated_first_brazilian_port` e `indicated_first_brazilian_eta`.

- [ ] **Step 2: Validar POD e precedência.**

Ao ativar ou alterar a indicação, bloquear sem POD e bloquear ETA indicado que
não seja anterior ao menor ETA das escalas próprias criadas por Chegadas e
Saídas ou manualmente. Bloquear também a alteração do ETA próprio que o torne
anterior ao indicado. Uma indicação existente sobrevive à remoção do POD, mas
fica sem efeito enquanto não houver POD elegível.

- [ ] **Step 3: Implementar suspensão e retomada.**

Remover POD preserva a indicação e suspende alertas de importação. Recolocar POD
reativa a âncora e recalcula D−7/D−5.

- [ ] **Step 4: Auditar alterações.**

Alterações entram na timeline e só re-notificam se abrirem ou reabrirem
condições. Desativar o botão limpa porto e ETA, com auditoria; não deixar valores
persistidos que a interface não considere na detecção.

### Task 2: explicitar expectativa de exportação na escala

**Files:**

- Modify: `voyage_export_schedules`/RPC existente, após inspeção do schema
- Modify: modal da escala
- Test: comportamento do modal e contrato SQL

- [ ] **Step 1: Reorganizar a expectativa no modal.**

Manter `tem_exportacao` como declaração. Quando estiver ligado, o modal exige
um seletor com: somente granito, somente vazios ou ambos. O seletor reorganiza
`has_granite` e os vínculos de vazios existentes; não criar enum paralelo nem
inferir a expectativa a partir de vínculos que ainda não existem.

Bloquear também o salvamento de uma escala marcada como somente exportação se
ela já tiver POD. A validação é por escala; outras escalas da mesma viagem
podem ser de importação ou mistas.

- [ ] **Step 2: Permitir escala mista sem POD.**

Exportação continua ativa; importação fica suspensa até existir POD. Enquanto
não houver POD, não abrir BL, Baplie ausente, divergência Baplie ou CE.

- [ ] **Step 3: Recalcular após alteração.**

Mudança de tipo recalcula imediatamente a pendência pós-ATD e registra a
alteração.

### Task 2A: implementar a cadeia sequencial de datas da escala

**Files:**

- Modify: gravação/projeção de `voyage_pod_schedule` e detector server-only
- Modify: catálogo compartilhado de tipos, audiência, dedupe e Notificações
- Test: contrato SQL e serviço de alertas da escala

- [ ] **Step 1: Fixar a identidade e a audiência.**

Usar `voyage_pod_schedule / voyageId::PORTO` para ETA/ATA/ETB/ETD e
`voyage_escala_terminal / voyageId::PORTO::TERMINAL` para ATB/ATD. Registrar o item
`voyage_schedule_date_pending` com a dimensão `milestone`; não criar
agregado por data, pessoa ou departamento; cada terminal mantém seu agregado. A audiência do item é a
união de Operações e Documentação, com uma entrega por usuário ativo de cada
departamento e nenhuma entrega para Financeiro.

- [ ] **Step 2: Implementar o predicado de uma única etapa ativa.**

Aplicar esta ordem, sempre materializando somente o primeiro marco ainda
pendente:

```text
ETA atingido + ATA vazia → ATA pendente
ATA preenchida + ETB vazia → ETB pendente
ETB atingido + terminal_atb vazio → ATB pendente naquele terminal
algum terminal atracado + ETD vazio → ETD compartilhado pendente
ETD atingido + terminal_atd vazio → ATD pendente naquele terminal
terminal_atd preenchido → nenhum alerta de data naquele terminal
```

Se uma data já estiver preenchida, a etapa é considerada resolvida e o
detector avança para a seguinte. Datas estimadas ausentes não criam uma etapa
que não possa ser avaliada; a cadeia aguarda o pré-requisito correspondente.

- [ ] **Step 3: Fechar e abrir de forma sequencial.**

Cada preenchimento fecha o item atual e pode abrir somente o próximo item.
ETA/ETB/ETD são comparados pela data local de
`America/Sao_Paulo`, com o dia previsto incluído. Se várias mutações
ocorrerem no mesmo dia, cada mutação produz no máximo um avanço e nenhuma
execução cria itens paralelos ou duplicados.

- [ ] **Step 4: Aplicar ciclo de vida e dispensa globais.**

Os itens são de gravidade `normal`, resolvidos pela origem e nunca por
leitura, reconhecimento ou fechamento manual da fila. A dispensa segue a
fundação #517; quando a revisão vencer com a condição persistente, o mesmo
item reabre e a Notificação Interna é criada novamente para os destinatários
ativos.

- [ ] **Step 5: Reavaliar nos pontos certos.**

As mutações de ETA, ATA, ETB, ETD, `terminal_atb` e `terminal_atd` devem chamar a reconciliação
idempotente. A varredura server-only protegida de 15 minutos é a rede de
segurança; a página `/alertas` apenas lê a fila.

- [ ] **Step 6: Cobrir os casos didáticos.**

Testar ETA atingido sem ATA; ATA preenchida antes do ETA; ETA/ATA/ETB/ATB/ETD
preenchidos no mesmo dia; ETB ou ETD vencidos sem a data real; data real
preenchida antecipadamente; ATD preenchido encerrando o ciclo; escala com
outros itens do Bloco 4; dispensa vencida com nova Notificação; dedupe e
isolamento entre Operações, Documentação e Financeiro.

### Task 3: consumir modelo comum de alertas e dispensa

**Files:**

- Modify: migrations novas a partir de `325` (em PRs como #573/#574)
- Modify: serviços centrais de alertas/notificações
- Test: contrato SQL e testes de fechamento

- [x] **Step 1: Consumir tipos funcionais já catalogados.**

Os tipos de BL por cobertura POL/POD (`voyage_bl_expected`), Baplie ausente
(`voyage_baplie_missing`), cobertura documental Baplie/BL
(`voyage_baplie_documentary_coverage`), CE ausente
(`voyage_ce_mercante_missing`), datas da escala
(`voyage_schedule_date_pending`, `voyage_terminal_date_pending`) e exportação
pós-ATD (`voyage_export_after_atd`) já foram catalogados na migration `317`. As
novas RPCs/triggers devem apenas chamar `upsert_alert_item` e `resolve_alert_item`.

- [ ] **Step 2: Consumir a dispensa da fundação.**

Não criar reconhecimento nem usar a dispensa como resolução. Consumir o
metadado/registro compartilhado (`alert_item_dismissals`) com motivo, usuário,
data/hora, revisão e histórico; a dispensa não fecha item ou alerta, não libera
faturamento e deve ser incluída no predicado de idempotência para impedir nova
abertura/reabertura antes do vencimento.

- [ ] **Step 3: Implementar vencimento da revisão.**

Antes do primeiro ETA, BL/Baplie/CE exigem revisão futura até o primeiro ETA.
Depois que o ETA passou, qualquer data futura é válida. Exportação exige data
futura sem limite máximo específico. Na revisão vencida, reabrir o mesmo ciclo
e notificar se a condição persistir; não criar outro alerta a cada execução.

## Detectores

### Regra comum de dispensa e elegibilidade

Todos os Tasks 4–8 devem aplicar o mesmo predicado: somente abrir ou reabrir
quando a condição estiver vigente, houver POD quando o evento for de
importação, e não houver dispensa manual vigente. No vencimento da revisão, a
próxima execução reabre o mesmo ciclo de alerta e envia a Notificação Interna.

### Task 4: detector preliminar de BL por POL/POD

**Files:**

- Create/modify: detector server-only do #517
- Create/modify: migration/RPC idempotente após validação do schema
- Test: contrato SQL e testes de cobertura POL/POD

- [ ] **Step 1: Calcular expectativa de viagem.**

Usar POLs e PODs vinculados por Chegadas e Saídas ou manualmente. Chegadas e
Saídas fornece a expectativa preliminar antes do Baplie. Cobrir cada origem e
destino individualmente; não exigir todas as combinações. Sem POD, não abrir o
alerta de BL. Respeitar a dispensa vigente e reavaliar a retomada quando o POD
voltar a existir.

- [ ] **Step 2: Abrir alerta crítico no D−7.**

Abrir um alerta por viagem e notificar Documentação. Sem POL, mas com POD,
abrir no D−7 e fechar com o primeiro BL.

- [ ] **Step 3: Reavaliar ações materiais.**

Importação/associação/remoção de BL e inclusão/remoção de POL/POD recalculam
imediatamente. Remoção reabre; remoção da expectativa retira o item.

### Task 5: detector de Baplie ausente

**Files:**

- Modify: detector server-only do #517
- Test: contrato SQL para viagens de importação, mistas e somente exportação

- [ ] **Step 1: Abrir alerta crítico por viagem no D−7.**

Se houver fluxo de importação elegível, isto é, POD não `deleted` nem `omitted`,
exigir Baplie.
Escala mista sem POD não entra até que o POD seja informado. Somente exportação
não entra. Respeitar a dispensa vigente e reabrir apenas no vencimento da
revisão ou quando a condição for criada novamente.

- [ ] **Step 2: Fechar e reabrir por estado de importação.**

Importação válida fecha; invalidação/remoção reabre e notifica. Falha da ação
de importação fica como feedback imediato.

### Task 6: detector de cobertura documental Baplie/BL

**Files:**

- Modify: src/services/baplieReconciliation.ts
- Modify: detector server-only do #517
- Create/modify: migration/RPC idempotente após validação do schema
- Test: testes de reconciliação e cobertura de rota
- Test: BL com rota coberta e zero containers ainda retorna `reconciled` e
  permite divergências `missing_in_manifest`
- Test: contrato SQL do ciclo de alerta

- [ ] **Step 1: Definir correspondência exata.**

Uma rota é coberta quando há pelo menos um BL para o par exato POL → POD. A
existência de containers no BL não é pré-requisito para iniciar a reconciliação;
BL sem containers pode produzir `missing_in_manifest`. O detector não compara
Baplie diretamente com Chegadas e Saídas. O Baplie cobre todas as escalas
próprias relevantes da viagem.

- [ ] **Step 2: Abrir imediatamente com cobertura completa.**

Quando todas as rotas estiverem cobertas e houver divergência de existência,
abrir alerta crítico por viagem, notificar os usuários ativos de Documentação e
apontar para Baplie. No fluxo normal, somente aceitar o resultado
quando `reconcileBaplieWithManifest` retornar `source === 'reconciled'`.
No fluxo normal, se uma rota coberta por BL não tiver containers de BL
disponíveis para confronto, o alerta continua unitário por viagem e o detalhe do
alerta é resumido por rota, com quantidade de containers afetados. Os containers
individuais permanecem consultáveis em `/baplie`.

Quando `ediRoutes.size === 0`, preservar a compatibilidade do helper para
fixtures legados, mas não tratar o retorno `true` como prova silenciosa de
cobertura completa: o detector deve registrar ausência de rotas confrontáveis,
não fechar por esse resultado e não produzir resumo por rota sem rota
identificável. Cobrir esse caso em teste de contrato.

- [ ] **Step 3: Forçar checagem em D−7.**

Se houver Baplie importado e o prazo D−7 tiver sido atingido, forçar a avaliação
mesmo quando o resultado normal seria `awaiting_route_coverage`. No modo forçado,
uma rota sem containers de BL para confronto — sem BL ou com BL sem containers —
gera resumo por rota e quantidade de containers afetados;
o detalhe dos containers fica em `/baplie`. Containers previstos pelo EDI podem gerar
`missing_in_manifest` mesmo sem qualquer BL na rota; containers presentes em BL
podem gerar `missing_in_baplie` quando houver dados para o confronto. Essa é a
exceção à cobertura completa de rotas, não uma mistura com o alerta independente
de BL faltante.

- [ ] **Step 4: Fechar e reabrir o agregado.**

Fechar somente com todas as rotas cobertas e sem divergência. Atualização do item
aberto não notifica novamente; recorrência
após fechamento reabre o mesmo alerta agregado, preservando a história. O modo D−7 deve continuar preservando a
auditoria da aplicação das flags físicas soberanas do Baplie no B/L; flags
físicas não são divergência.

- [ ] **Step 5: Não alertar flags físicas nem granularidade indevida.**

No nível do alerta, não criar itens por container, BL ou flag IMO/OOG. Para uma
rota sem containers de BL para confronto, o alerta permanece por viagem e o
detalhe deve ser um resumo de rota com quantidade, com containers consultáveis
na tela.

### Task 7: detector de CE Mercante

**Files:**

- Modify: detector server-only do #517
- Modify: serviço de associação de CE se necessário
- Test: contrato SQL e reabertura

- [ ] **Step 1: Abrir no D−5 por viagem.**

Considerar exclusivamente `public.bls` da viagem que possuem POD elegível;
`granite_bls` fica fora deste detector e Granito não participa de faturamento,
cliente/Portal ou alerta financeiro. Sem BL, não abrir CE.

- [ ] **Step 2: Fechar/reabrir por estado dos BLs.**

Fechar quando todos os BLs existentes da viagem com POD tiverem CE. BL novo sem
CE, remoção de CE ou nova pendência reabre e notifica, respeitando a dispensa
vigente.

### Task 8: detector pós-ATD de exportação por terminal

**Files:**

- Modify: detector server-only do #517
- Modify: serviço de escala/embarque se necessário
- Test: comportamento por tipo e contrato SQL

- [ ] **Step 1: Abrir no `terminal_atd` da frente.**

Cada terminal com frente de exportação abre alerta normal para os usuários ativos de
Equipamentos se faltar qualquer tipo configurado. Escala somente exportação não
produz BL, Baplie ou CE; granito e vazios podem ser vinculados depois do ATD.

- [ ] **Step 2: Aplicar tipos esperados.**

O seletor explícito exige granito, vazios ou ambos conforme a opção. Tipo não
esperado é ignorado: não fecha nem reabre o alerta.

- [ ] **Step 3: Fechar/reabrir.**

Fechar quando os tipos esperados tiverem vínculo; remoção reabre e notifica.
Destino é a viagem com porto e terminal selecionados.

## Reavaliação, navegação e não duplicação

### Task 9: verificar e preservar importação de vazios all-or-nothing

**Files:**

- Read: `src/services/vaziosImport.ts`
- Read: `src/pages/EmbarqueVazios.tsx`
- Read: RPC/migration da importação transacional
- Test: `src/services/__tests__/vaziosImportAdrColumns.test.ts`
- Test: `src/services/__tests__/vaziosImportsAtomic.test.ts`
- Test: `src/pages/__tests__/EmbarqueVazios.flow.test.tsx`

- [ ] **Step 1: Cobrir o veto de lote inteiro já existente.**

Verificar e testar que qualquer linha com depot/terminal não cadastrado ou
inativo, depot sem entrada/saída, terminal com entrada/saída indevida ou outra
falha em `manifest.rowErrors` aborta o lote inteiro. Nenhum subconjunto pode
ser persistido; o feedback identifica as linhas inválidas na própria tela.
Preservar a guarda existente em `importVaziosManifest` e a RPC transacional,
sem reimplementar o fluxo nem introduzir sucesso parcial.

- [ ] **Step 2: Preservar ausência de alerta persistente.**

O erro é transacional e não cria alerta nem Notificação Interna. Corrigir e
reenviar o arquivo é a ação de resolução.

### Task 10: reavaliar ações materiais

**Files:**

- Modify: serviços de importação/associação de BL
- Modify: serviço de importação/reprocessamento Baplie
- Modify: gravação compartilhada de POD, POL, ETA e tipo de exportação
- Test: fluxos de reavaliação imediata

- [ ] **Step 1: Disparar reavaliação sem depender do render.**

BL, Baplie, POD, POL, ETA, ATA, ETB, ATB, ETD, ATD e tipo de exportação devem
chamar o detector ou invalidar o mecanismo central previsto no #517.

No modelo terminalizado, `ATB`/`ATD` acima significam
`terminal_atb`/`terminal_atd`. Omitir a escala reconcilia e fecha os itens
ativos do porto e de todos os terminais, preservando histórico; a marca `OMIT`
continua visível. Complementar Transbordo, aplicar COD ou reverter essas
decisões não cria produtor interno duplicado: as notificações do cliente são as
Notificações do Portal da PR #553. A carga física segue para o ADR do terminal
de descarga conforme o Bloco 5.

A validação "somente exportação não pode ter POD" deve estar no ponto
compartilhado de gravação de POD, depois de verificar todos os callers, e não
somente no modal.

- [ ] **Step 2: Provar coexistência.**

BL, ausência Baplie, cobertura Baplie/BL e CE têm itens independentes dentro do
mesmo alerta agregado da viagem. Se dois eventos abrirem simultaneamente, a
notificação é calculada pela união dos departamentos dos itens ativos, sem
duplicar o alerta da viagem.

### Task 11: destinos compartilhados

**Files:**

- Modify: roteador compartilhado da ADR 0034
- Modify: telas somente para consumir filtro/seleção
- Test: comportamento de links e filtros

- [ ] **Step 1: Mapear unidades.**

BL e CE usam `entity_type = voyage`, `entity_id = voyageId` e abrem
`/viagens/:voyageId`. Ausência e cobertura Baplie abrem
`/baplie?voyage=<id>`. Exportação usa
`entity_type = voyage_escala_terminal`, `entity_id =
voyageId::PORTO::TERMINAL` e abre
`/viagens/:voyageId?escala=PORTO&terminal=TERMINAL`.

Adicionar `voyage`, `voyage_pod_schedule` e `voyage_escala_terminal` aos rótulos e à derivação de
destino do roteador compartilhado, com testes em `Alertas.behavior.test.tsx` e
`alertsEntityFormat.test.ts`.

`/embarquevazios/depots` e `/vazios-importacao` não recebem produtores de
alerta; seus estados são consulta/cadastro normal.

- [ ] **Step 2: Não criar produtores nas páginas.**

Mensagens de ausência, preview, erro de planilha, depot e
awaiting_route_coverage continuam sendo estado ou feedback, não chamadas de
alerts.

## Verificação

### Task 12: testes e gates

**Files:**

- Test: Baplie, importação, Chegadas e Saídas, vazios e alertas

- [ ] **Step 1: Rodar testes focados.**

    npm test -- --run src/services/__tests__/baplieReconciliation.test.ts src/services/__tests__/baplieRouteCoverage.test.ts src/pages/__tests__/ChegadasSaidas.behavior.test.tsx

- [ ] **Step 2: Rodar gates completos.**

    npm run docs:check
    npm run lint
    npm test
    npm run build

- [ ] **Step 3: Validar contratos SQL.**

Provar abertura idempotente com dispensa vigente e vencida, a cadeia
ETA/ATA/ETB/ATB/ETD/ATD inclusive com várias datas no mesmo dia, D−7,
cobertura POL/POD, BL com rota e zero containers, Baplie normal e forçado
(inclusive rota EDI sem BL), Baplie somente com POD elegível, CE apenas para
BLs com POD, escala somente exportação com POD bloqueada em todos os caminhos,
exportação por escala, falha all-or-nothing de depot/terminal desconhecido,
fechamento automático,
dispensa/revisão e novos ciclos.

## Handoff

### Registro de conflitos entre blocos

- **X3 — ciclo de vida:** resolvido com a fundação do #517 e as decisões dos
  blocos #543/#544/#545: sem reconhecimento; leitura individual; dispensa como
  triagem temporária; resolução derivada da condição de origem.
- **X6 — BL de Granito versus CE Mercante:** resolvido neste bloco usando apenas
  `public.bls`; `granite_bls` fica fora do detector e não cria faturamento,
  vínculo de cliente/Portal ou alerta financeiro.
- **X7 — integração:** ordem recomendada #517 → #544 → #543 → #545 → #546;
  a implementação deve revalidar conflitos de merge antes do desenvolvimento.

Depois do merge desta documentação e da liberação das dependências, abrir PR de
implementação separada com:

    PR type: implementation
    Part of #519
    Closes #523

Não encerrar #523 nesta PR documental. A issue só deve ser encerrada depois da
implementação e verificação completa.
