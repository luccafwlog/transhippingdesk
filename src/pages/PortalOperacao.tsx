import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { formatDate } from '../lib/utils'
import { downloadCsv } from '../lib/csv'
import type { PortalOperationBL, PortalOperationContainerStatus } from '../services/portalOperation'

type SortKey = 'bl_id' | 'vessel' | 'pod' | 'containers' | 'demurrage'
type SortDir = 'asc' | 'desc'
type StatusFilter = '' | 'com_demurrage' | 'todos_devolvidos' | 'com_pendentes'

type SortKey = 'bl_id' | 'vessel' | 'pod' | 'containers' | 'demurrage'
type SortDir = 'asc' | 'desc'
type StatusFilter = '' | 'com_demurrage' | 'todos_devolvidos' | 'com_pendentes'

const PAGE_SIZES = [10, 25, 50, 100]

const STATUS_GROUPS: Record<string, string[]> = {
  com_demurrage: ['em_demurrage'],
  todos_devolvidos: ['devolvido'],
  com_pendentes: ['sem_descarga', 'dentro_free_time', 'em_demurrage'],
}

function blStatusMatches(containers: PortalOperationBL['containers'], filter: StatusFilter): boolean {
  if (!filter) return true
  const statuses = STATUS_GROUPS[filter]
  return containers.some((c) => statuses.includes(c.status))
}

