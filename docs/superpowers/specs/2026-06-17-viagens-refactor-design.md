# Refatoração da tela "Viagens" — Design

**Data:** 2026-06-17
**Status:** Aprovado pelo usuário (brainstorming concluído)
**Escopo:** UI/UX da página `/viagens` (e uma mudança global de layout)

## Contexto

A tela "Viagens" é um layout master-detalhe: à esquerda uma lista de viagens (componente `VoyageRail`), à direita o painel de detalhe (`VoyageCard`). O usuário quer **manter** esse padrão master-detalhe, mas:

1. Os filtros hoje vivem **dentro do sidebar** da lista (`VoyageRail.tsx`), misturados com o cabeçalho dela. Devem subir para o **topo** da página.
2. O sidebar da lista (400px fixo) rouba espaço do painel de detalhe.
3. Além disso, o app inteiro está calçado em `max-width: 1480px` (regra global `.app-main`), o que agrava a sensação de falta de espaço em monitores wide.

Pontos do brief original que se mantêm: badges de status padronizados, ações rápidas por item, estados de hover/focus/active, skeletons de loading.

## Decisões principais (aprovadas)

1. **Filtros migram para uma barra horizontal no topo** da página, em largura total.
2. **Lista vira painel colapsável lateral** (300px aberto ⇄ 64px recolhido), toggle pela borda do painel. Preferência persiste em `localStorage` (chave já usada hoje: `railCollapsed`).
3. **`.app-main` perde `max-width`** → todas as páginas passam a ocupar largura total do navegador. (Mudança global, confirmada pelo usuário.)
4. **Badges de status padronizados** via componente `Badge` existente + tokens `--app-*`; `ESTADO_META` centralizado (hoje duplicado em 2 arquivos com hex chumbado).
5. **Sem ação "Vincular BL" na lista** (BLs continuam sendo tratados a partir do detalhe).

## Anatomia da página

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER DO APP (já existe)                                     │
├─────────────────────────────────────────────────────────────┤
│ PAGE HEADER  "Viagens"                       [ + Nova Viagem ]│  ← mantém
├─────────────────────────────────────────────────────────────┤
│ BARRA DE FILTROS (topo, largura total) — NOVO                 │
│ 24 viagens  [🔎 Busca...]  [Período ▾]  [Status ▾]            │
│             [Conciliação ▾]                          [Limpar]  │
├──────────────┬──────────────────────────────────────────────┤
│ LISTA        │ PAINEL DE DETALHE                              │
│ (painel      │   largura total quando a lista está recolhida  │
│  colapsável  │                                                │
│  64⇄300px)   │                                                │
└──────────────┴──────────────────────────────────────────────┘
   ↑ tudo ocupa 100% da largura do navegador (sem max-width)
