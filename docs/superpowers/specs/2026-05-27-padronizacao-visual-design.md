# Padronizacao Visual Do Sistema

Data: 2026-05-27

## Contexto

O Transhipping Desk esta em producao e concentra fluxos operacionais de viagens,
manifestos, containers, faturamento, demurrage, granito, vazios, relatorios e
administracao. A auditoria visual feita em ambiente local autenticado apontou
problemas recorrentes:

- overflow horizontal global causado pela navegacao superior em larguras comuns;
- botoes e tabs com contraste quebrado por classes antigas de tema escuro;
- mistura de primitivas novas (`app-btn`, `app-input`, `app-tab`, `app-table`) com
  classes hardcoded como `bg-[#0d1117]`, `text-white` e `text-slate-*`;
- tabelas largas empurrando a pagina ou exigindo truncamento inconsistente;
- modais longos com acoes importantes fora da area visivel inicial.

A direcao aprovada pelo usuario e a opcao A: **Sistema Operacional Refinado**.
Ela preserva a identidade atual do sistema e faz uma padronizacao ampla, mas
conservadora, focada em legibilidade, consistencia e ausencia de quebras visuais.

## Objetivos

1. Remover overflow horizontal global em telas internas na largura padrao do
   navegador e em viewport menor.
2. Garantir contraste legivel em botoes, tabs, filtros, acoes de tabela e
   estados ativos/inativos.
3. Padronizar componentes interativos para que paginas diferentes usem a mesma
   linguagem visual.
4. Ajustar tabelas, cards e KPIs para que numeros, labels e textos longos nao
   se sobreponham nem sejam escondidos por containers apertados.
5. Padronizar modais com corpo rolavel e area de acoes previsivel.

## Fora Do Escopo

- Regras de negocio, queries, migrations, permissoes e estrutura do banco.
- Alteracoes em PDFs/impressao de faturas.
- Redesign completo de marca, logo ou navegacao de informacao.
- Mudancas em autenticao, portal externo ou seguranca alem do necessario para
  renderizacao visual.

## Arquitetura Visual

A implementacao deve priorizar a camada compartilhada antes de ajustes pontuais.
As correcoes globais ficam em `src/index.css` e nos primitivos de
`src/components/ui`. Paginas so devem ser tocadas quando houver uso explicito de
classes antigas ou estrutura local que impeça a padronizacao.

### Tokens E Superficies

Usar as variaveis existentes (`--app-bg`, `--app-surface`, `--app-panel`,
`--app-border`, `--app-text`, `--app-muted`, `--app-blue-btn`, `--app-gold`) como
fonte de verdade. Hardcodes de tema escuro que aparecem dentro de paginas claras
devem ser substituidos por classes `app-*` ou por valores baseados nesses tokens.

Superficies operacionais devem continuar claras, densas e utilitarias. O header e
a navegacao mantem o navy atual, mas precisam impedir que o conteudo crie largura
global maior que a viewport.

### Navegacao

A barra superior deve manter todos os destinos existentes, mas seu container
precisa rolar internamente ou colapsar sem empurrar `body`, `#root` ou
`.app-shell`. Em desktop estreito, o scroll deve ficar restrito a
`.app-nav-scroll`; em mobile, o menu existente continua colapsado.

### Botoes, Tabs E Acoes

`Button`, `.app-btn`, `.app-tab`, `.app-table__action` e
`.app-table__icon-button` devem definir contraste, altura, padding, radius,
estado hover/focus/disabled e comportamento de texto. Botoes devem permitir
quebra controlada ou largura minima sem esconder texto. Tabs locais antigas devem
ser migradas para `.app-tab`.

### Inputs E Selects

`Input`, `Select`, `Textarea` e `.app-input` devem ter `min-width: 0`, largura
responsiva e padding suficiente para que valores e setas de select nao escondam
numeros ou palavras. Grids de filtros devem usar colunas `minmax(0, 1fr)`.

### Tabelas

Tabelas largas devem ficar dentro de `.app-table-scroll`, com `max-width: 100%` e
overflow horizontal interno. Celulas com texto longo devem usar helpers de
truncamento com `title`, e valores numericos/financeiros devem usar largura e
alinhamento previsiveis. O scroll interno nao deve gerar overflow no documento.

### Modais

`.app-modal` deve limitar altura pela viewport; `.app-modal__body` deve ser a
regiao rolavel quando o conteudo for longo; acoes de rodape devem permanecer
visiveis ou claramente separadas do conteudo. O header continua fixo. Modais de
importacao e cadastro devem seguir o mesmo espacamento e contraste.

## Paginas Com Ajuste Pontual Esperado

- `src/pages/Alertas.tsx`: tabs antigas com contraste quebrado.
- `src/pages/AdminUsuarios.tsx`: cards, tabs, selects e botoes ainda usam tema
  escuro hardcoded.
- `src/pages/Relatorios.tsx`: tabs antigas e pagina longa com mistura visual.
- `src/pages/TaxasLocais.tsx`: textos `text-white` em superficie clara e forms
  densos com risco de truncamento.
- `src/components/billing/ValidacaoTab.tsx`: blocos escuros dentro de tabela e
  filtros densos.
- Modais em `src/pages/Viagens.tsx` e componentes compartilhados de importacao:
  validar corpo rolavel e acoes.

Essa lista guia a primeira passada, mas ajustes equivalentes podem ser aplicados
em outras paginas quando encontrados pelo mesmo padrao.

## Criterios De Aceite

1. Em `/painel`, `/viagens`, `/manifestos`, `/taxas-locais`, `/faturamento`,
   `/demurrage`, `/relatorios`, `/alertas` e `/admin/usuarios`, o documento nao
   deve ter overflow horizontal global na largura padrao do navegador.
2. Botoes e tabs ativos/inativos devem ter contraste legivel em fundo claro e
   navy.
3. Tabelas largas podem rolar dentro do proprio frame, mas nao devem aumentar a
   largura de `body`.
4. Inputs e selects nao devem esconder texto por falta de padding ou `min-width`.
5. Modais longos devem permitir acesso claro aos botoes principais sem depender
   de descobrir conteudo cortado.
6. `npm run build` deve passar.
7. `npm run lint` deve ser executado; se houver falhas preexistentes, elas devem
   ser registradas sem misturar refactors fora do escopo.

## Verificacao Visual

Usar o navegador local autenticado para validar:

- desktop padrao do in-app browser;
- uma largura estreita de aproximadamente tablet/mobile;
- modal "Nova Viagem";
- modal "Importar Manifesto CNTR";
- pelo menos uma tabela operacional longa e uma pagina administrativa.

As verificacoes devem observar `document.documentElement.scrollWidth` contra
`document.documentElement.clientWidth`, contraste visual dos botoes/tabs e
ausencia de sobreposicao/truncamento incoerente em cards e campos.
