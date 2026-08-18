# Bloco 4 — Operação e Viagem: contrato de alertas e notificações

**Status:** decisões funcionais fechadas; implementação pendente e bloqueada por dependências transversais  
**Issue:** [#523](https://github.com/luccafwlog/transhippingdesk/issues/523)  
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)  
**PR desta etapa:** documentação; não encerra a issue #523

## Objetivo e limites

Esta spec fecha o contrato funcional de:

- /viagens
- /viagens/:voyageId
- /baplie
- /chegadas-saidas
- /embarquevazios
- /embarquevazios/depots
- /vazios-importacao

A etapa não implementa produtores, migrations, tabelas, RPCs ou Notificações
Internas. Quando uma decisão exige capacidade inexistente no código atual, ela
aparece explicitamente como NOVA IMPLEMENTAÇÃO e também no plano.

Rótulos, estados visuais, contadores e mensagens de validação não produzem
alertas por si só. Um evento exige condição objetiva, unidade, audiência,
gravidade, fechamento, reabertura, detecção e destino.

## Regras gerais

1. Existe um único alerta agregado por entidade, identificado por
   `(entity_type, entity_id)`. Cada condição ativa é um item de pendência com
   tipo, origem, departamento, destino, estado e histórico próprios. A
   Notificação Interna é entrega individual no sino para a união dos
   departamentos dos itens ativos; a notificação não fecha o agregado.
2. BL, Baplie e CE têm a viagem como entidade pai; o alerta pós-ATD de
   exportação tem a escala como entidade pai. As condições não criam alertas
   por BL ou container: entram como itens do agregado de viagem/escala.
3. Alertas pertencentes aos ADRs, inclusive agency_report_department_pending e
   agency_report_deadline_missed, ficam no #524 e não são duplicados aqui.
4. Não há escalonamento genérico por envelhecimento. D−7, D−5 e o override D−7
   do Baplie são regras de negócio explícitas. A aritmética usa o fuso
   `America/Sao_Paulo`, inclusive quando executada server-side.
5. Não existe ação de reconhecimento: a leitura é individual e nunca resolve a
   pendência. A resolução de cada item deriva da condição de origem; o agregado
   só fecha quando não restar item ativo. A dispensa é uma triagem temporária,
   com motivo, usuário, data/hora e revisão futura: não resolve item, não fecha
   alerta e não libera faturamento. Enquanto vigente, suprime a abertura ou
   reabertura idempotente; no vencimento, a condição persistente retorna ao
   mesmo agregado e gera Notificação Interna.
6. Toda dispensa exige data futura de revisão. Para BL, Baplie e CE, antes do
   primeiro ETA de importação a revisão não pode ultrapassá-lo; depois que esse
   ETA passou, qualquer data futura é válida. Para exportação pós-ATD, basta a
   data ser futura, sem limite máximo específico. A dispensa é metadado/registro
   compartilhado da fundação #517 e não pode mudar o predicado de deduplicação
   de modo que o detector recrie o alerta antes do vencimento.

## Suporte físico das entidades

**Código:** a escala ainda não é uma tabela própria. A parte operacional é
reconstruída de `audit_logs` com `entity_type = 'voyage_pod_schedule'` e
`entity_id = voyageId::PORTO`; `deleted` é soft-delete e `omitted` representa
escala omitida. A identidade canônica usada pela projeção é a de
`buildVoyagePodEntityId`. A ADR 0027 mantém a promoção para uma tabela própria
como evolução futura, fora deste bloco.

**Código:** o planejamento de exportação já vive em
`voyage_export_schedules`, cuja chave operacional é `(voyage_id, pol)`. A
projeção unificada cruza esse registro com `voyage_pod_schedule` pela chave
`voyageId::PORTO`; a implementação não deve criar uma tabela paralela de escala
nem um enum paralelo ao modelo existente.

**Código:** o porto e o ETA indicados pelo botão **“Indicar outro 1º porto
brasileiro”** pertencem à viagem. Devem ser auditados em `audit_logs` com
`entity_type = 'voyages'`, `entity_id = voyageId` e os campos
`indicated_first_brazilian_port` e `indicated_first_brazilian_eta`. Desativar
o botão grava a limpeza desses campos e apaga a indicação; não há indicação
persistida que fique sem efeito nos alertas.

POD `deleted` ou `omitted` não é POD elegível para BL, Baplie ou CE. O detector
deve reaproveitar o universo reconstruído e o predicado de exclusão da
migration 271, sem criar uma regra paralela em TypeScript.

## Identidade e destino no roteador

