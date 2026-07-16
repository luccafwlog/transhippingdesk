# 0025 — B/L como fonte documental única da carga de container e do ATD do POL

Status: aceito — 2026-07-16

## Contexto

O sistema mantém dois caminhos documentais para criar carga de container:
Manifesto CNTR e arquivo de B/L. Isso duplica autoridade, exige regras de
precedência e permite que duas fontes descrevam os mesmos B/Ls. O arquivo de
B/L contém os dados necessários da carga, Frete & Despesas e a data `Laden on
Board`, enquanto o Baplie continua sendo a fonte física de posição e flags.

Foram consideradas a manutenção das fontes co-primárias definida na ADR 0017
e a adoção do B/L como fonte documental única para container.

## Decisão

O arquivo de B/L será a fonte documental única de ingestão da carga de
container. O sistema deixará de oferecer importação de Manifesto CNTR. Manifesto
BB, Granito, Baplie, veículos e vazios preservam seus fluxos próprios.

A data `Laden on Board` do B/L alimentará o ATD do POL da Rota da Viagem. ETD e
ATD permanecerão dados distintos. Em telas sem coluna própria de ATD, o ATD
ocupará visualmente a célula de ETD com destaque verde.

Quando múltiplos B/Ls da mesma Viagem e POL trouxerem datas `Laden on Board`
diferentes, o sistema adotará automaticamente a data mais antiga como ATD
canônico do POL, sem abrir divergência ou solicitar confirmação.

Esta decisão supersede a ADR 0017 quanto à autoridade compartilhada com o
Manifesto CNTR e a ADR 0005 quanto ao Manifesto CNTR como fonte de ingestão.

## Consequências

- O importador, os botões e as rotas conceituais de Manifesto CNTR deverão ser
  removidos; a rota `/manifestos` pode continuar como lista de B/Ls CNTR.
- Conciliação física passa a ser Baplie × B/L, não Baplie × Manifesto CNTR.
- O importador de B/L deverá persistir `Laden on Board` como ATD do POL e
  recalcular o mínimo quando houver múltiplos B/Ls da mesma Viagem e POL.
- Código e documentação ainda ligados ao importador CNTR são legado pendente de
  remoção; não constituem exceção à decisão.
- Arquivos históricos e migrations permanecem preservados.
