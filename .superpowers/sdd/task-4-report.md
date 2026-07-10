# Task 4 — Frente B: filtros do Painel

## Entrega

- Adicionado `src/lib/lineupFilters.ts` com estado padrão compatível com o Painel anterior (`status: active`), filtragem pura e contador de filtros.
- Adicionado `LineUpFilters` acessível: selects identificados por label, opções distintas extraídas das linhas e controles de presença com checkboxes.
- `Painel` filtra o snapshot antes de renderizar e antes da exportação XLSX.
- Exports são deliberadamente preservados em todos os filtros. MTY é resolvido por `voyageId`; RTW só é presente quando maior que zero; `waiting` e `missing` são agrupados em `Aguardando`.
- Registrado o limite do snapshot de 60 viagens com comentário `ponytail:` e nas documentações vivas.

## RED → GREEN

1. RED: `npm test -- lineupFilters` falhou porque `../lineupFilters` não existia.
2. GREEN: após a implementação do helper, o mesmo comando passou com 7 testes.
3. RED: o teste de integração de Painel falhou por não haver controle rotulado `Navios`.
4. GREEN: após `LineUpFilters` e a integração na página, `npm test -- lineup Painel.behavior` passou com 20 testes em 3 arquivos.

## Cobertura

- Helper: navio, viagem, período, veículos, BB, MTY por viagem, RTW nulo/zero, CEs aguardando, Linked, export sempre visível e contador.
- Integração: combinação de navio + veículos no Painel; testes existentes de status foram migrados para o select unificado.

## Documentação

- `docs/modules/operacao-suporte.md`: UI, helper, exportação filtrada e limite de 60 viagens.
- `docs/RASTREABILIDADE.md`: fluxo `/painel`, dimensões de filtro e exportação.

## Verificação

- `npm test -- lineup Painel.behavior` — 20 testes passando.
- `npm run typecheck` — passou.
- `npm run docs:check` — passou (132 Markdown, 37 rotas).
- `npm run lint` — passou.
- `npm run build` — passou.
- `git diff --check` — passou.

## Auto-revisão e ressalvas

- Escopo limitado aos filtros client-side solicitados; sem alteração de serviço, schema ou queries.
- Não houve exercício manual no app autenticado nesta execução. O comportamento é coberto por helper e teste de integração jsdom.
- O recorte de 60 viagens é intencional e documentado; histórico maior requer paginação ou ampliação da query.
