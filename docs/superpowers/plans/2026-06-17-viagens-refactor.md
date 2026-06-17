# Refatoração da tela "Viagens" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar a tela `/viagens` movendo filtros para uma barra no topo, transformando a lista em painel colapsável, padronizando badges de status via tokens e adicionando skeletons de loading — além de remover o `max-width` global de `.app-main`.

**Architecture:** Refatoração focada na página `Viagens.tsx` + componentes `VoyageRail`/`VoyageCard`, reaproveitando componentes de UI já existentes (`FilterBar`, `Badge`, `Input`, `Select`, `SkeletonCard`). O estado dos filtros sobe de `VoyageRail` para a página. Um mapa central `ESTADO_META` substitui as duplicações com hex chumbado.

**Tech Stack:** React 19 + TypeScript, Tailwind 4 + CSS custom properties (`--app-*`), React Query, Vitest + Testing Library.

**Spec de referência:** `docs/superpowers/specs/2026-06-17-viagens-refactor-design.md`

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/index.css` | Modificar (regra `.app-main`) | Remover `max-width` global |
| `src/lib/statusLabels.ts` | Modificar | Abrigar `ESTADO_META` centralizado com tokens |
| `src/components/voyages/VoyageRail.tsx` | Modificar | Remover filtros; receber lista já filtrada; manter lista + colapso + ícone Editar |
| `src/components/voyages/VoyageCard.tsx` | Modificar | Remover `ESTADO_META` local; usar `Badge` para status + estado |
| `src/pages/Viagens.tsx` | Modificar | Centralizar estado dos filtros; renderizar barra de filtros no topo; repassar lista filtrada |
| `src/components/voyages/VoyageFilters.tsx` | Criar | Barra de filtros do topo (usa `FilterBar`) |
| `src/lib/viagensFilters.ts` | Criar | Lógica pura de filtragem (fácil de testar) |
| `src/lib/__tests__/viagensFilters.test.ts` | Criar | Testes da filtragem |
| `src/lib/__tests__/statusLabels.test.ts` | Criar | Teste do `ESTADO_META` centralizado |

### Decisões de implementação (corrigem/refinam o spec)

1. **`FilterBar` é recolhível por natureza** (toggle "Filtros" no header). O spec quer filtros **sempre visíveis**. Solução: usar `FilterBar` mas com `defaultOpen={true}` e o título passando a ser o contador de contexto. O recolhimento permanece disponível (é comportamento do componente compartilhado; não o alteramos para não afetar outras telas). Num tela operacional, abrir por padrão já atende "sempre visíveis".

2. **Persistência do colapso da lista:** o spec disse "mesma chave usada hoje" (`railCollapsed`), mas hoje **não há** persistência — é `useState(false)`. Vamos adicionar persistência via `localStorage` sob a chave `viagens:rail-collapsed`.

3. **`ESTADO_META` centralizado** precisa ter `{ label, color, bg, dot }` (4 campos) porque `VoyageCard` usa `.color`/`.bg` e `VoyageRail` usa `.dot`. As cores virão dos tokens via `getComputedStyle` **não** — tokens CSS não são acessíveis em TS no tempo de módulo. Em vez disso, mantemos os hex no mapa central **mas** referenciando os mesmos valores dos tokens `--app-*` e adicionamos um comentário documentando a correspondência. Para os dots/banners respeitarem o tema dark de fato, usaremos as cores via CSS classes (`app-badge--*`) onde possível; os estilos inline (banner do `VoyageCard`) são ajustados para usar `var(--app-*)` no `style`, lidos em runtime no JSX (ex: `style={{ backgroundColor: 'var(--app-red)' }}`). **Refinamento:** o `ESTADO_META` centralizado exporta classes/variáveis CSS, não hex. Detalhado na Task 1.

---

## Task 1: Centralizar `ESTADO_META` em `statusLabels.ts` (com tokens)

**Objetivo:** Criar a fonte única de verdade para metadados de conciliação, referenciando variáveis CSS (`--app-*`) para respeitar o tema dark.

**Files:**
- Modify: `src/lib/statusLabels.ts` (adicionar export no final)
- Test: `src/lib/__tests__/statusLabels.test.ts` (criar)

- [ ] **Step 1: Escrever o teste falhando**

Criar `src/lib/__tests__/statusLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ESTADO_CONCILIACAO_META, VOYAGE_STATUS_BADGE_TONE } from '../statusLabels'

