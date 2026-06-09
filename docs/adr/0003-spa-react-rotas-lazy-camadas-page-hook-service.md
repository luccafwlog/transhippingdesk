# 0003 — SPA React com rotas lazy e camadas page/hook/service

Status: aceito — 2026-06-09

## Contexto

O Transhipping Desk concentra muitos módulos operacionais, financeiros e de portal em uma única aplicação de navegador: viagens, importações, revisão, clientes, taxas locais, faturamento, demurrage, conciliação, relatórios, administração e Portal do Cliente.

Sem uma separação estável, a tendência natural seria cada tela misturar navegação, cache, acesso ao Supabase, parsing de arquivos e componentes visuais, tornando difícil evoluir módulos grandes como `Faturamento`, `TaxasLocais`, `Viagens`, `Revisao` e `BlDetalhe`.

## Decisão

Manter o app como uma SPA estática em React 19 + TypeScript + Vite, com rotas no cliente e separação explícita entre páginas, hooks, serviços e componentes.

- `src/App.tsx` é o mapa canônico de rotas. Cada tela é carregada via `lazyPage()` e exporta um componente nomeado.
- `ProtectedRoute`, `ProtectedRoute adminOnly` e `PortalProtectedRoute` separam navegação interna, administração e portal. Essas barreiras são de experiência de uso; a autorização real fica no Supabase/RLS.
- `src/main.tsx` concentra os providers globais: React Query, roteador, toast, confirmação, tema visual, auth interna, auth do portal e `ErrorBoundary`.
- `pages/` orquestra fluxos de tela e interação do usuário.
- `hooks/` encapsula React Query, cache, mutations e invalidação.
- `services/` concentra acesso a Supabase, RPCs, parsers, regras de domínio testáveis e deve lançar erro quando a operação falha.
- `components/ui/`, `components/layout/`, `components/shared/`, `components/billing/`, `components/demurrage/` e `components/lineup/` mantêm componentes reutilizáveis fora das páginas.

## Consequências

- **Positivas**: adicionar uma rota nova tem caminho previsível; chunks por rota reduzem o custo inicial do bundle; serviços podem ser testados sem renderizar UI; React Query fica com chaves centralizadas e invalidações mais rastreáveis.
- **Negativas / custos**: páginas legadas ainda podem ficar grandes quando concentram fluxos densos; decompor essas páginas exige testes antes para evitar regressão operacional.
- **Regra prática**: nova funcionalidade deve nascer no menor ponto apropriado: componente visual em `components/`, estado remoto em `hooks/`, domínio/acesso a dados em `services/` e apenas composição de fluxo em `pages/`.