Os agregados de BL, Baplie e CE usam `entity_type = 'voyage'` e
`entity_id = voyageId` e devem ser rotulados como **Viagem** em `/alertas`.
O agregado pós-ATD usa `entity_type = 'voyage_pod_schedule'` e
`entity_id = voyageId::PORTO` e deve ser rotulado como **Escala**. O roteador
compartilhado precisa reconhecer os dois tipos, produzir links de ação e nunca
exibir o tipo cru ou o destino genérico.

Os destinos canônicos são `/viagens/:voyageId` para BL/CE,
`/baplie?voyage=:voyageId` para Baplie ausente/divergente e
`/viagens/:voyageId?escala=PORTO` para exportação pós-ATD. O parâmetro `escala`
preserva a escala selecionada no detalhe da viagem.

## Prazo e contexto de importação

- D−7: BLs e Baplie disponíveis para qualquer viagem com importação.
- D−5: CE Mercante vinculado aos BLs da viagem que possuem POD.
- Os prazos usam o primeiro ETA brasileiro, em dias corridos, pela data local de
  `America/Sao_Paulo`.
- Por padrão, o primeiro ETA brasileiro é o menor ETA das escalas próprias
  criadas por Chegadas e Saídas ou manualmente. A indicação feita por
  **“Indicar outro 1º porto brasileiro”**, quando anterior, substitui essa
  referência.
- O modal da viagem deve permitir ativar opcionalmente **“Indicar outro 1º
  porto brasileiro”** e informar o porto e o ETA dele. Esse dado não cria uma
  escala operacional.
- Ao ativar ou alterar a indicação, deve existir POD e o ETA indicado deve ser
  anterior ao primeiro ETA próprio. Se uma alteração tornar o ETA próprio
  anterior ao indicado, a alteração é bloqueada.
- Desativar a indicação apaga porto e ETA, com auditoria. Remover POD suspende
  alertas de importação; ao recolocar POD, a indicação existente volta a ser
  considerada e D−7/D−5 são recalculados.
- Sem POD não há alertas de BL, Baplie ou CE.
- Uma escala marcada como somente exportação não pode ter POD. Escala mista sem
  POD pode existir:
  exportação continua ativa e importação fica suspensa até o POD existir.

## Matriz de decisões

A coluna **Unidade/audiência** abaixo descreve a granularidade do item de
pendência e seu departamento responsável. Ela não cria uma segunda chave de
alerta: condições simultâneas da mesma viagem ou escala permanecem no mesmo
agregado, e a audiência do sino é recalculada pela união dos itens ativos.

| Tela/evento | Tratamento | Unidade/audiência | Fechamento/reabertura | Detecção/destino |
|---|---|---|---|---|
| Viagens: ações normais, auditoria e timeline | Nenhum evento próprio | — | — | Fluxo normal |
| BL esperado por POL/POD | Alerta crítico + Notificação para todos os usuários ativos de Documentação | Viagem | Fecha com cobertura mínima de cada POL e POD; reabre com nova expectativa ou remoção de BL | D−7 e alterações materiais; /viagens/:voyageId |
| Baplie ausente | Alerta crítico + Notificação para usuários ativos de Documentação | Viagem | Fecha com importação válida; reabre se o arquivo for invalidado/removido | D−7 e invalidação, somente com POD elegível; /baplie filtrado |
| Cobertura documental Baplie/BL | Item crítico no alerta agregado + Notificação para usuários ativos de Documentação | Viagem | Fecha quando todas as rotas cobertas estiverem sem divergência; a recorrência reabre o mesmo agregado | Imediato quando rotas cobertas; override em D−7; /baplie filtrado |
| CE Mercante ausente | Alerta crítico + Notificação para usuários ativos de Documentação | Viagem | Fecha quando todos os BLs da viagem com POD têm CE; reabre com nova pendência | D−5 e alterações materiais; /viagens/:voyageId |
| `/chegadas-saidas`: ATD, POL/POD e prazos de agência | Nenhum evento novo | ADR do #524 para o prazo; fluxo normal para POL/POD | Mantém contratos existentes; alterações de POL/POD reavaliam o alerta de BL quando elegíveis | ATD da escala unificada alimenta `agency_report_deadline_missed` da migration 271; não duplicar no #523 |
| Exportação pós-ATD | Alerta normal + Notificação para todos os usuários ativos de Equipamentos | Escala | Fecha quando tipos esperados têm vínculo; remoção reabre | ATD e alterações; viagem com escala selecionada |
| `/embarquevazios`: depot/terminal não cadastrado na planilha | Falha da importação + feedback transacional, sem alerta persistente ou Notificação Interna | Arquivo/importação | O arquivo não é importado com sucesso; corrigir e reenviar | Ação na própria tela |
| `/embarquevazios/depots` | Nenhum evento próprio | — | — | Cadastro/consulta normal |
| `/vazios-importacao` | Nenhum evento próprio | — | — | Consulta/fluxo normal |
| Serviços cadastrais sem expiração | Nenhum evento próprio | — | — | Não há data de expiração a monitorar |
| Estados sem dados, `awaiting_route_coverage` e ausência normal | Nenhum evento próprio | — | — | Estado/consulta normal |

