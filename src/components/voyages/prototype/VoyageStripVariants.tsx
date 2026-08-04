// PROTÓTIPO — descartável. Pergunta: substituir a barra lateral expansível de
// Viagens por uma faixa horizontal rolável acima do painel de detalhe.
// Três variantes na própria rota /viagens, alternadas por `?variant=`.
//
// A — Faixa de cards: o MESMO card do rail, deitado numa esteira horizontal.
// B — Trilho compacto: chips de uma linha; só o selecionado abre em card.
// C — Linha do tempo: cards agrupados por janela da próxima escala.
//
// Sem testes, sem tratamento de erro, sem abstração compartilhada de layout:
// cada variante é livre para jogar fora a estrutura da anterior.
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { formatDate } from '../../../lib/utils'
import { ESTADO_CONCILIACAO_META } from '../../../lib/statusLabels'
import type { VoyageRailItem } from '../../../services/voyageSummaries'

export type VoyageStripProps = {
  items: VoyageRailItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  onEdit?: (id: number) => void
}

/** Rolagem horizontal com setas nas pontas, escondidas quando não há para onde ir. */
function useHorizontalScroller() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  // Só troca o estado quando as bordas realmente mudam — o efeito abaixo roda
  // a cada render (precisa medir depois do layout) e um objeto novo por
  // chamada entraria em loop.
  function sync() {
    const el = ref.current
    if (!el) return
    const next = {
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    }
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next))
  }

  useEffect(() => {
    sync()
    const onResize = () => sync()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  function scrollBy(direction: -1 | 1) {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(280, el.clientWidth * 0.8), behavior: 'smooth' })
  }

  return { ref, edges, sync, scrollBy }
}

function ScrollArrow({
  side,
  onClick,
  visible,
}: {
  side: 'left' | 'right'
  onClick: () => void
  visible: boolean
}) {
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Rolar para a esquerda' : 'Rolar para a direita'}
      className={`absolute top-1/2 z-20 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] shadow-lg transition-colors hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)] lg:flex ${
        side === 'left' ? 'left-1' : 'right-1'
      }`}
    >
      {side === 'left' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
  )
}

function StripPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-muted)]">
      {children}
    </span>
  )
}

function EmptyStrip() {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-5 text-sm text-[var(--app-muted)]">
      Nenhuma viagem para os filtros atuais.
    </div>
  )
}