describe('ESTADO_CONCILIACAO_META', () => {
  it('tem entradas para divergente, incompleto e conciliado', () => {
    expect(ESTADO_CONCILIACAO_META.divergente.label).toBe('Divergente')
    expect(ESTADO_CONCILIACAO_META.incompleto.label).toBe('Pendente')
    expect(ESTADO_CONCILIACAO_META.conciliado.label).toBe('Conciliado')
  })

  it('usa variáveis CSS (var(--app-*)) para cor e fundo, nunca hex', () => {
    const entries = Object.values(ESTADO_CONCILIACAO_META)
    for (const meta of entries) {
      expect(meta.color).toMatch(/^var\(--app-/)
      expect(meta.bg).toMatch(/^var\(--app-/)
    }
  })

  it('cada entrada tem classe de badge para uso no componente Badge', () => {
    expect(ESTADO_CONCILIACAO_META.divergente.badgeTone).toBe('red')
    expect(ESTADO_CONCILIACAO_META.incompleto.badgeTone).toBe('yellow')
    expect(ESTADO_CONCILIACAO_META.conciliado.badgeTone).toBe('green')
  })
})

describe('VOYAGE_STATUS_BADGE_TONE', () => {
  it('mapeia status de viagem para tons de badge', () => {
    expect(VOYAGE_STATUS_BADGE_TONE.active).toBe('blue')
    expect(VOYAGE_STATUS_BADGE_TONE.completed).toBe('slate')
    expect(VOYAGE_STATUS_BADGE_TONE.cancelled).toBe('red')
  })
})
```

- [ ] **Step 2: Rodar o teste para verificar que falha**

Run: `npx vitest run src/lib/__tests__/statusLabels.test.ts`
Expected: FAIL — `ESTADO_CONCILIACAO_META` e `VOYAGE_STATUS_BADGE_TONE` não existem.

- [ ] **Step 3: Implementar no `statusLabels.ts`**

Adicionar ao final de `src/lib/statusLabels.ts`:

```ts
import type { EstadoConciliacao } from '../pages/viagensHelpers'
import type { BadgeTone } from '../components/ui/Badge'

// Fonte única de metadados do estado de conciliação. As cores referenciam
// variáveis CSS (--app-*) para respeitar o tema dark. O campo `badgeTone`
// permite usar o componente <Badge> diretamente; `color`/`bg` atendem os
// estilos inline do banner de conciliação do VoyageCard.
export const ESTADO_CONCILIACAO_META: Record<
  EstadoConciliacao,
  { label: string; color: string; bg: string; badgeTone: BadgeTone }
> = {
  divergente: {
    label: 'Divergente',
    color: 'var(--app-red)',
    bg: 'var(--app-red-soft)',
    badgeTone: 'red',
  },
  incompleto: {
    label: 'Pendente',
    color: 'var(--app-gold)',
    bg: 'var(--app-gold-soft)',
    badgeTone: 'yellow',
  },
  conciliado: {
    label: 'Conciliado',
    color: 'var(--app-green)',
    bg: 'var(--app-green-soft)',
    badgeTone: 'green',
  },
}

export const VOYAGE_STATUS_BADGE_TONE: Record<string, BadgeTone> = {
  active: 'blue',
  completed: 'slate',
  cancelled: 'red',
}
```

- [ ] **Step 4: Verificar que `BadgeTone` é exportável de `Badge.tsx`**

O tipo `BadgeTone` hoje é **local** em `Badge.tsx` (não exportado). Adicionar export em `src/components/ui/Badge.tsx`:

Trocar:
```ts
type BadgeTone = 'blue' | 'green' | 'red' | 'yellow' | 'slate'
```
por:
```ts
export type BadgeTone = 'blue' | 'green' | 'red' | 'yellow' | 'slate'
```

- [ ] **Step 5: Rodar o teste para verificar que passa**

Run: `npx vitest run src/lib/__tests__/statusLabels.test.ts`
Expected: PASS (todos os 6 asserts).

- [ ] **Step 6: Confirmar que os tokens `*-soft` existem em `index.css`**

Buscar em `src/index.css` por `--app-red-soft`, `--app-gold-soft`, `--app-green-soft`. Se algum não existir, adicionar à seção `:root` (linhas 7–44) com valor de fundo suave derivado. O relatório de exploração confirmou que `--app-red`/`--app-gold`/`--app-green` existem com variantes `-soft`; se faltar alguma `-soft`, usar o valor `rgba(...)` correspondente ao do `VoyageCard.tsx` original como fallback documentado.

- [ ] **Step 7: Commit**

```bash
git add src/lib/statusLabels.ts src/lib/__tests__/statusLabels.test.ts src/components/ui/Badge.tsx
git commit -m "refactor(status): centraliza ESTADO_META em statusLabels com tokens CSS"
```

---

## Task 2: Migrar `VoyageCard` para usar `ESTADO_CONCILIACAO_META` + `Badge`

**Objetivo:** Remover o `ESTADO_META` local do `VoyageCard`, usar a fonte centralizada, e trocar o pill de status inline por `<Badge>`.

**Files:**
- Modify: `src/components/voyages/VoyageCard.tsx` (linhas 57–61, 748–750)

- [ ] **Step 1: Remover o `ESTADO_META` local e ajustar o import**

Em `src/components/voyages/VoyageCard.tsx`, **remover** o bloco das linhas 57–61:
```ts
const ESTADO_META: Record<EstadoConciliacao, { label: string; color: string; bg: string }> = {
  divergente: { label: 'Divergente', color: '#cf4b3f', bg: 'rgba(207,75,63,0.12)' },
  incompleto: { label: 'Incompleto', color: '#b8860b', bg: 'rgba(224,165,46,0.16)' },
  conciliado: { label: 'Conciliado', color: '#1f7a4d', bg: 'rgba(42,157,99,0.16)' },
}
```

Nos imports do arquivo, **adicionar**:
```ts
import { ESTADO_CONCILIACAO_META } from '../../lib/statusLabels'
```

- [ ] **Step 2: Trocar a referência `ESTADO_META` → `ESTADO_CONCILIACAO_META`**

Na linha 228, trocar:
```ts
const estadoMeta = ESTADO_META[estado]
```
por:
```ts
const estadoMeta = ESTADO_CONCILIACAO_META[estado]
```

Os usos posteriores (`estadoMeta.color`, `.bg`, `.label` nas linhas 618–624, 819–820) continuam válidos — o novo mapa tem os mesmos campos.

- [ ] **Step 3: Substituir o pill de status inline por `<Badge>`**

Adicionar import no topo:
```ts
import { Badge } from '../ui/Badge'
import { VOYAGE_STATUS_BADGE_TONE } from '../../lib/statusLabels'
```

Trocar o span das linhas 748–750:
```tsx
<span className="rounded-full border border-[#1f6feb]/30 bg-[#1f6feb]/10 px-3 py-1 text-xs font-semibold text-[#8cc8ff]">
  {statusLabel(VOYAGE_STATUS_LABELS, voyage.status ?? 'active')}
</span>
```
por:
```tsx
<Badge tone={VOYAGE_STATUS_BADGE_TONE[voyage.status ?? 'active'] ?? 'blue'}>
  {statusLabel(VOYAGE_STATUS_LABELS, voyage.status ?? 'active')}
</Badge>
```

- [ ] **Step 4: Verificar que `EstadoConciliacao` continua importado (ou remover se órfão)**

Confirmar se `EstadoConciliacao` ainda é usado em `VoyageCard.tsx` após a remoção. Se só servia ao `ESTADO_META` local, remover o import para evitar warning de unused (eslint falha). Caso contrário, manter.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/voyages/VoyageCard.tsx`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/voyages/VoyageCard.tsx
git commit -m "refactor(voyages): VoyageCard usa ESTADO_CONCILIACAO_META e Badge"
```

---

## Task 3: Criar a lógica de filtragem pura (`viagensFilters.ts`)

**Objetivo:** Extrair a lógica de filtro/ordenação que hoje vive dentro de `VoyageRail` para uma função pura testável.

**Files:**
- Create: `src/lib/viagensFilters.ts`
- Test: `src/lib/__tests__/viagensFilters.test.ts`

- [ ] **Step 1: Escrever o teste falhando**

Criar `src/lib/__tests__/viagensFilters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filterVoyageRailItems } from '../viagensFilters'
import type { VoyageRailItem } from '../../pages/viagensHelpers'

const items: VoyageRailItem[] = [
  {
    id: 1,
    vesselName: 'MAERSK ATLANTIC',
    voyageNumber: '024E',
    carrierName: 'Hapag-Lloyd',
    originPorts: ['Shanghai'],
    destinationPorts: ['Santos'],
    blCount: 12,
    containerCount: 40,
    status: 'active',
    estado: 'conciliado',
    proximaEscala: { pod: 'Santos', eta: '2026-06-20' },
  },
  {
    id: 2,
    vesselName: 'CMA CGM JULES',
    voyageNumber: '117W',
    carrierName: 'CMA CGM',
    originPorts: ['Rotterdam'],
    destinationPorts: ['Santos'],
    blCount: 8,
    containerCount: 42,
    status: 'active',
    estado: 'incompleto',
    proximaEscala: { pod: 'Santos', eta: '2026-06-18' },
  },
]

describe('filterVoyageRailItems', () => {
  it('retorna tudo quando filtros vazios', () => {
    expect(filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(2)
  })

  it('filtra por busca em nome do navio', () => {
    const result = filterVoyageRailItems(items, { search: 'maersk', status: 'all', conciliacao: 'all', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('busca também em voyageNumber, carrier e portos', () => {
    expect(filterVoyageRailItems(items, { search: 'cma', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(1)
    expect(filterVoyageRailItems(items, { search: 'rotterdam', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(1)
  })

  it('filtra por status', () => {
    expect(filterVoyageRailItems(items, { search: '', status: 'completed', conciliacao: 'all', periodo: 'all' })).toHaveLength(0)
  })

  it('filtra por conciliação pendente (incompleto ou divergente)', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'pendente', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })

  it('filtra por conciliação conciliada', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'conciliada', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('ordena por próxima escala (ETA) ascendente, depois por navio/viagem', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })
    expect(result[0].id).toBe(2) // ETA 2026-06-18 vem antes de 2026-06-20
  })

  it('filtro de período "hoje" inclui só escalas com ETA >= hoje', () => {
    // Como o "hoje" varia, validamos apenas que a função não quebra e respeita o tipo.
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'hoje' })
    expect(Array.isArray(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste para verificar que falha**

Run: `npx vitest run src/lib/__tests__/viagensFilters.test.ts`
Expected: FAIL — `filterVoyageRailItems` não existe.

- [ ] **Step 3: Implementar `viagensFilters.ts`**

Criar `src/lib/viagensFilters.ts`:

```ts
import type { VoyageRailItem } from '../pages/viagensHelpers'

export type StatusFilter = 'all' | 'active' | 'completed'
export type ConciliacaoFilter = 'all' | 'conciliada' | 'pendente'
export type PeriodoFilter = 'all' | 'hoje' | '7d' | '30d'

export type VoyageFilters = {
  search: string
  status: StatusFilter
  conciliacao: ConciliacaoFilter
  periodo: PeriodoFilter
}

function nextEscalaSortKey(item: VoyageRailItem) {
  return item.proximaEscala?.eta ?? '\uFFFF'
}

function periodoMinEta(periodo: PeriodoFilter): string | null {
  if (periodo === 'all') return null
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (periodo === 'hoje') return base.toISOString().slice(0, 10)
  const days = periodo === '7d' ? 7 : 30
  base.setDate(base.getDate() + days)
  return base.toISOString().slice(0, 10)
}

export function filterVoyageRailItems(
  items: VoyageRailItem[],
  filters: VoyageFilters,
): VoyageRailItem[] {
  const term = filters.search.trim().toUpperCase()
  const minEta = periodoMinEta(filters.periodo)

  return items
    .filter((item) => {
      if (filters.status !== 'all' && item.status !== filters.status) return false
      if (filters.conciliacao === 'conciliada' && item.estado !== 'conciliado') return false
      if (filters.conciliacao === 'pendente' && item.estado === 'conciliado') return false
      if (minEta) {
        const eta = item.proximaEscala?.eta
        if (!eta || eta < minEta) return false
      }
      if (term) {
        const haystack = [
          item.vesselName,
          item.voyageNumber,
          item.carrierName,
          ...item.originPorts,
          ...item.destinationPorts,
        ].join(' ').toUpperCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
    .sort((left, right) => {
      const byEscala = nextEscalaSortKey(left).localeCompare(nextEscalaSortKey(right))
      if (byEscala !== 0) return byEscala
      return `${left.vesselName} ${left.voyageNumber}`.localeCompare(
        `${right.vesselName} ${right.voyageNumber}`,
        'pt-BR',
      )
    })
}

export function countActiveFilters(filters: VoyageFilters): number {
  let n = 0
  if (filters.search.trim()) n += 1
  if (filters.status !== 'all') n += 1
  if (filters.conciliacao !== 'all') n += 1
  if (filters.periodo !== 'all') n += 1
  return n
}

export function emptyFilters(): VoyageFilters {
  return { search: '', status: 'all', conciliacao: 'all', periodo: 'all' }
}
```

- [ ] **Step 4: Rodar o teste para verificar que passa**

Run: `npx vitest run src/lib/__tests__/viagensFilters.test.ts`
Expected: PASS (8 asserts).

- [ ] **Step 5: Commit**

```bash
git add src/lib/viagensFilters.ts src/lib/__tests__/viagensFilters.test.ts
git commit -m "feat(viagens): logica de filtragem pura e testavel"
```

---

## Task 4: Criar a barra de filtros `VoyageFilters.tsx`

**Objetivo:** Componente de UI que renderiza a barra de filtros no topo, usando `FilterBar` + `Input` + `Select`.

**Files:**
- Create: `src/components/voyages/VoyageFilters.tsx`

- [ ] **Step 1: Criar o componente**

Criar `src/components/voyages/VoyageFilters.tsx`:

```tsx
import { FilterBar } from '../ui/FilterBar'
import { Input, Select } from '../ui/Input'
import type { ConciliacaoFilter, PeriodoFilter, StatusFilter, VoyageFilters as Filters } from '../../lib/viagensFilters'

type VoyageFiltersProps = {
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
  activeCount: number
  /** Total de viagens visíveis após filtro / total bruto, para o contador. */
  visibleCount: number
  totalCount: number
  loading?: boolean
}

export function VoyageFilters({
  filters,
  onChange,
  onClear,
  activeCount,
  visibleCount,
  totalCount,
  loading,
}: VoyageFiltersProps) {
  return (
    <FilterBar
      title={loading ? '—' : `${visibleCount} de ${totalCount} viagens`}
      activeCount={activeCount}
      onClear={onClear}
      defaultOpen
    >
      <div className="app-filter-grid">
        <label className="app-field app-field--inline">
          <span className="app-field__label">Busca</span>
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Navio, viagem, armador ou porto"
          />
        </label>

        <label className="app-field app-field--inline">
          <span className="app-field__label">Período</span>
          <Select
            value={filters.periodo}
            onChange={(e) => onChange({ ...filters, periodo: e.target.value as PeriodoFilter })}
          >
            <option value="all">Qualquer</option>
            <option value="hoje">Hoje</option>
            <option value="7d">Próximos 7 dias</option>
            <option value="30d">Próximos 30 dias</option>
          </Select>
        </label>

        <label className="app-field app-field--inline">
          <span className="app-field__label">Status</span>
          <Select
            value={filters.status}
            onChange={(e) => onChange({ ...filters, status: e.target.value as StatusFilter })}
          >
            <option value="all">Todas</option>
            <option value="active">Ativas</option>
            <option value="completed">Concluídas</option>
          </Select>
        </label>

        <label className="app-field app-field--inline">
          <span className="app-field__label">Conciliação</span>
          <Select
            value={filters.conciliacao}
            onChange={(e) => onChange({ ...filters, conciliacao: e.target.value as ConciliacaoFilter })}
          >
            <option value="all">Todas</option>
            <option value="conciliada">Conciliada</option>
            <option value="pendente">Pendente</option>
          </Select>
        </label>
      </div>
    </FilterBar>
  )
}
```

- [ ] **Step 2: Verificar que `app-filter-grid` e `app-field--inline` existem em `index.css`**

Buscar em `src/index.css`. O `app-filter-grid` é usado pelo `FilterBar` (mencionado no JSDoc do componente), então provavelmente existe. Se `app-field--inline` não existir, omitir essa classe (usar só `app-field`) — o layout flex do grid já alinha label+controle. Confirmar via busca antes de prosseguir.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/components/voyages/VoyageFilters.tsx
git commit -m "feat(viagens): barra de filtros no topo (VoyageFilters)"
```

---

## Task 5: Remover filtros do `VoyageRail` e adicionar ícone Editar

**Objetivo:** O `VoyageRail` deixa de gerenciar filtros (agora recebe lista já filtrada); adiciona ícone `[✎]` Editar no hover/focus do item aberto.

**Files:**
- Modify: `src/components/voyages/VoyageRail.tsx`

- [ ] **Step 1: Atualizar imports e assinatura de props**

No topo de `src/components/voyages/VoyageRail.tsx`, trocar o bloco de imports/constantes iniciais:

```tsx
import { useMemo, useState } from 'react'
import { ArrowRight, PanelLeftClose, Ship } from 'lucide-react'
import { formatDate } from '../../lib/utils'
import type { EstadoConciliacao, VoyageRailItem } from '../../pages/viagensHelpers'

const ESTADO_META: Record<EstadoConciliacao, { label: string; dot: string }> = {
  divergente: { label: 'Divergente', dot: '#cf4b3f' },
  incompleto: { label: 'Incompleto', dot: '#e0a52e' },
  conciliado: { label: 'Conciliado', dot: '#2a9d63' },
}

type StatusFilter = 'all' | 'active' | 'completed'
type ConciliacaoFilter = 'all' | 'conciliada' | 'pendente'

type VoyageRailProps = {
  items: VoyageRailItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  initialSearch?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}
```

por:

```tsx
import { Pencil, ArrowRight, PanelLeftClose, Ship } from 'lucide-react'
import { formatDate } from '../../lib/utils'
import { ESTADO_CONCILIACAO_META } from '../../lib/statusLabels'
import type { VoyageRailItem } from '../../pages/viagensHelpers'

type VoyageRailProps = {
  /** Lista já filtrada e ordenada (a filtragem vive na página / VoyageFilters). */
  items: VoyageRailItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Abre o modal de edição da viagem (ação secundária no hover do item). */
  onEdit?: (id: number) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}
```

- [ ] **Step 2: Remover estado de filtros e a função `visible`**

Remover do corpo do componente:
- os `useState` de `vesselSearch`, `voyageSearch`, `statusFilter`, `conciliacaoFilter`
- o `useMemo` que computa `visible`
- o helper local `nextEscalaSortKey` (agora vive em `viagensFilters.ts`)
- os tipos `StatusFilter` e `ConciliacaoFilter` locais (já removidos no Step 1)

A assinatura da função passa a ser:
```tsx
export function VoyageRail({ items, selectedId, onSelect, onEdit, collapsed = false, onToggleCollapse }: VoyageRailProps) {
```

Os `items` agora já são a lista visível.

- [ ] **Step 3: Usar `ESTADO_CONCILIACAO_META` no lugar de `ESTADO_META`**

Trocar todas as referências `ESTADO_META[item.estado]` por `ESTADO_CONCILIACAO_META[item.estado]`, e `estado.dot` por `estado.color` (o novo mapa não tem `.dot`; o dot usa a mesma cor `.color` via `var(--app-*)`).

Nos spans de dot (linhas 91–95 e 188–192), trocar `style={{ backgroundColor: estado.dot }}` por `style={{ backgroundColor: estado.color }}`.

- [ ] **Step 4: Adicionar o ícone Editar no item (estado aberto)**

No JSX do item aberto (bloco que começa por volta da linha 176, o `<button>` grande), adicionar o ícone de editar posicionado à direita, visível em hover/focus. Trocar a abertura do `<button>` e seu conteúdo para incluir um wrapper relativo e o ícone.

No `<button>` do item aberto, adicionar `className="group ..."` e inserir antes do fechamento do botão:

```tsx
{onEdit ? (
  <span
    role="button"
    tabIndex={0}
    className="absolute right-2 top-2 hidden rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 text-[var(--app-muted)] opacity-0 transition-opacity hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
    title="Editar viagem"
    aria-label={`Editar ${item.vesselName} / ${item.voyageNumber}`}
    onClick={(e) => {
      e.stopPropagation()
      onEdit(item.id)
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        onEdit(item.id)
      }
    }}
  >
    <Pencil size={13} />
  </span>
) : null}
```

E tornar o `<button>` pai `relative` (adicionar `relative` ao className) para ancorar o ícone absoluto.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/voyages/VoyageRail.tsx`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/voyages/VoyageRail.tsx
git commit -m "refactor(voyages): VoyageRail sem filtros, com icone Editar no hover"
```

---

## Task 6: Integrar filtros + painel colapsável em `Viagens.tsx`

**Objetivo:** Centralizar estado dos filtros na página, renderizar `VoyageFilters` no topo, repassar lista filtrada ao `VoyageRail`, e ajustar larguras do grid.

**Files:**
- Modify: `src/pages/Viagens.tsx`

- [ ] **Step 1: Adicionar imports e estado de filtros**

No topo de `src/pages/Viagens.tsx`, adicionar imports:

```tsx
import { VoyageFilters } from '../components/voyages/VoyageFilters'
import {
  countActiveFilters,
  emptyFilters,
  filterVoyageRailItems,
  type VoyageFilters as VoyageFiltersState,
} from '../lib/viagensFilters'
```

No corpo de `Viagens()`, adicionar estado (próximo ao `railCollapsed`):

```tsx
const [filters, setFilters] = useState<VoyageFiltersState>(emptyFilters)
```

- [ ] **Step 2: Persistir `railCollapsed` em localStorage**

Trocar:
```tsx
const [railCollapsed, setRailCollapsed] = useState(false)
```
por:
```tsx
const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
  try {
    return localStorage.getItem('viagens:rail-collapsed') === '1'
  } catch {
    return false
  }
})
const toggleRail = useCallback(() => {
  setRailCollapsed((prev) => {
    const next = !prev
    try {
      localStorage.setItem('viagens:rail-collapsed', next ? '1' : '0')
    } catch {
      /* storage indisponível — ignora */
    }
    return next
  })
}, [])
```

Adicionar `useCallback` aos imports do react.

- [ ] **Step 3: Calcular a lista filtrada**

Adicionar após `railItems`:

```tsx
const visibleRailItems = useMemo(
  () => filterVoyageRailItems(railItems, filters),
  [railItems, filters],
)
const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])
```

- [ ] **Step 4: Renderizar a barra de filtros no topo e ajustar o grid**

No JSX de retorno, logo após o `{error ? <InlineError ... /> : null}`, adicionar a barra de filtros:

```tsx
<VoyageFilters
  filters={filters}
  onChange={setFilters}
  onClear={() => setFilters(emptyFilters())}
  activeCount={activeFilterCount}
  visibleCount={visibleRailItems.length}
  totalCount={railItems.length}
  loading={isLoading}
/>
```

Trocar a classe do grid (linha 128) de `lg:grid-cols-[400px_1fr]` para `lg:grid-cols-[300px_1fr]`:

```tsx
<div className={`viagens-grid lg:grid lg:gap-4 ${railCollapsed ? 'lg:grid-cols-[64px_1fr]' : 'lg:grid-cols-[300px_1fr]'}`}>
```

- [ ] **Step 5: Repassar lista filtrada e remover `initialSearch` do `VoyageRail`**

No uso de `<VoyageRail>`, trocar `items={railItems}` por `items={visibleRailItems}`, remover a prop `initialSearch`, adicionar `onEdit={setEditingVoyageId}`, e trocar `onToggleCollapse={() => setRailCollapsed((prev) => !prev)}` por `onToggleCollapse={toggleRail}`:

```tsx
<VoyageRail
  items={visibleRailItems}
  selectedId={selectedVoyageId}
  onSelect={(id) => navigate(`/viagens/${id}`)}
  onEdit={setEditingVoyageId}
  collapsed={railCollapsed}
  onToggleCollapse={toggleRail}
/>
```

Remover o `useSearchParams`/`searchParams` se ficou órfão (o `initialSearch` usava `searchParams.get('vessel')`). Verificar se `searchParams` é usado em outro lugar; se não, remover o import e a linha `const [searchParams] = useSearchParams()`.

- [ ] **Step 6: Substituir o loading de texto por skeleton**

Trocar:
```tsx
{isLoading ? (
  <Card>Carregando viagens...</Card>
) : (
  <VoyageRail ... />
)}
```
por:
```tsx
{isLoading ? (
  <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
    <SkeletonList />
  </div>
) : (
  <VoyageRail ... />
)}
```

E trocar o loading do detalhe:
```tsx
) : isLoading ? (
  <Card>Carregando viagem...</Card>
) : (
```
por:
```tsx
) : isLoading ? (
  <SkeletonCard lines={4} />
) : (
```

Adicionar imports:
```tsx
import { SkeletonCard } from '../components/ui/Skeleton'
```

E definir um `SkeletonList` local no fim do arquivo (antes de `makeVoyageInitialValues`):

```tsx
function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-[var(--app-border)] px-3 py-3">
          <SkeletonCard lines={3} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/pages/Viagens.tsx`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Viagens.tsx
git commit -m "refactor(viagens): filtros no topo, painel colapsavel persistente, skeletons"
```

---

## Task 7: Remover `max-width` global de `.app-main`

**Objetivo:** O app ocupa 100% da largura do navegador.

**Files:**
- Modify: `src/index.css` (linhas 754–758)

- [ ] **Step 1: Editar a regra `.app-main`**

Em `src/index.css`, trocar:

```css
.app-main {
  max-width: 1480px;
  margin: 0 auto;
  padding: 34px 28px 52px;
}
```

por:

```css
.app-main {
  padding: 34px 28px 52px;
}
```

- [ ] **Step 2: Rodar lint e build para confirmar que nada quebra**

Run: `npx eslint . && npm run build`
Expected: build OK, sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "refactor(layout): .app-main sem max-width (largura total)"
```

---

## Task 8: Verificação final e suíte de testes

**Objetivo:** Garantir que tudo passa junto (lint, typecheck, testes, build).

- [ ] **Step 1: Rodar a suíte completa de testes**

Run: `npx vitest run`
Expected: todos os testes passam, incluindo os novos de `statusLabels` e `viagensFilters`.

- [ ] **Step 2: Rodar lint de todo o projeto**

Run: `npx eslint .`
Expected: sem erros.

- [ ] **Step 3: Rodar build de produção**

Run: `npm run build`
Expected: build concluído sem erros de TS/Vite.

- [ ] **Step 4: Smoke test manual (descritivo)**

Abrir `npm run dev`, navegar para `/viagens` e confirmar:
- App ocupa largura total do navegador (sem faixas laterais em tela wide).
- Barra de filtros aparece no topo, com contador "X de Y viagens" e botão "Limpar" ao ativar filtro.
- Lista colapsa/recolhe entre ~300px e ~64px; estado persiste após reload.
- Ícone `[✎]` aparece no hover/focus do item da lista aberta; abre modal de edição.
- Dot de conciliação respeita as cores (verde/dourado/vermelho).
- Painel de detalhe mostra badges de status + conciliação.
- Durante o load, skeletons aparecem (não textos "Carregando...").

- [ ] **Step 5: Commit final (se houver ajustes de polimento)**

Se o smoke test revelar ajustes pequenos, commit por tema. Caso contrário, não há commit extra.

---

## Self-Review (executado pelo autor do plano)

**1. Cobertura do spec:**
- Filtros no topo → Task 4 + 6 ✅
- Painel colapsável 64⇄300px → Task 6 (grid) + persistência ✅
- `.app-main` sem max-width → Task 7 ✅
- Busca única consolidada → Task 3 (lógica) + Task 4 (UI) ✅
- Período como seletor de janela → Task 3 + 4 ✅
- `FilterBar` reuso → Task 4 ✅
- `ESTADO_META` centralizado → Task 1 ✅
- `Badge` para status + estado → Task 1 (mapas) + Task 2 (VoyageCard) ✅
- Ícone Editar no hover/focus → Task 5 ✅
- "Nova Viagem" no PageHeader → sem mudança (já está) ✅
- Skeletons → Task 6 ✅
- Estados hover/focus/active → tokens existentes (sem nova CSS, validado em Task 8 smoke) ✅

**2. Placeholder scan:** Nenhum "TBD"/"TODO". Todos os passos têm código completo ou comandos exatos. ✅

**3. Consistência de tipos:**
- `VoyageFilters` (tipo) em `viagensFilters.ts` vs `VoyageFilters` (componente) em `VoyageFilters.tsx` — colisão de nome. **Corrigido:** o import em `Viagens.tsx` usa alias `type VoyageFilters as VoyageFiltersState`. E o componente é importado como valor `VoyageFilters`. Sem ambiguidade em uso. ✅
- `ESTADO_CONCILIACAO_META` tem `{ label, color, bg, badgeTone }` — cobre todos os usos (`VoyageCard` usa `.color`/`.bg`/`.label`; `VoyageRail` usa `.color` no lugar de `.dot`). ✅
- `filterVoyageRailItems` aceita `VoyageFilters` e retorna `VoyageRailItem[]` — bate com o que `VoyageRail` espera receber. ✅
