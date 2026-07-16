# Refinamento operacional de Viagens, Importações, Line-Up e Portal

## Status

Spec aprovada em sessão de grilling com o responsável pelo produto. Este
documento descreve o comportamento desejado; divergências do código atual são
trabalho de implementação, não alternativas ainda abertas.

## Objetivo

Consolidar as decisões funcionais para:

- tornar o arquivo de B/L a fonte documental única da carga de container;
- separar previsões e eventos reais da escala;
- eliminar importadores e ações legadas;
- tornar Viagens, timeline, Painel e Line-Up TV coerentes;
- simplificar omissão, transbordo e COD;
- alinhar consignatário, confirmações de exclusão e Portal;
- unificar a referência cambial de demurrage.

## Princípios

1. Uma informação possui uma fonte canônica; importadores paralelos não
   permanecem ocultos como caminhos alternativos.
2. Datas estimadas e reais são conceitos distintos, mesmo quando uma tela usa a
   mesma célula para apresentá-las.
3. Estado operacional deve ser derivado de fatos quando possível.
4. Ações destrutivas sobre dados persistidos exigem confirmação explícita.
5. O Portal mostra somente informação útil ao cliente, sem expor controles ou
   fórmulas internas desnecessárias.

## 1. B/L como fonte documental da carga de container

### Regra

O Manifesto CNTR deixa de ser fonte de ingestão. O arquivo de B/L passa a ser a
fonte documental dos B/Ls e containers. O Baplie EDI permanece a fonte física de
staging e conciliação.

`Laden on Board` do B/L representa o ATD do POL. Para B/Ls da mesma Viagem e POL
com datas diferentes, prevalece automaticamente a data mais antiga.

ETD e ATD permanecem armazenados como campos distintos. Em telas sem coluna
ATD, a data real ocupa visualmente a célula ETD e aparece em verde.

### Critérios de aceite

- Não existe botão ou rota funcional para importar Manifesto CNTR.
- Importar B/L cria ou atualiza a carga de container dentro da viagem escolhida.
- A importação atualiza o ATD do POL com o menor `Laden on Board` aplicável.
- Reimportações não substituem o ATD canônico por uma data posterior.
- Documentação, testes e terminologia não tratam Manifesto CNTR como autoridade.

## 2. Identidade de navio por aliases de prefixo

### Regra

A validação navio/viagem do B/L aceita aliases bidirecionais apenas no prefixo
completo do nome:

| Forma canônica | Aliases aceitos |
|---|---|
| `ZHONG YUAN HAI YUN` | `ZYHY` |
| `COSCO SHIPPING` | `CS`, `C.S.` |

O alias precisa ser um token inicial separado do restante do nome. Não há fuzzy
matching nem expansão no meio do texto. `CSALGOL`, por exemplo, não é alias de
`COSCO SHIPPING ALGOL`. O número da viagem continua exigindo correspondência.

O sistema não altera o nome armazenado ou exibido; a canonicalização existe
somente para comparação de identidade.

### Critérios de aceite

- `ZYHY JIN QU / 39` casa com `ZHONG YUAN HAI YUN JIN QU / 39`.
- `CS ALGOL / 10` e `C.S. ALGOL / 10` casam com
  `COSCO SHIPPING ALGOL / 10`.
- Alias no meio do nome, token concatenado ou viagem divergente permanece
  bloqueante no preview.

## 3. Ciclo de vida da Viagem

### Estados

- `Ativa`: viagem em execução ou planejamento.
- `Concluída`: todas as escalas ativas e não omitidas possuem ATD.
- `Cancelada`: o armador deixou de realizar uma viagem anteriormente registrada
  ou programada. O registro e seus vínculos são preservados para rastreabilidade.
- `Excluída` não é status; corresponde a hard delete controlado.

Cancelamento é distinto de conclusão e exclusão. O código atual ainda usa a
edição genérica de status; uma ação dedicada com confirmação, motivo e auditoria
é recomendada. A política de eventual reativação não foi definida nesta spec.

## 4. Próxima Escala

`Próxima Escala` é o POD ativo, não omitido, sem ATA, com menor ETA. A data não
é comparada com o relógio atual: uma ETA vencida continua sendo a próxima escala
até o registro da ATA e deve mostrar `ETA vencido — ATA pendente`.

## 5. Linha do Tempo da Viagem

### Escopo

A timeline é operacional e não financeira. Mantém eventos de viagem, agenda,
CE, Baplie, conciliação, imports e omissões.

Importações de B/L aparecem consolidadas por rota, uma entrada para cada
POL/POD, por exemplo:

> 9 B/Ls importados · TAICANG → VITÓRIA

Omissões aparecem como:

> Escala de VITÓRIA omitida · Porto de Transbordo — SANTOS · motivo:
> congestionamento portuário

O motivo é omitido do texto quando ausente. Renomeações editoriais, como
Baplie × Manifesto para Baplie × B/L, não são acontecimentos e não geram evento.

## 6. Omissão, Transbordo e COD

### Registro global

