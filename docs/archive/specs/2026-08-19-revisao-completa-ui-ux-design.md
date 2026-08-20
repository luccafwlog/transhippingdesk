# Revisão completa de UI/UX — design

## Objetivo

Revisar e corrigir todas as superfícies visíveis do Transhipping Desk e do
Portal do Cliente, preservando regras de negócio e a identidade navy/âmbar.
Uma superfície só é considerada aprovada quando carrega, comunica o estado,
permite concluir suas ações e mantém leitura e navegação em desktop e mobile.

## Escopo

- todas as rotas declaradas em `src/App.tsx`, inclusive autenticação,
  administração, Line-Up TV e inspeção interna do Portal;
- navegação, botões, links, tabs, menus, filtros, tabelas, paginação, modais,
  toasts, estados vazios/de erro/de carregamento e rolagem;
- Portal do Cliente, com prioridade para notificações;
- fatura local, recibo, invoice/recibo de Demurrage, relatório do cliente e
  Agency Departure Report em tela e em impressão;
- viewports de 1440×900, 1024×768 e 390×844, além de `print` em A4.

## Princípios

1. Corrigir primeiro componentes e tokens compartilhados; exceções locais vêm
   depois.
2. Manter densidade operacional em desktop e oferecer scroll explícito ou cards
   no mobile, sem esmagar tabelas.
3. Todo controle tem alvo mínimo de 40×40 px, foco visível, nome acessível e
   resposta de hover/press compatível com o dispositivo.
4. Texto de leitura parte de 14 px; metadados podem usar 12 px. Valores
   financeiros usam numerais tabulares e formatação pt-BR.
5. Modais prendem o foco, fecham por Escape quando seguro, devolvem o foco ao
   disparador e não escapam da viewport.
6. A impressão contém somente o documento, sem chrome da aplicação, com cores,
   quebra de página e margens previsíveis.
7. Erro de dados nunca se apresenta como zero, vazio ou sucesso.

## Direção visual

A linguagem atual será refinada, não substituída. Superfícies claras, navy para
estrutura e âmbar para ênfase permanecem. Estados de interação passam a usar
tokens completos de hover/link/foco; sombras são suaves; raios concêntricos;
títulos têm quebra balanceada; microinterações usam apenas transform/opacity,
respeitam `prefers-reduced-motion` e não atrasam ações frequentes.

## Portal e notificações

O sino terá área de toque adequada e painel responsivo ancorado ao viewport. A
lista usará ícones vetoriais, contraste suficiente, título em 14 px, mensagem em
13 px sem truncamento destrutivo, data relativa/absoluta acessível, separação
clara entre lida e não lida, loading/empty/error states e navegação por teclado.
No mobile, o painel não poderá ultrapassar as bordas da tela.

## Verificação

A matriz de evidência registra rota, viewport, conteúdo, console, overflow,
controles pequenos e captura. Fluxos interativos cobrem menus, tabs, modais,
paginação, impressão e Portal. A conclusão exige testes focados, `typecheck`,
`lint`, suíte completa, `docs:check`, build e uma nova captura após as correções.

## Limites

Esta revisão não altera cálculo, PIX, RLS, migrations, exclusões nem semântica
financeira. Problemas nessas fronteiras serão documentados sem mudança de
comportamento.