// ---------------------------------------------------------------------------
// A — Faixa de cards
// O card do rail, sem alteração de conteúdo, deitado numa esteira horizontal.
// Cards de largura fixa com scroll-snap; a faixa é sticky no topo do conteúdo.
// ---------------------------------------------------------------------------
export function VariantA({ items, selectedId, onSelect, onEdit }: VoyageStripProps) {
  const { ref, edges, sync, scrollBy } = useHorizontalScroller()

  if (items.length === 0) return <EmptyStrip />

  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] text-[var(--app-muted-soft)]">Ordenado por próxima escala</span>
        <span className="text-[11px] text-[var(--app-muted-soft)]">{items.length} viagens</span>
      </div>

      <ScrollArrow side="left" visible={edges.left} onClick={() => scrollBy(-1)} />
      <ScrollArrow side="right" visible={edges.right} onClick={() => scrollBy(1)} />

      <div
        ref={ref}
        onScroll={sync}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {items.map((item) => {
          const estado = ESTADO_CONCILIACAO_META[item.estado]
          const isSelected = item.id === selectedId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isSelected}
              className={`group relative w-[268px] flex-none snap-start rounded-2xl border border-t-[3px] px-3 py-3 text-left transition-colors ${
                isSelected
                  ? 'border-[var(--app-blue-btn)] border-t-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)]'
                  : 'border-[var(--app-border)] border-t-transparent bg-[var(--app-surface)] hover:bg-[var(--app-surface-muted)]'
              }`}
            >
              {onEdit ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="absolute right-2 top-2 hidden rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 text-[var(--app-muted)] group-hover:block group-focus-within:block"
                  title="Editar viagem"
                  aria-label={`Editar ${item.vesselName} / ${item.voyageNumber}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onEdit(item.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      onEdit(item.id)
                    }
                  }}
                >
                  <Pencil size={13} />
                </span>
              ) : null}

              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: estado.color }}
                  title={`Conciliação: ${estado.label}`}
                />
                <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted-soft)]">
                  {item.carrierName || 'Armador não informado'}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-[var(--app-text-strong)]">
                {item.vesselName} / {item.voyageNumber}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--app-muted)]">
                <span className="truncate">{item.originPorts.join('·') || '—'}</span>
                <ArrowRight size={12} className="flex-none text-[var(--app-muted-soft)]" />
                <span className="truncate">{item.destinationPorts.join('·') || '—'}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StripPill>{item.blCount} B/Ls</StripPill>
                <StripPill>{item.containerCount} CNTR</StripPill>
                {item.proximaEscala ? (
                  <StripPill>
                    {item.proximaEscala.pod} · {formatDate(item.proximaEscala.eta)}
                  </StripPill>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// B — Trilho compacto
// Uma linha por viagem, altura de chip: cabem ~3x mais viagens na mesma
// largura. O selecionado é o único que abre, com as métricas do card.
// ---------------------------------------------------------------------------
export function VariantB({ items, selectedId, onSelect, onEdit }: VoyageStripProps) {
  const { ref, edges, sync, scrollBy } = useHorizontalScroller()

  if (items.length === 0) return <EmptyStrip />

  return (
    <div className="relative rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2">
      <ScrollArrow side="left" visible={edges.left} onClick={() => scrollBy(-1)} />
      <ScrollArrow side="right" visible={edges.right} onClick={() => scrollBy(1)} />

      <div ref={ref} onScroll={sync} className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const estado = ESTADO_CONCILIACAO_META[item.estado]
          const isSelected = item.id === selectedId

          if (!isSelected) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                title={`${item.vesselName} / ${item.voyageNumber} — ${item.carrierName || 'Armador não informado'}`}
                className="flex h-11 flex-none items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 text-left transition-colors hover:border-[var(--app-blue-btn)] hover:bg-[var(--app-bg-elevated)]"
              >
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: estado.color }}
                  title={`Conciliação: ${estado.label}`}
                />
                <span className="max-w-[170px] truncate text-xs font-bold text-[var(--app-text-strong)]">
                  {item.vesselName} / {item.voyageNumber}
                </span>
                {item.proximaEscala ? (
                  <span className="flex-none text-[11px] text-[var(--app-muted)]">
                    {item.proximaEscala.pod} · {formatDate(item.proximaEscala.eta)}
                  </span>
                ) : null}
              </button>
            )
          }

          return (
            <div
              key={item.id}
              className="group relative flex min-w-[320px] flex-none flex-col justify-center rounded-2xl border-2 border-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)] px-3 py-2"
            >
              {onEdit ? (
                <button
                  type="button"
                  className="absolute right-2 top-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 text-[var(--app-muted)]"
                  title="Editar viagem"
                  aria-label={`Editar ${item.vesselName} / ${item.voyageNumber}`}
                  onClick={() => onEdit(item.id)}
                >
                  <Pencil size={13} />
                </button>
              ) : null}
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: estado.color }} />
                <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted-soft)]">
                  {item.carrierName || 'Armador não informado'}
                </span>
              </div>
              <div className="truncate text-sm font-bold text-[var(--app-text-strong)]">
                {item.vesselName} / {item.voyageNumber}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--app-muted)]">
                <span className="truncate">{item.originPorts.join('·') || '—'}</span>
                <ArrowRight size={12} className="flex-none text-[var(--app-muted-soft)]" />
                <span className="truncate">{item.destinationPorts.join('·') || '—'}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <StripPill>{item.blCount} B/Ls</StripPill>
                <StripPill>{item.containerCount} CNTR</StripPill>
                {item.proximaEscala ? (
                  <StripPill>
                    {item.proximaEscala.pod} · {formatDate(item.proximaEscala.eta)}
                  </StripPill>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// C — Linha do tempo
// A faixa vira eixo temporal: as viagens ficam agrupadas pela janela da
// próxima escala, com marcador na trilha. A data é o dado primário.
// ---------------------------------------------------------------------------
type TimelineBucket = { key: string; label: string; items: VoyageRailItem[] }

function bucketByEscala(items: VoyageRailItem[]): TimelineBucket[] {
  const buckets: TimelineBucket[] = [
    { key: 'atrasado', label: 'Atrasado', items: [] },
    { key: 'semana', label: 'Próximos 7 dias', items: [] },
    { key: 'quinzena', label: '8 a 30 dias', items: [] },
    { key: 'depois', label: 'Depois', items: [] },
    { key: 'sem-escala', label: 'Sem escala prevista', items: [] },
  ]
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  const hoje = Date.now()

  for (const item of items) {
    if (!item.proximaEscala?.eta) {
      byKey.get('sem-escala')!.items.push(item)
      continue
    }
    const dias = Math.floor((new Date(item.proximaEscala.eta).getTime() - hoje) / 86_400_000)
    const key = dias < 0 ? 'atrasado' : dias <= 7 ? 'semana' : dias <= 30 ? 'quinzena' : 'depois'
    byKey.get(key)!.items.push(item)
  }

  return buckets.filter((bucket) => bucket.items.length > 0)
}

export function VariantC({ items, selectedId, onSelect, onEdit }: VoyageStripProps) {
  const { ref, edges, sync, scrollBy } = useHorizontalScroller()

  if (items.length === 0) return <EmptyStrip />

  const buckets = bucketByEscala(items)

  return (
    <div className="relative">
      <ScrollArrow side="left" visible={edges.left} onClick={() => scrollBy(-1)} />
      <ScrollArrow side="right" visible={edges.right} onClick={() => scrollBy(1)} />

      <div ref={ref} onScroll={sync} className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-stretch gap-6">
          {buckets.map((bucket) => (
            <div key={bucket.key} className="flex flex-col">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted-soft)]">
                  {bucket.label}
                </span>
                <span className="rounded-full bg-[var(--app-surface-muted)] px-1.5 text-[10px] font-semibold text-[var(--app-muted)]">
                  {bucket.items.length}
                </span>
                <span className="h-px flex-1 bg-[var(--app-border)]" />
              </div>

              <div className="flex gap-2 border-t border-dashed border-[var(--app-border)] pt-3">
                {bucket.items.map((item) => {
                  const estado = ESTADO_CONCILIACAO_META[item.estado]
                  const isSelected = item.id === selectedId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-current={isSelected}
                      className={`relative w-[196px] flex-none rounded-xl border px-3 pb-2 pt-3 text-left transition-colors ${
                        isSelected
                          ? 'border-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)] shadow-lg'
                          : 'border-[var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-muted)]'
                      }`}
                    >
                      {/* Marcador na trilha tracejada acima do card. */}
                      <span
                        className="absolute -top-[7px] left-4 h-3 w-3 rounded-full border-2 border-[var(--app-bg)]"
                        style={{ backgroundColor: estado.color }}
                        title={`Conciliação: ${estado.label}`}
                      />
                      <div className="text-base font-bold leading-none text-[var(--app-text-strong)]">
                        {item.proximaEscala ? formatDate(item.proximaEscala.eta) : '—'}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                        {item.proximaEscala?.pod ?? 'sem escala'}
                      </div>
                      <div className="mt-2 truncate text-xs font-bold text-[var(--app-text-strong)]">
                        {item.vesselName} / {item.voyageNumber}
                      </div>
                      <div className="truncate text-[10px] uppercase tracking-wider text-[var(--app-muted-soft)]">
                        {item.carrierName || 'Armador não informado'}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-[var(--app-muted)]">
                          {item.blCount} B/Ls · {item.containerCount} CNTR
                        </span>
                        {onEdit ? (
                          <span
                            role="button"
                            tabIndex={0}
                            className="rounded-md p-0.5 text-[var(--app-muted-soft)] hover:text-[var(--app-text)]"
                            title="Editar viagem"
                            aria-label={`Editar ${item.vesselName} / ${item.voyageNumber}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              onEdit(item.id)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                event.stopPropagation()
                                onEdit(item.id)
                              }
                            }}
                          >
                            <Pencil size={12} />
                          </span>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