Omitir uma escala cria um único registro global compartilhado por todos os B/Ls
afetados. O modal inicial contém:

| Campo | Obrigatoriedade inicial |
|---|---|
| Porto de Transbordo | Obrigatório |
| Navio de Transbordo | Opcional |
| Armador de Transbordo | Opcional |
| Viagem de Transbordo | Opcional |
| ETD de Transbordo | Opcional |
| ETA de Transbordo | Opcional |
| Motivo | Opcional |

Os campos opcionais são dados ainda desconhecidos, não dados descartáveis. O
registro pode ser complementado posteriormente no card `Informações de
Transbordo` da Viagem.

Na ficha do B/L, os dados globais são herdados e exibidos somente para leitura.
COD continua sendo decisão individual por B/L e é marcado na própria ficha.

### Histórico e Portal

- A omissão e cada atualização global entram na timeline da Viagem e no
  histórico de todos os B/Ls afetados.
- O Portal envia uma notificação quando ocorre a omissão.
- O Portal mantém um card persistente com a informação atual de transbordo.
- Complementações do registro atualizam o card sem gerar uma notificação para
  cada edição.
- Quando um B/L específico vira COD, somente ele recebe uma nova notificação.

## 7. Confirmação de exclusões

Toda ação que apaga ou remove um registro persistido abre confirmação, mesmo
quando não há B/L ou dependência vinculada. O diálogo identifica o objeto,
informa consequências relevantes e usa uma ação explícita, como `Excluir`.

Não exigem confirmação destrutiva:

- remover linha ainda não salva de formulário;
- limpar filtros;
- desfazer seleção;
- fechar ou cancelar edição não salva.

## 8. Razão social do consignatário

Listagens e reconciliação exibem somente a razão social. O extrator usa a
natureza jurídica como término inclusivo e reconhece `LTDA`, `S.A.`, `EIRELI`,
`EI`, `MEI`, `SLU`, `EPP`, `ME` e combinações, como `LTDA EPP`.

Conteúdo posterior — endereço, CEP, telefone, cidade ou país — não integra o
nome curto. Sem natureza jurídica reconhecida, usa-se a primeira linha não
vazia. O bloco original completo permanece intacto para EDI e auditoria.

## 9. Aba Importação da Viagem

As ações aparecem nesta ordem:

1. Baplie EDI;
2. B/L;
3. CE Mercante;
4. Manifesto BB;
5. Veículos;
6. Vazios IMP.

`Manifesto CNTR` é removido. `Manifesto Vazios Imp.` passa a se chamar
`Vazios IMP`, e `Planilha Veículos` passa a se chamar `Veículos`.

Os modais de CE Mercante, Manifesto BB e Veículos oferecem planilhas-modelo. O
CE Mercante reutiliza o importador existente, mas fica travado na viagem aberta:
B/L de outra viagem aparece como erro bloqueante no preview e não é atualizado.

## 10. Tela B/Ls CNTR

Remover:

- `Gerar EDI Mercante`;
- `Importar Manifesto CNTR`.

Permanecem `Exportar`, `Importar CE Mercante` e `Importar B/L`. A solicitação
anterior de apenas uniformizar a cor do botão CNTR foi superada pela remoção.

## 11. Tela Containers

O botão e o título do modal passam a se chamar
`Importar Datas de Descarga e Devolução`.

O arquivo exige B/L, container e descarga; devolução é opcional e, quando
presente, não pode ser anterior à descarga.

O importador independente `Importar IMO/OOG` é integralmente retirado: botão,
modal, parser, serviço e testes exclusivos. O Baplie EDI passa a ser a fonte
física única dos atributos, preservando o fluxo de resolução de divergências.

## 12. Datas e estado das escalas

Cada escala do Planejamento por POD/POL comporta o ciclo completo:

| Movimento | Estimado | Real |
|---|---|---|
| Chegada | ETA | ATA |
| Atracação | ETB | ATB |
| Saída | ETD | ATD |

Os campos estimados e reais não se sobrescrevem conceitualmente.

O estado da escala é derivado:

- ATB preenchido e ATD vazio: `Atracada`;
- ATD preenchido: `Concluída`.

Concluir uma escala não conclui isoladamente a Viagem.

## 13. Painel e Line-Up TV

### Linha atracada

A linha da escala usa fonte verde quando possui ATB e não possui ATD. Com ATD,
perde o destaque de atracação. CEs e Linked preservam badges e cores próprios.
A regra é aplicada à escala da linha, não genericamente a todas as linhas da
Viagem.

### Coluna ETA

- Sem ATA, mostra ETA com a cor normal.
- Com ATA, mostra ATA em verde na mesma coluna, ainda intitulada `ETA`.
- Se ATA for removida por correção, volta a mostrar ETA.
- O verde da data significa chegada efetiva e não depende do estado atracado.
- O indicador `Início do ciclo` usa a mesma precedência ATA sobre ETA.

### Fronteira do carrossel