## Alerta preliminar de BL

POLs e PODs vinculados por Chegadas e Saídas ou manualmente criam a
expectativa documental da viagem.

O alerta fecha quando houver cobertura marginal:

- pelo menos um BL com cada POL esperado;
- pelo menos um BL com cada POD esperado.

Não exigir todas as combinações POL × POD. Um BL pode cobrir uma origem e um
destino. Se houver POD, mas nenhum POL, o alerta abre no D−7 e fecha com o
primeiro BL, pois não há métrica melhor. Um BL com POL/POD correto satisfaz a
fase preliminar mesmo sem containers; a cobertura precisa do Baplie é
independente. A importação do Baplie não fecha nem oculta este alerta de BL,
que continua sendo uma obrigação da viagem inteira.

## Cobertura documental Baplie/BL

O Baplie só existe para importação, cobre todas as escalas próprias relevantes
da viagem e a importação já exclui portos sem nossa agência. Chegadas e Saídas
é a fonte preliminar anterior ao Baplie para expectativa de BL; não comparar
diretamente essas duas fontes. Não limitar o Baplie à escala atualmente
selecionada na interface.

Uma rota Baplie é coberta quando existe pelo menos um BL para o par exato
POL → POD. A existência de containers no BL não é pré-requisito para iniciar a
reconciliação; um BL sem containers pode produzir divergências
`missing_in_manifest`.

Regra normal:

- quando todas as rotas estiverem cobertas, avaliar existência e cobertura
  de containers;
- divergência comprovada abre imediatamente, mesmo antes de D−7;
- flags físicas não entram no alerta.
- quando `ediRoutes.size === 0`, a compatibilidade legada do helper pode
  retornar `true`, mas isso não comprova cobertura de rota: o detector deve
  registrar ausência de rotas confrontáveis, não fechar o agregado por esse
  resultado e não gerar resumo de divergência por rota sem rota identificável;
  essa condição precisa de teste de contrato próprio.

Para a regra normal, a divergência só pode ser produzida quando
`reconcileBaplieWithManifest` retornar `source === 'reconciled'`.

Override D−7:

- se houver Baplie importado, forçar a checagem mesmo quando a reconciliação
  normal retornaria `awaiting_route_coverage`;
- no modo forçado, uma rota sem containers de BL para confronto — porque não
  há BL ou porque os BLs da rota não têm containers — gera um resumo de
  divergência por rota, com quantidade de containers afetados; o detalhe dos
  containers fica consultável em `/baplie`;
- containers previstos pelo EDI podem gerar divergência `missing_in_manifest`
  mesmo quando a rota ainda não tem nenhum BL;
- containers de BL que não existem no EDI continuam gerando
  `missing_in_baplie` quando houver dados para confrontá-los;
- o alerta de Baplie continua independente do alerta de BL faltante;
- o alerta só fecha quando todas as rotas estiverem cobertas e não houver
  divergência;
- atualização do alerta aberto não envia nova notificação;
- nova divergência depois do fechamento reabre o mesmo agregado, adicionando o
  item atual e preservando a história dos ciclos anteriores.

O alerta é único por viagem e a Notificação Interna é direcionada aos usuários
ativos de Documentação; o detalhe fica em `/baplie`. No nível do alerta e da
Notificação Interna, não criar itens por BL ou container. Quando uma rota não
tiver containers de BL disponíveis para confronto — porque não há BL ou porque
os BLs da rota não têm containers — o alerta permanece unitário por viagem e
seu detalhe de alerta é resumido por rota, com a quantidade afetada. Na camada
de reconciliação consultada em `/baplie`, os itens de container continuam
disponíveis e podem ser expandidos sem alterar a unidade do alerta.

A importação do Baplie é soberana para flags físicas: ela sobrescreve os
valores físicos do B/L e registra a alteração em auditoria. Essa atualização
não produz divergência nem alerta.

## CE Mercante

O detector D−5 considera exclusivamente registros de `public.bls` da viagem
que possuem POD elegível. A decisão operacional vigente é que os BLs desse
fluxo são de importação; não há um predicado separado de direção a construir.
`granite_bls` fica fora deste detector e segue seus fluxos operacionais
próprios; Granito não cria faturamento, vínculo de cliente/Portal ou alerta
financeiro.

