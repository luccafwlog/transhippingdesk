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

function nextEscalaSortKey(item: VoyageRailItem) {
  return item.proximaEscala?.eta ?? '\uFFFF'
}

export function VoyageRail({ items, selectedId, onSelect, initialSearch = '', collapsed = false, onToggleCollapse }: VoyageRailProps) {
  const [vesselSearch, setVesselSearch] = useState('')
  const [voyageSearch, setVoyageSearch] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [conciliacaoFilter, setConciliacaoFilter] = useState<ConciliacaoFilter>('all')

  const visible = useMemo(() => {
    const vesselTerm = vesselSearch.trim().toUpperCase()
    const voyageTerm = voyageSearch.trim().toUpperCase()
    return items
      .filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false
        if (conciliacaoFilter === 'conciliada' && item.estado !== 'conciliado') return false
        if (conciliacaoFilter === 'pendente' && item.estado === 'conciliado') return false
        if (vesselTerm && !item.vesselName.toUpperCase().includes(vesselTerm)) return false
        if (voyageTerm) {
          const haystack = [item.voyageNumber, item.carrierName, ...item.originPorts, ...item.destinationPorts].join(' ').toUpperCase()
          if (!haystack.includes(voyageTerm)) return false
        }
        return true
      })
      .sort((left, right) => {
        const byEscala = nextEscalaSortKey(left).localeCompare(nextEscalaSortKey(right))
        if (byEscala !== 0) return byEscala
        return `${left.vesselName} ${left.voyageNumber}`.localeCompare(`${right.vesselName} ${right.voyageNumber}`, 'pt-BR')
      })
  }, [items, vesselSearch, voyageSearch, statusFilter, conciliacaoFilter])

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
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              value={vesselSearch}
              onChange={(e) => setVesselSearch(e.target.value)}
              placeholder="Navio"
              className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-sm text-[var(--app-text)] placeholder:text-[var(--app-muted-soft)] focus:border-[var(--app-border-strong)] focus:outline-none"
            />
          </div>
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

        <input
          value={voyageSearch}
          onChange={(e) => setVoyageSearch(e.target.value)}
          placeholder="Viagem, armador ou porto"
          className="mt-2 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-sm text-[var(--app-text)] placeholder:text-[var(--app-muted-soft)] focus:border-[var(--app-border-strong)] focus:outline-none"
        />

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted-soft)]">Status</span>
            <div className="flex gap-1">
              {([
                ['all', 'Todas'],
                ['active', 'Ativas'],
                ['completed', 'Concluídas'],
              ] as Array<[StatusFilter, string]>).map(([value, label]) => (
                <RailChip key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>
                  {label}
                </RailChip>
              ))}
            </div>
          </div>
          <div className="grid gap-1">
            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted-soft)]">Conciliação</span>
            <div className="flex gap-1">
              {([
                ['all', 'Todas'],
                ['conciliada', 'Conciliada'],
                ['pendente', 'Pendente'],
              ] as Array<[ConciliacaoFilter, string]>).map(([value, label]) => (
                <RailChip key={value} active={conciliacaoFilter === value} onClick={() => setConciliacaoFilter(value)}>
                  {label}
                </RailChip>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--app-muted-soft)]">
          <span>{visible.length} de {items.length} viagens</span>
          <span>Ordenado por próxima escala</span>
        </div>
      </div>

      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
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
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-all ${
        active
          ? 'border-[var(--app-blue-btn)] bg-[var(--app-blue-btn)] text-white shadow-sm'
          : 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface-muted)]'
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
