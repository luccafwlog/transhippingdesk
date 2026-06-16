import { useMemo, useState } from 'react'
import { ArrowRight, Search, Ship } from 'lucide-react'
import { formatDate } from '../../lib/utils'
import type { EstadoConciliacao, VoyageRailItem } from '../../pages/viagensHelpers'

const ESTADO_META: Record<EstadoConciliacao, { label: string; dot: string }> = {
  divergente: { label: 'Divergente', dot: '#cf4b3f' },
  incompleto: { label: 'Incompleto', dot: '#e0a52e' },
  conciliado: { label: 'Conciliado', dot: '#2a9d63' },
}

type StatusFilter = 'active' | 'completed' | 'all'
type EstadoFilter = 'all' | 'incompleto' | 'conciliado'

type VoyageRailProps = {
  items: VoyageRailItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  initialSearch?: string
  collapsed?: boolean
}

function nextEscalaSortKey(item: VoyageRailItem) {
  // Itens com próxima escala vêm primeiro, ordenados por ETA; os demais ao fim.
  return item.proximaEscala?.eta ?? '￿'
}

export function VoyageRail({ items, selectedId, onSelect, initialSearch = '', collapsed = false }: VoyageRailProps) {
  const [search, setSearch] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('all')

  const visible = useMemo(() => {
    const term = search.trim().toUpperCase()
    return items
      .filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false
        if (estadoFilter !== 'all' && item.estado !== estadoFilter) return false
        if (!term) return true
        const haystack = [
          item.vesselName,
          item.voyageNumber,
          item.carrierName,
          ...item.originPorts,
          ...item.destinationPorts,
        ]
          .join(' ')
          .toUpperCase()
        return haystack.includes(term)
      })
      .sort((left, right) => {
        const byEscala = nextEscalaSortKey(left).localeCompare(nextEscalaSortKey(right))
        if (byEscala !== 0) return byEscala
        return `${left.vesselName} ${left.voyageNumber}`.localeCompare(`${right.vesselName} ${right.voyageNumber}`, 'pt-BR')
      })
  }, [items, search, statusFilter, estadoFilter])

  if (collapsed) {
    return (
      <aside className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] lg:sticky lg:top-4">
        <div className="border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] p-2">
          <div className="flex items-center justify-center">
            <Ship size={18} className="text-[var(--app-muted)]" />
          </div>
        </div>
        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
          {visible.length === 0 ? (
            <div className="px-2 py-4 text-center text-[10px] text-[var(--app-muted)]">Nenhuma viagem.</div>
          ) : (
            visible.map((item) => {
              const estado = ESTADO_META[item.estado]
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
                    style={{ backgroundColor: estado.dot }}
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
      <div className="border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted-soft)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar navio, viagem, armador ou porto"
            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] py-2 pl-9 pr-3 text-sm text-[var(--app-text)] placeholder:text-[var(--app-muted-soft)] focus:border-[var(--app-border-strong)] focus:outline-none"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {([
            ['active', 'Ativas'],
            ['completed', 'Concluídas'],
            ['all', 'Todas'],
          ] as Array<[StatusFilter, string]>).map(([value, label]) => (
            <RailChip key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>
              {label}
            </RailChip>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {([
            ['all', 'Conciliação: todas'],
            ['incompleto', 'Incompleto'],
            ['conciliado', 'Conciliado'],
          ] as Array<[EstadoFilter, string]>).map(([value, label]) => (
            <RailChip key={value} active={estadoFilter === value} onClick={() => setEstadoFilter(value)}>
              {label}
            </RailChip>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-[var(--app-muted-soft)]">
          <span>{visible.length} de {items.length} viagens</span>
          <span>Ordenado por próxima escala</span>
        </div>
      </div>

      <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--app-muted)]">Nenhuma viagem para os filtros atuais.</div>
        ) : (
          visible.map((item) => {
            const estado = ESTADO_META[item.estado]
            const isSelected = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isSelected}
                className={`block w-full border-b border-l-[3px] border-[var(--app-border)] px-3 py-3 text-left transition-colors ${
                  isSelected
                    ? 'border-l-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)]'
                    : 'border-l-transparent hover:bg-[var(--app-surface-muted)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: estado.dot }}
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

function RailChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-[#c5d8f2] bg-[#eef4fb] text-[var(--app-blue-btn)]'
          : 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] hover:border-[var(--app-border-strong)]'
      }`}
    >
      {children}
    </button>
  )
}

function RailPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-muted)]">
      {children}
    </span>
  )
}