- abre no D−5 se houver BL da viagem com POD sem CE;
- sem BL, não abrir alerta de CE;
- qualquer CE vinculado ao BL é suficiente;
- BL novo sem CE, remoção de CE ou nova pendência reabre;
- remover um BL retira-o da lista e fecha o alerta se não restar outro;
- destino: /viagens/:voyageId.

## Exportação pós-ATD

O modal da escala mantém `tem_exportacao` como declaração de que haverá
exportação. Quando esse toggle estiver ligado, deve exigir um seletor de
expectativa — não um enum paralelo ao modelo persistido — com as opções:

- somente granito;
- somente vazios;
- ambos.

Uma escala somente exportação não gera alertas de BL, Baplie ou CE. Granito e
vazios podem ser vinculados após a saída/ATD da escala. Uma escala mista
participa dos fluxos de importação e exportação; sem POD, somente o fluxo de
exportação fica ativo. O alerta abre após ATD confirmado e é por escala:

- somente granito exige granito;
- somente vazios exige vazio;
- ambos exigem os dois;
- tipo não esperado é ignorado: não fecha nem reabre o alerta;
- remoção de vínculo reabre e notifica;
- alteração do tipo recalcula imediatamente;
- destino: viagem com a escala selecionada.

## Nova implementação necessária

As seguintes capacidades não existem integralmente e devem ser tratadas na PR
de implementação:

1. Campos auditados e validações de **“Indicar outro 1º porto brasileiro”**,
   incluindo a precedência sobre o menor ETA próprio e a limpeza ao desativar.
2. Seletor explícito de expectativa de exportação no modal da escala,
   reorganizando `has_granite` e os vínculos de vazios sem criar enum paralelo.
3. Regra de POD e suspensão/reativação do fluxo de importação.
4. Estado de dispensa manual com motivo, autoria, revisão e exceções.
5. Detector server-side de BL por cobertura POL/POD.
6. Detector server-side de Baplie ausente somente para fluxo de importação
   elegível, com POD.
7. Reconciliação Baplie/BL com regra normal e override D−7, incluindo
   divergência de containers em rotas sem BL.
8. Detector D−5 de CE para `public.bls` da viagem com POD; `granite_bls` fica
   fora deste detector e não há BLs de exportação neste contrato.
9. Detector pós-ATD de exportação por escala.
10. Reavaliação imediata após BL, Baplie, POD, POL, ETA ou tipo de exportação.
11. Roteamento compartilhado para viagem/Baplie e seleção de escala.
12. Verificação e cobertura de regressão da importação de vazios já
    all-or-nothing para depot/terminal inválido; preservar serviço, página,
    feedback transacional e ausência de sucesso parcial.

Nenhuma coluna, enum ou migration é pré-inventada aqui. A implementação deve
validar as tabelas e RPCs atuais antes de escolher a próxima migration
sequencial.

## Bloqueios

### BLOCKED — fundação transversal #517

A fundação E1/E2/E3 precisa estar mergeada para gravidade, detectores
server-only, estado de dispensa e fan-out de notificações.

### BLOCKED — schema de configuração e ciclo de vida

O schema atual não contém necessariamente a indicação de outro 1º porto
brasileiro, a expectativa explícita de exportação,
gravidade, audiência, estado de dispensa e revisão. A migration própria só pode
ser criada depois da validação do contrato central e das tabelas atuais.

### BLOCKED — detectores server-side

A reconciliação Baplie hoje é consumida por TypeScript/telas e a importação
transacional não persiste os eventos descritos. O detector deve ser idempotente,
usar tabelas existentes, oferecer o modo forçado de D−7, respeitar a dispensa
vigente e não criar tabela por container ou BL.

## Registro de conflitos entre blocos

- **X3 — ciclo de vida:** resolvido com a fundação do #517 e as decisões dos
  blocos #543/#544/#545. Não há reconhecimento; leitura é individual; a
  dispensa é triagem temporária e a resolução é derivada da condição de origem.
- **X6 — BL de Granito versus CE Mercante:** resolvido para este detector. O
  CE consulta apenas `public.bls`; `granite_bls` fica fora e Granito não cria
  faturamento, vínculo de cliente/Portal ou alerta financeiro.
- **X7 — ordem de integração:** pendência operacional entre PRs. A sequência
  recomendada é #517 → #544 → #543 → #545 → #546; esta PR altera somente sua
  documentação e não reescreve os README dos demais blocos.

## Validação futura

Executar após implementação:

    npm run docs:check
    npm run lint
    npm test
    npm run build

A PR de implementação posterior deverá conter:

    PR type: implementation
    Part of #519
    Closes #523
