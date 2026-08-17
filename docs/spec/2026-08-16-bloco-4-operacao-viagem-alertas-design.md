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

1. Alerta é pendência coletiva; Notificação Interna é entrega individual no
   sino. A notificação não fecha o alerta. A audiência deste bloco é
   departamental: usuários ativos de Documentação ou Equipamentos.
2. BL, Baplie e CE usam a unidade viagem. O alerta pós-ATD de exportação usa a
   unidade escala. Não criar eventos por BL ou container.
3. Alertas pertencentes aos ADRs, inclusive agency_report_department_pending e
   agency_report_deadline_missed, ficam no #524 e não são duplicados aqui.
4. Não há escalonamento genérico por envelhecimento. D−7, D−5 e o override D−7
   do Baplie são regras de negócio explícitas.
5. Fechamento manual significa dispensa, não resolução. Deve ter motivo,
   usuário, data/hora, data de revisão e estado distinto; fica visível em
   exceções.

## Prazo e contexto de importação

- D−7: BLs e Baplie disponíveis para qualquer viagem com importação.
- D−5: CE Mercante vinculado aos BLs de importação existentes.
- Os prazos usam o primeiro ETA brasileiro, em dias corridos, pela data local.
- Por padrão, o primeiro ETA brasileiro é o menor ETA das escalas próprias
  criadas por Chegadas e Saídas ou manualmente. O ETA externo, quando
  informado, substitui essa referência por ser anterior.
- O modal da viagem deve permitir informar opcionalmente o primeiro porto
  brasileiro que não é atendido pela empresa e o ETA dele. Esse dado não cria
  uma escala operacional.
- O ETA externo só pode ser salvo com POD e se for anterior ao primeiro ETA
  próprio. Se uma alteração tornar o ETA próprio anterior ao externo, a
  alteração é bloqueada.
- Remover POD preserva o ETA externo, suspende alertas de importação e não
  apaga o dado. Recolocar POD reativa o ETA e recalcula D−7/D−5.
- Sem POD não há alertas de BL, Baplie ou CE.
- Uma escala marcada como somente exportação não pode ter POD. Escala mista sem
  POD pode existir:
  exportação continua ativa e importação fica suspensa até o POD existir.

## Matriz de decisões

| Tela/evento | Tratamento | Unidade/audiência | Fechamento/reabertura | Detecção/destino |
|---|---|---|---|---|
| Viagens: ações normais, auditoria e timeline | Nenhum evento próprio | — | — | Fluxo normal |
| BL esperado por POL/POD | Alerta crítico + Notificação para todos os usuários ativos de Documentação | Viagem | Fecha com cobertura mínima de cada POL e POD; reabre com nova expectativa ou remoção de BL | D−7 e alterações materiais; /viagens/:voyageId |
| Baplie ausente | Alerta crítico + Notificação para usuários ativos de Documentação | Viagem | Fecha com importação válida; reabre se o arquivo for invalidado/removido | D−7 e invalidação, somente com POD elegível; /baplie filtrado |
| Cobertura documental Baplie/BL | Alerta crítico + Notificação genérica para usuários ativos de Documentação | Viagem | Fecha com todas as rotas confrontáveis e sem divergência; novo ciclo após recorrência | Imediato quando rotas cobertas; override em D−7; /baplie filtrado |
| CE Mercante ausente | Alerta crítico + Notificação para usuários ativos de Documentação | Viagem | Fecha quando todos os BLs de importação existentes têm CE; reabre com nova pendência | D−5 e alterações materiais; /viagens/:voyageId |
| ATD e prazos de agência | Nenhum evento novo | ADR do #524 | Mantém contrato do ADR | ATD da escala unificada alimenta `agency_report_deadline_missed` da migration 271; não duplicar no #523 |
| Exportação pós-ATD | Alerta normal + Notificação para todos os usuários ativos de Equipamentos | Escala | Fecha quando tipos esperados têm vínculo; remoção reabre | ATD e alterações; viagem com escala selecionada |
| `/embarquevazios`: depot/terminal não cadastrado na planilha | Falha da importação + feedback transacional, sem alerta persistente ou Notificação Interna | Arquivo/importação | O arquivo não é importado com sucesso; corrigir e reenviar | Ação na própria tela |
| `/embarquevazios/depots` | Nenhum evento próprio | — | — | Cadastro/consulta normal |
| `/vazios-importacao` | Nenhum evento próprio | — | — | Consulta/fluxo normal |
| Serviços cadastrais sem expiração | Nenhum evento próprio | — | — | Não há data de expiração a monitorar |
| Estados vazios, awaiting_route_coverage e ausência normal | Nenhum evento próprio | — | — | Estado/consulta normal |

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