```

### Mudança global (escopo confirmado)

`src/index.css`, regra `.app-main` (linhas 754–758) — remove `max-width: 1480px` e `margin: 0 auto`, mantém o `padding`. Impacto: **todas** as páginas autenticadas passam a usar largura total. Portal e `/line-up-tv/display` não usam `.app-main`, então não são afetados.

## Seção 1 — Barra de filtros (topo)

### Composição (esquerda → direita)

```
24 viagens   [🔎 Busca: navio / viagem / armador / porto]   [Período ▾]   [Status ▾]   [Conciliação ▾]   [Limpar]
```

| Elemento | Comportamento |
|---|---|
| **Contador** (`24 viagens`) | `{visíveis} de {total} viagens`, no canto esquerdo como rótulo de contexto. Mostra `—` durante o load. |
| **Busca única** | Consolida os **dois** inputs de hoje (`Navio` + `Viagem, armador ou porto`) num só campo. Filtra em: `vesselName`, `voyageNumber`, `carrierName`, `originPorts`, `destinationPorts`. |
| **Período ▾** | Seletor de janela compacto (`Hoje / 7 dias / 30 dias / Personalizado`), ocupa a largura de um select. Filtra por ETA da próxima escala. **Não** usa dois date inputs (evita inflar a barra). |
| **Status ▾** | `Todas / Ativas / Concluídas` (já existe hoje). |
| **Conciliação ▾** | `Todas / Conciliada / Pendente` (já existe hoje). |
| **Limpar** | Zera todos os filtros. Só aparece quando `activeCount > 0`. |

### Reuso de componentes

- **`FilterBar`** (`src/components/ui/FilterBar.tsx`) — já tem `activeCount` + botão "Limpar". Hoje a Viagens ignora esse componente; o refactor passa a usá-lo.
- **`Input`** e **`Select`** (`src/components/ui/Input.tsx`) — substituem os `<input>`/`<select>` crus hoje usados no `VoyageRail`.

### Reorganização de estado

Hoje os filtros são `useState` locais dentro de `VoyageRail`. No refactor, o estado dos filtros sobe para o componente da página (`Viagens.tsx`) ou para um wrapper da barra de filtros, de forma que:
- A barra de filtros (topo) controla os filtros.
- O `VoyageRail` (lista) recebe a lista **já filtrada** e apenas renderiza + trata seleção/colapso.

### Estados ativos visíveis

- Botão **Limpar** aparece só quando há filtro ativo.
- Cada `Select` com filtro não-default mostra o label em `--app-blue` + negrito.

## Seção 2 — Painel de lista colapsável

### Larguras

- **Aberto:** 300px (reduzido dos 400px atuais).
- **Recolhido:** 64px (modo icon-only com dots de conciliação — já existe hoje, reaproveitado).
- Toggle pelo botão na **borda do painel** da lista (não na barra de filtros), porque controla a lista, não os filtros.

### Estado padrão e persistência

- Estado padrão: **aberto** (preserva o fluxo atual).
- Persiste em `localStorage`, mesma chave `railCollapsed` usada hoje.

### Conteúdo por item (estado aberto, 300px)

```
MAERSK ATLANTIC · 024E              [✎]
Hapag-Lloyd
●  12 BL · Santos 18/06
```

- Carrier name (uppercase, muted)
- `vesselName / voyageNumber` (bold)
- Dot de conciliação + chips (BL, CNTR, próxima escala) — como hoje, mas em tipografia mais compacta.
- Ícone `[✎]` Editar — aparece só no hover/focus (ver Seção 4).

### Estado recolhido (64px)

- Icon-only: um dot de conciliação por item, clique para selecionar.
- Ícone `[✎]` some.

## Seção 3 — Badges de status padronizados

### Os dois conceitos (não confundir)

| Conceito | Valores | Significado |
|---|---|---|
| **`status`** (ciclo de vida) | `Ativa`, `Concluída`, `Cancelada` | Tipo: `'active' \| 'completed' \| 'cancelled' \| null` em `src/types/database.ts:143` |
| **`estado`** (conciliação) | `Conciliada`, `Pendente` (incompleto), `Divergente` | `EstadoConciliacao` em `viagensHelpers.ts:281`, derivado por `deriveEstadoConciliacao()` |

### Padronização

1. **Centralizar `ESTADO_META`** em `src/lib/statusLabels.ts` (já agrega labels de status). Remover a duplicação de `VoyageRail.tsx:6–10` e `VoyageCard.tsx:57–61`.
2. **Mapear cores para tokens** `--app-*` (em vez de hex chumbado), para respeitar o tema dark:
   - Conciliada → `--app-green`
   - Pendente/incompleto → `--app-gold`
   - Divergente → `--app-red`
3. **Usar componente `Badge`** (`src/components/ui/Badge.tsx`, tons existentes: `green/red/yellow/slate/blue`):

| Valor | Tom do Badge |
|---|---|
| `Ativa` | `blue` |
| `Concluída` | `slate` |
| `Cancelada` | `red` |
| `Conciliada` | `green` |
| `Pendente` | `yellow` |
| `Divergente` | `red` |

### Onde cada badge aparece (regra anti-poluição)

- **Na lista (300px):** **apenas o dot** de conciliação. Não exibir badge de status (poluiria a lista compacta).
- **No painel de detalhe:** **ambos** os badges (`status` + `estado`) lado a lado no topo do hero, com labels completos.

## Seção 4 — Ações rápidas e botão primário

### Botão primário "Nova Viagem"

- **Mantém** no `PageHeader`, canto superior direito, admin-gated. Já está no lugar pedido pelo brief.
- Apenas garantir consistência visual com a nova barra de filtros logo abaixo.

### Ações por item da lista (estado aberto)

- **Um único ícone** aparece no hover/focus: `[✎]` Editar — abre o `VoyageCreateModal` em modo edição. Tooltip via `title=`.
- O **clique no item** abre o detalhe (ação primária). Não há botão redundante "Visualizar Detalhes".
- **Sem ação "Vincular BL"** na lista (decisão confirmada pelo usuário). BLs continuam sendo tratados a partir do detalhe.
- Estado recolhido (64px): sem ícones, só dot + clique para selecionar.

### Acessibilidade

- Ícone `[✎]` é visível tanto no **hover** (mouse) quanto no **focus** (teclado) — ou seja, fica visível sempre que o item recebe interação. Nunca fica escondido durante o focus.
- O ícone é sempre **focusable** via teclado (Tab), na ordem natural após o item da lista.
- O item da lista é um `<button>` clicável (já é hoje).

### Painel de detalhe

- Ações pesadas (Editar, Excluir, Exportar Schedule, Adicionar POD) já existem no `VoyageCard`. Mantêm como botões com ícones, padronizadas com `title=`.

### Tooltips — decisão de escopo

- **Sem componente `Tooltip` novo.** Usa `title=` nativo, padronizado em todos os ícones de ação. Tooltips ricos (instantâneos, estilizados) ficam como refactor separado, fora deste escopo.

## Seção 5 — Estados interativos e skeletons

### Estados de hover / focus / active

Usa os tokens `--app-*` já existentes. Sem novo sistema de animação.

**Itens da lista:**

| Estado | Tratamento |
|---|---|
| Default | Fundo `--app-surface` |
| Hover | Fundo `--app-surface-muted`, cursor pointer, transição 120ms |
| Focus (teclado) | Outline `--app-border-focus` (2px) |
| Active (clicando) | Leve escurecimento do hover |
| Selecionado | Borda esquerda 3px `--app-blue-btn` + fundo `--app-bg-elevated` (já existe hoje) |

**Botões e ícones de ação:**
- Hover: leve mudança de tom do background do ícone.
- Focus: outline `--app-border-focus`.
- Active: opacidade reduzida (feedback de clique).

**Filtros (`Input`/`Select`):**
- Herdam estados do `Input`/`Select` padrão (já têm focus ring).
- Selects com filtro ativo: label em `--app-blue` + negrito.

### Skeletons de loading

Substitui os textos crus de hoje ("Carregando viagens..." / "Carregando viagem...") pelo sistema de skeleton já usado no resto do app.

- **Lista carregando:** N itens skeleton imitando a estrutura de um item da lista, usando `app-skeleton-shimmer` (já existe no CSS).
- **Detalhe carregando:** `SkeletonCard` com a estrutura aproximada do `VoyageCard` hero (título, badges, métricas).
- **Barra de filtros:** sem skeleton — sempre disponível, mesmo durante o load. Só o contador mostra `—`.

### Estados de erro e vazio

- **Lista vazia (sem resultados do filtro):** mensagem clara + botão "Limpar filtros" (se houver filtro ativo). Reaproveita `EmptyState` existente.
- **Erro de carga:** `InlineError` (já existe) com botão de tentar de novo.

## Escopo — o que NÃO está incluído

Para manter o change cirúrgico (conforme `AGENTS.md` / `CLAUDE.md`):

- **Sem** componente `Tooltip` novo.
- **Sem** novos filtros além dos especificados (sem filtro por armador específico, porta específica, etc.).
- **Sem** nova tabela-cêntrica (mantém master-detalhe).
- **Sem** novos tokens de design (usam-se os existentes).
- **Sem** refactor do `VoyageCard` além da padronização de badges e ações (já especificada).
- **Sem** alteração de Portal ou `/line-up-tv/display` (não usam `.app-main`).

## Arquivos previstos para mudança (estimativa, sujeita ao plano)

- `src/index.css` — `.app-main` (remove max-width) + regras de estados se faltarem.
- `src/pages/Viagens.tsx` — subir estado dos filtros, integrar a barra de filtros no topo, repassar lista filtrada ao `VoyageRail`.
- `src/components/voyages/VoyageRail.tsx` — remover filtros (agora vivem na barra de topo), manter só lista + colapso + ícone Editar no hover.
- `src/components/voyages/VoyageCard.tsx` — remover `ESTADO_META` duplicado, usar `Badge` + labels centralizados.
- `src/lib/statusLabels.ts` — abrigar `ESTADO_META` centralizado com tokens.
- **Possivelmente novo:** um componente de barra de filtros para Viagens (ou extensão do `FilterBar` existente).

## Sucesso verificável

- App ocupa 100% da largura do navegador em telas wide.
- Filtros aparecem numa barra horizontal no topo, sempre visíveis, com botão Limpar quando há filtro ativo.
- Lista colapsa/recolhe entre 300px e 64px; preferência persiste após reload.
- Cores de status/estado respeitam o tema dark (sem hex chumbado).
- Lista e detalhe mostram skeletons durante o load (sem texto "Carregando...").
- `npm run lint` e `npm test` passam.