export function PortalOperacao() {
  const { data, isLoading, error } = usePortalOperationBls()
  const rows = useMemo(() => data ?? [], [data])

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [vesselFilter, setVesselFilter] = useState('')
  const [searchBl, setSearchBl] = useState('')

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('bl_id')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Pagination
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // Accordion
  const [openBl, setOpenBl] = useState<string | null>(null)

  const vesselOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => [r.vessel_name, r.voyage_number].filter(Boolean).join(' / ')))).sort(),
    [rows],
  )

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <span className="ml-1 text-[var(--app-muted)]">↕</span>
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const filtered = useMemo(() => {
    let result = [...rows]

    if (statusFilter) {
      result = result.filter((r) => blStatusMatches(r.containers, statusFilter))
    }

    if (vesselFilter) {
      const term = vesselFilter.toLowerCase()
      result = result.filter(
        (r) => (r.vessel_name ?? '').toLowerCase().includes(term) || (r.voyage_number ?? '').toLowerCase().includes(term),
      )
    }

    if (searchBl) {
      const term = searchBl.toLowerCase()
      result = result.filter((r) => r.bl_id.toLowerCase().includes(term))
    }

    result.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'bl_id': cmp = a.bl_id.localeCompare(b.bl_id); break
        case 'vessel': cmp = (a.vessel_name ?? '').localeCompare(b.vessel_name ?? ''); break
        case 'pod': cmp = (a.pod ?? '').localeCompare(b.pod ?? ''); break
        case 'containers': cmp = a.container_count - b.container_count; break
        case 'demurrage': cmp = a.containers_in_demurrage - b.containers_in_demurrage; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [rows, statusFilter, vesselFilter, searchBl, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const totals = useMemo(
    () => ({
      bls: rows.length,
      containers: rows.reduce((sum, r) => sum + r.container_count, 0),
      demurrage: rows.reduce((sum, r) => sum + r.containers_in_demurrage, 0),
    }),
    [rows],
  )

  function handleExportCsv() {
    const headers = ['BL', 'CE Mercante', 'Navio', 'Viagem', 'POL', 'POD', 'Containers', 'Devolvidos', 'Em Demurrage']
    const dataRows = filtered.map((r) => [
      r.bl_id,
      r.ce_mercante ?? '',
      r.vessel_name ?? '',
      r.voyage_number ?? '',
      r.pol ?? '',
      r.pod ?? '',
      String(r.container_count),
      String(r.containers_returned),
      String(r.containers_in_demurrage),
    ])
    downloadCsv(`operacao-${new Date().toISOString().slice(0, 10)}.csv`, headers, dataRows)
  }

  const activeFilters = [statusFilter, vesselFilter, searchBl].filter(Boolean).length

  return (
    <>
      <PageHeader
        title="Operacao"
        description="Acompanhe CE Mercante, descarga, devolucao e dias de uso dos containers."
        action={
          <Button variant="secondary" onClick={handleExportCsv} disabled={filtered.length === 0}>
            <Download size={16} />
            Exportar CSV
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="B/Ls" value={String(totals.bls)} />
        <MetricCard label="Containers" value={String(totals.containers)} />
        <MetricCard label="Em demurrage" value={String(totals.demurrage)} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-[var(--app-border)] px-5 py-4">
          <h2 className="text-base font-semibold">B/Ls e containers</h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{filtered.length} B/L(s) encontrado(s)</p>
        </div>

        <div className="px-5 pt-4">
          <FilterBar activeCount={activeFilters} onClear={() => { setStatusFilter(''); setVesselFilter(''); setSearchBl(''); setPage(0) }}>
            <div className="app-filter-grid">
              <Field label="Status">
                <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(0) }}>
                  <option value="">Todos</option>
                  <option value="com_demurrage">Com demurrage</option>
                  <option value="todos_devolvidos">Devolvidos</option>
                  <option value="com_pendentes">Pendentes</option>
                </Select>
              </Field>
              <Field label="Navio/Viagem">
                <Input
                  list="op-vessel-list"
                  value={vesselFilter}
                  onChange={(e) => { setVesselFilter(e.target.value); setPage(0) }}
                  placeholder="Filtrar por navio"
                />
                <datalist id="op-vessel-list">
                  {vesselOptions.map((v) => <option key={v} value={v} />)}
                </datalist>
              </Field>
              <Field label="Buscar B/L">
                <Input
                  value={searchBl}
                  onChange={(e) => { setSearchBl(e.target.value); setPage(0) }}
                  placeholder="Numero do BL"
                />
              </Field>
              <Field label="Por pagina">
                <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}>
                  {PAGE_SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
                </Select>
              </Field>
            </div>
          </FilterBar>
        </div>

        {isLoading ? <EmptyState title="Carregando..." description="Buscando dados operacionais." /> : null}
        {error ? <div className="px-5 py-4"><InlineError message="Falha ao carregar dados operacionais do portal." /></div> : null}
        {!isLoading && !error && filtered.length === 0 ? (
          <EmptyState title="Sem B/Ls" description="Nenhum BL encontrado para os filtros atuais." />
        ) : null}

        {!isLoading && !error && filtered.length > 0 ? (
          <>
            <div className="hidden app-table-scroll md:block">
              <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
                <thead>
                  <tr>
                    <Th sortable column="bl_id" onClick={handleSort} icon={<SortIcon column="bl_id" />}>B/L</Th>
                    <Th>CE Mercante</Th>
                    <Th sortable column="vessel" onClick={handleSort} icon={<SortIcon column="vessel" />}>Navio/Viagem</Th>
                    <Th sortable column="pod" onClick={handleSort} icon={<SortIcon column="pod" />}>POD</Th>
                    <Th sortable column="containers" onClick={handleSort} icon={<SortIcon column="containers" />}>Ctr</Th>
                    <Th>Devolvidos</Th>
                    <Th sortable column="demurrage" onClick={handleSort} icon={<SortIcon column="demurrage" />}>Demurrage</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row) => {
                    const isOpen = openBl === row.bl_id
                    return (
                      <Fragment key={row.bl_id}>
                        <tr className={`cursor-pointer ${isOpen ? 'bg-[var(--app-surface-hover)]' : ''}`} onClick={() => setOpenBl(isOpen ? null : row.bl_id)}>
                          <td className="px-4 py-3 font-semibold">{row.bl_id}</td>
                          <td className="px-4 py-3">{row.ce_mercante ? <Badge tone="blue">CE {row.ce_mercante}</Badge> : <Badge>Sem CE</Badge>}</td>
                          <td className="px-4 py-3">{[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || '-'}</td>
                          <td className="px-4 py-3">{row.pod ?? '-'}</td>
                          <td className="px-4 py-3">{row.container_count}</td>
                          <td className="px-4 py-3">{row.containers_returned}</td>
                          <td className="px-4 py-3">{row.containers_in_demurrage > 0 ? <Badge tone="red">{row.containers_in_demurrage}</Badge> : '0'}</td>
                          <td className="px-4 py-3">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                        </tr>
                        {isOpen ? (
                          <tr key={`${row.bl_id}-details`}>
                            <td colSpan={8} className="p-0">
                              <ContainerDetails row={row} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-4 md:hidden">
              {paginated.map((row) => (
                <button
                  key={row.bl_id}
                  type="button"
                  onClick={() => setOpenBl(openBl === row.bl_id ? null : row.bl_id)}
                  className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{row.bl_id}</span>
                    {row.ce_mercante ? <Badge tone="blue">CE {row.ce_mercante}</Badge> : null}
                    {row.containers_in_demurrage > 0 ? <Badge tone="red">{row.containers_in_demurrage} demurrage</Badge> : null}
                  </div>
                  <div className="mt-1 text-sm text-[var(--app-muted)]">
                    {[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || '-'} · {row.pol ?? '-'} / {row.pod ?? '-'}
                  </div>
                  <div className="mt-1 text-sm">{row.container_count} container(es), {row.containers_returned} devolvido(s)</div>
                  {openBl === row.bl_id ? <ContainerDetails row={row} /> : null}
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-[var(--app-border)] px-5 py-3 text-sm">
                <div className="text-[var(--app-muted)]">
                  {safePage * pageSize + 1}-{Math.min((safePage + 1) * pageSize, filtered.length)} de {filtered.length}
                </div>
                <div className="flex gap-1">
                  <Button variant="secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</Button>
                  <Button variant="secondary" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Proxima</Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    </>
  )
}

function Th({ children, sortable, column, onClick, icon }: { children: React.ReactNode; sortable?: boolean; column?: SortKey; onClick?: (k: SortKey) => void; icon?: React.ReactNode }) {
  const handleClick = () => { if (sortable && column && onClick) onClick(column) }
  return (
    <th
      scope="col"
      className={`px-4 py-3 ${sortable ? 'cursor-pointer select-none hover:text-[var(--app-text)]' : ''}`}
      onClick={handleClick}
    >
      <span className="inline-flex items-center">{children}{icon}</span>
    </th>
  )
}



function ContainerDetails({ row }: { row: PortalOperationBL }) {
  if (row.containers.length === 0) {
    return <div className="px-5 pb-5 text-sm text-[var(--app-muted)]">Nenhum container vinculado a este B/L.</div>
  }

  return (
    <div className="app-table-scroll border-t border-[var(--app-border)]">
      <table aria-label={`Containers do BL ${row.bl_id}`} className="app-table app-table--compact min-w-[860px] text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-4 py-3">Container</th>
            <th scope="col" className="px-4 py-3">Tipo</th>
            <th scope="col" className="px-4 py-3">Descarga</th>
            <th scope="col" className="px-4 py-3">Devolucao</th>
            <th scope="col" className="px-4 py-3">Dias uso</th>
            <th scope="col" className="px-4 py-3">Free time</th>
            <th scope="col" className="px-4 py-3">Demurrage</th>
            <th scope="col" className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {row.containers.map((container) => (
            <tr key={container.id}>
              <td className="px-4 py-3 font-semibold">{container.container_number}</td>
              <td className="px-4 py-3">{container.type ?? '-'}</td>
              <td className="px-4 py-3">{formatDate(container.discharge_date)}</td>
              <td className="px-4 py-3">{container.return_date ? formatDate(container.return_date) : 'Pendente'}</td>
              <td className="px-4 py-3">{formatNumber(container.usage_days)}</td>
              <td className="px-4 py-3">{formatNumber(container.free_time_days)}</td>
              <td className="px-4 py-3">{formatNumber(container.demurrage_days)}</td>
              <td className="px-4 py-3">{renderStatus(container.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatNumber(value: number | null) {
  return value == null ? '-' : String(value)
}

function renderStatus(status: PortalOperationContainerStatus) {
  if (status === 'devolvido') return <Badge tone="green">Devolvido</Badge>
  if (status === 'em_demurrage') return <Badge tone="red">Em demurrage</Badge>
  if (status === 'dentro_free_time') return <Badge tone="blue">Dentro free time</Badge>
  return <Badge tone="slate">Sem descarga</Badge>
}