Uma rota Baplie é confrontável quando existe BL com containers vinculados para
o par exato POL → POD.

Regra normal:

- quando todas as rotas estiverem confrontáveis, avaliar existência e cobertura
  de containers;
- divergência comprovada abre imediatamente, mesmo antes de D−7;
- flags físicas não entram no alerta.

Para a regra normal, a divergência só pode ser produzida quando
`reconcileBaplieWithManifest` retornar `source === 'reconciled'`.

Override D−7:

- se houver Baplie importado, forçar a checagem mesmo quando a reconciliação
  normal retornaria `awaiting_route_coverage`;
- containers previstos pelo EDI podem gerar divergência
  `missing_in_manifest` mesmo quando a rota ainda não tem nenhum BL;
- containers de BL que não existem no EDI continuam gerando
  `missing_in_baplie` quando houver dados para confrontá-los;
- o alerta de Baplie continua independente do alerta de BL faltante;
- o alerta só fecha quando todas as rotas tiverem BL com containers e não houver
  divergência;
- atualização do alerta aberto não envia nova notificação;
- nova divergência depois do fechamento cria novo ciclo.

O alerta é único por viagem, genérico na notificação e detalhado em /baplie.
Não criar alertas por BL ou container.

A importação do Baplie é soberana para flags físicas: ela sobrescreve os
valores físicos do B/L e registra a alteração em auditoria. Essa atualização
não produz divergência nem alerta.

## CE Mercante

O alerta considera somente BLs de importação/POD. Em escala mista, BLs de
exportação não entram nesta regra.

- abre no D−5 se houver BL de importação sem CE;
- sem BL, não abrir alerta de CE;
- qualquer CE vinculado ao BL é suficiente;
- BL novo sem CE, remoção de CE ou nova pendência reabre;
- remover um BL retira-o da lista e fecha o alerta se não restar outro;
- destino: /viagens/:voyageId.

## Exportação pós-ATD

O modal da escala deve exigir, quando houver exportação, um tipo:

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
- tipo não esperado é ignorado;
- remoção de vínculo reabre e notifica;
- alteração do tipo recalcula imediatamente;
- destino: viagem com a escala selecionada.

O fechamento manual exige data futura de revisão, sem limite máximo baseado no ETA
de importação.

## Nova implementação necessária

As seguintes capacidades não existem integralmente e devem ser tratadas na PR
de implementação:

1. Campo e validações do primeiro porto brasileiro externo e seu ETA, incluindo
   a precedência sobre o menor ETA próprio.
2. Campo/enum do tipo de exportação na escala.
3. Regra de POD e suspensão/reativação do fluxo de importação.
4. Estado de dispensa manual com motivo, autoria, revisão e exceções.
5. Detector server-side de BL por cobertura POL/POD.
6. Detector server-side de Baplie ausente somente para fluxo de importação
   elegível, com POD.
7. Reconciliação Baplie/BL com regra normal e override D−7, incluindo
   divergência de containers em rotas sem BL.
8. Detector D−5 de CE somente para BLs de importação.
9. Detector pós-ATD de exportação por escala.
10. Reavaliação imediata após BL, Baplie, POD, POL, ETA ou tipo de exportação.
11. Roteamento compartilhado para viagem/Baplie e seleção de escala.

Nenhuma coluna, enum ou migration é pré-inventada aqui. A implementação deve
validar as tabelas e RPCs atuais antes de escolher a próxima migration
sequencial.

## Bloqueios

### BLOCKED — fundação transversal #517

A fundação E1/E2/E3 precisa estar mergeada para gravidade, detectores
server-only, estado de dispensa e fan-out de notificações.

### BLOCKED — schema de configuração e ciclo de vida

O schema atual não contém necessariamente ETA externo, tipo de exportação,
gravidade, audiência, estado de dispensa e revisão. A migration própria só pode
ser criada depois da validação do contrato central e das tabelas atuais.

### BLOCKED — detectores server-side

A reconciliação Baplie hoje é consumida por TypeScript/telas e a importação
transacional não persiste os eventos descritos. O detector deve ser idempotente,
usar tabelas existentes, oferecer o modo forçado de D−7 e não criar tabela por
container ou BL.

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
