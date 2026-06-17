import { ArrowRight, PanelLeftClose, Pencil, Ship } from 'lucide-react'
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

export function VoyageRail({ items, selectedId, onSelect, onEdit, collapsed = false, onToggleCollapse }: VoyageRailProps) {
  if (collapsed) {
    return (
      <aside className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] lg:sticky lg:top-4">
        <div className="border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex w-full items-center justify-center rounded-lg p-1.5 text-[var(--app-muted)] transition-colors hover:bg-[var(--app-surface)] hover:text-[var(--app-text)]"
            aria-label="Expandir barra lateral"
            title="Expandir barra lateral"
          >
            <Ship size={18} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-2 py-4 text-center text-[10px] text-[var(--app-muted)]">Nenhuma viagem.</div>
          ) : (
            items.map((item) => {
              const estado = ESTADO_CONCILIACAO_META[item.estado]
              const isSelected = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={isSelected}
                  aria-label={`${item.vesselName} / ${item.voyageNumber}`}
                  title={`${item.vesselName} / ${item.voyageNumber} - ${item.carrierName}`}
                  className={`flex w-full items-center justify-center border-b border-l-[3px] border-[var(--app-border)] px-2 py-3 transition-colors ${
                    isSelected
                      ? 'border-l-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)]'
                      : 'border-l-transparent hover:bg-[var(--app-surface-muted)]'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ backgroundColor: estado.color }}
                    title={`${item.vesselName} / ${item.voyageNumber} - ${estado.label}`}
                  />
                </button>
              )
            })
          )}
        </div>
      </aside>
    )
  }

  return (
    <aside className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] lg:sticky lg:top-4">
      <div className="flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
        <span className="text-[11px] text-[var(--app-muted-soft)]">Ordenado por próxima escala</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] transition-colors hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)]"
          aria-label="Recolher barra lateral"
          title="Recolher barra lateral"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--app-muted)]">Nenhuma viagem para os filtros atuais.</div>
        ) : (
          items.map((item) => {
            const estado = ESTADO_CONCILIACAO_META[item.estado]
            const isSelected = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isSelected}
                className={`group relative block w-full border-b border-l-[3px] border-[var(--app-border)] px-3 py-3 text-left transition-colors ${
                  isSelected
                    ? 'border-l-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)]'
                    : 'border-l-transparent hover:bg-[var(--app-surface-muted)]'
                }`}
              >
                {onEdit ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="absolute right-2 top-2 hidden rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 text-[var(--app-muted)] opacity-0 transition-opacity hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)] focus-visible:opacity-100 group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100"
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
                  <RailPill>{item.blCount} B/Ls</RailPill>
                  <RailPill>{item.containerCount} CNTR</RailPill>
                  {item.proximaEscala ? (
                    <RailPill>
                      {item.proximaEscala.pod} · {formatDate(item.proximaEscala.eta)}
                    </RailPill>
                  ) : null}
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

function RailPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-muted)]">
      {children}
    </span>
  )
}
