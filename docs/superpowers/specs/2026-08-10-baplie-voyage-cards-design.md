# Cards por navio/viagem na tela Baplie EDI

## Objetivo

Adicionar uma visão inicial na tela `/baplie` com cards para todas as viagens cadastradas, independentemente de possuírem Baplie importado. A seleção atual de viagem continua disponível para abrir o detalhe operacional.

## Comportamento

- A tela exibe uma grade de cards antes do detalhe da viagem.
- Cada card apresenta armador, navio/viagem, estado do Baplie e chips das escalas com porto e data.
- Os cards são ordenados pela próxima escala conhecida.
- Viagens sem Baplie aparecem normalmente e indicam que o arquivo ainda não foi importado.
- Clicar no card seleciona a viagem e preserva o conteúdo atual de staging, reconciliação, vazios e exportação.
- O filtro/seletor atual permanece como mecanismo rápido de busca e seleção.
- Loading e estado vazio da listagem de viagens são explícitos; falhas seguem o padrão de erro já usado pela página.

## Dados e arquitetura

Usar a consulta existente de opções de viagem como base para listar todas as viagens. Complementar os dados necessários das escalas e do staging em uma camada de apresentação testável, sem duplicar regras de persistência. O indicador de Baplie será derivado do staging carregado por viagem quando possível, mantendo o detalhe atual como fonte de verdade ao abrir uma viagem.

O novo visual seguirá os tokens e componentes existentes: cards claros sobre o fundo da aplicação, hierarquia compacta de armador e navio/viagem, chips de rota/data e estados de importação com contraste acessível. Não haverá alteração no fluxo de importação nem criação automática de dados.

## Testes

- Testar a transformação/ordenação dos dados dos cards, incluindo viagens sem Baplie.
- Testar na página que a visão inicial lista todas as viagens e que a seleção de um card abre o detalhe correspondente.
- Executar testes focados, typecheck, lint dos arquivos alterados e `git diff --check`.