Uma borda horizontal destacada separa permanentemente a última escala da
primeira na ordem do ciclo. A borda acompanha a primeira linha durante a
animação; não pertence a uma posição fixa da tela. No mobile, aparece antes do
card da primeira escala. O texto `Início do ciclo` permanece no cabeçalho.

A referência visual aprovada foi a borda entre `GREEN SANTOS / 16` e
`ZYHY JIN QU / 39` no exemplo fornecido pelo responsável pelo produto.

## 14. Retirada do Backfill do Portal

O backfill inicial já cumpriu sua finalidade. Remover integralmente:

- item `Backfill do Portal` do menu;
- rota `/admin/portal-backfill`;
- página `AdminPortalBackfill`;
- funções frontend `runPreflight` e `runBackfill`;
- tipos das RPCs;
- RPCs ativas `portal_provisioning_preflight` e
  `portal_provisioning_backfill`, por nova migration de revogação e remoção.

Migrations históricas não são reescritas. O mecanismo interno vigente que cria
ou repara registros ausentes para clientes novos permanece.

## 15. PTAX e ROE

### Header interno

Remover CNY da interface, tipo, cache e constante `CNY_PER_USD`. O header passa
a mostrar, no padrão visual do Demurrage Manager:

> PTAX Venda R$ 5,0975 → PTAX × 1,065 = ROE R$ 5,4288 (16/07/2026)

Regras:

- consultar a cotação de venda mais recente no período dos últimos dez dias;
- usar a data efetiva retornada pelo BCB;
- calcular PTAX e ROE com quatro casas decimais;
- disponibilizar atualização manual da consulta ao BCB;
- mostrar loading, indisponibilidade e staleness;
- não permitir digitação manual no header;
- manter o header oculto no mobile;
- consumir a mesma referência autoritativa usada pelo recálculo financeiro de
  demurrage, sem um segundo contrato de cache/cálculo no navegador.

A entrada manual de PTAX permanece somente no módulo Demurrage.

### Aplicação financeira

O recálculo aplica o ROE a todas as invoices de demurrage emitidas e não pagas,
atualizando `current_roe`, `current_total_brl`, PIX e histórico. Invoices pagas
preservam o valor congelado.

### Portal do Cliente

O Portal não recebe o header cambial. Somente a aba `Faturas → Demurrage`
apresenta, acima da listagem:

> ROE vigente: R$ 5,4288 · atualizado em 16/07/2026

Não exibe PTAX, fórmula nem botão de atualização. O valor vem da mesma referência
autoritativa do recálculo global. O detalhe da invoice mostra o ROE efetivamente
aplicado, inclusive o congelado após pagamento.

## Impactos técnicos esperados

### Banco e migrations

- persistência do ciclo completo ETA/ATA, ETB/ATB e ETD/ATD por escala;
- registro global progressivo de omissão/transbordo;
- retirada das RPCs de backfill por migration nova;
- leitura segura da referência cambial vigente pelo Portal;
- auditoria de cancelamento, importações por rota e alterações de transbordo.

### Serviços

- canonicalização compartilhada de aliases de navio;
- consolidação da ingestão documental em B/L;
- escopo de viagem no CE Mercante;
- retirada dos serviços legados CNTR, IMO/OOG e backfill;
- fonte cambial compartilhada entre header, recálculo e Portal.

### Interface

- reorganização das ações de importação;
- novos campos e estados de escala;
- regras visuais do Painel e Line-Up TV;
- informações globais de transbordo com COD individual;
- apresentação contextual do ROE no Portal.

## Critérios transversais de qualidade

- Testes reproduzem regras de aliases, menor `Laden on Board`, estados de
  escala, precedência ATA/ETA e fronteira circular do Line-Up.
- Testes de contrato SQL cobrem novas migrations, guardas e auditoria.
- Nenhum fluxo removido permanece acessível por rota, menu ou RPC ativa.
- O Portal não consulta diretamente o BCB nem deriva ROE no navegador.
- `npm run docs:check`, `npm run lint`, `npm test` e `npm run build` passam.
- Validação visual cobre Painel, Line-Up TV desktop/mobile, modais de importação
  e aba Demurrage do Portal.

## Fora de escopo

- Fuzzy matching genérico de nomes de navio.
- Criar uma Viagem própria para o navio de transbordo.
- Automatizar efeitos financeiros de omissão, transbordo ou COD.
- Exibir fórmula PTAX × markup no Portal.
- Permitir PTAX manual no header global.
- Reescrever migrations históricas.
- Definir nesta spec se uma Viagem cancelada pode ser reativada.

## Fontes relacionadas

- [Contexto de domínio](../../CONTEXT.md)
- [ADR 0025 — B/L como fonte documental](../adr/0025-bl-fonte-documental-unica-container-atd-pol.md)
- [Viagens](../modules/viagens.md)
- [Manifestos e EDI](../modules/manifesto-edi.md)
- [Demurrage](../modules/demurrage.md)
- [Portal do Cliente](../modules/portal-cliente.md)
- [Operação e Suporte](../modules/operacao-suporte.md)
- [Rastreabilidade](../RASTREABILIDADE.md)
