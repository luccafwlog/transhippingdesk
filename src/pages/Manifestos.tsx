import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Download, Trash2, Upload, MoreVertical } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { BlImportModal } from '../components/shared/BlImportModal'
import { CargoProfileBadge, ChargeStatusBadge } from '../components/shared/OperationalBadges'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { checkBlDependencies, deleteBls } from '../services/bls'
import { formatBlockedSummary } from '../services/deleteDependencies'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { countDistinctContainerNumbers } from '../lib/containerCounts'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatPortDisplayName } from '../lib/voyageFormat'

export function Manifestos() {
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const initialPol = searchParams.get('pol') ?? ''
  const initialPod = searchParams.get('pod') ?? ''
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { isAdmin, user, profile } = useAuth()
  const canImport = Boolean(profile || user)
  const selection = useRowSelection<string>()
  const [deleting, setDeleting] = useState(false)
  const { filters, setFilters, updateFilter } = usePageFilters<BlFilters>({
    search: '',
    voyageId: initialVoyage,
    cargoMode: 'container',
    pol: initialPol,
    pod: initialPod,
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })
  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { showToast } = useToast()
  const { data, isLoading, error } = useBls(filters)
  const { data: summary, isLoading: isSummaryLoading } = useBlSummary(filters)
  const { data: portOptions } = usePortOptions()
  const blIdsOnPage = useMemo(() => (data?.rows ?? []).map((row) => row.id), [data?.rows])
  const { data: invoiceLinksByBl } = useInvoiceLinks(blIdsOnPage)

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  const activeFilterCount = (
    ['search', 'voyageId', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile'] as (keyof BlFilters)[]
  ).filter((key) => String(filters[key] ?? '').trim() !== '').length
  const filterDescription = describeActiveFilters([
    { label: 'Texto', value: filters.search },
    { label: 'Viagem', value: filters.voyageId },
    { label: 'POL', value: filters.pol },
    { label: 'POD', value: filters.pod },
    { label: 'Revisão', value: filters.reviewStatus },
    { label: 'Financeiro', value: filters.financialStatus },
    { label: 'Taxas', value: filters.chargeStatus },
    { label: 'Perfil', value: filters.cargoProfile },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'B/L',
    entityPlural: 'B/Ls',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum B/L importado ainda.',
    emptyWithFilters: 'Nenhum B/L encontrado.',
  })

  type ActionsMenuState = {
    id: string
    top: number
    left: number
  } | null
  const [actionsMenu, setActionsMenu] = useState<ActionsMenuState>(null)

  function close() {
    setActionsMenu(null)
  }

  useMemo(() => {
    if (!actionsMenu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-actions-menu]')) close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [actionsMenu])

  function clearFilters() {
    setFilters((current) => ({
      ...current,
      search: '',
      voyageId: '',
      pol: '',
      pod: '',
      reviewStatus: '',
      financialStatus: '',
      chargeStatus: '',
      cargoProfile: '',
      page: 1,
    }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllBls(filters)
      if (!rows.length) {
        showToast('Nenhum manifesto encontrado para exportar com os filtros atuais.', 'info')
        return
      }

      const { exportManifestWorkbook } = await import('../services/exports')
      await exportManifestWorkbook(rows)
      showToast(`Exportação concluída com ${rows.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar manifestos.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function runBlDelete(ids: string[]) {
    setDeleting(true)
    try {
      const report = await checkBlDependencies(ids)
      if (report.deletableIds.length === 0) {
        showToast(`Nenhum B/L pode ser excluido. ${formatBlockedSummary(report.blockedIds)}`, 'error')
        return
      }

      const parts = [
        `Excluir ${report.deletableIds.length} B/L(s)? Containers, break-bulk e veiculos vinculados serao excluidos junto. Esta acao e irreversivel.`,
      ]
      if (report.blockedIds.length) parts.push(formatBlockedSummary(report.blockedIds))
      const ok = await confirm({ message: parts.join('\n\n'), tone: 'danger', confirmLabel: 'Excluir' })
      if (!ok) return

      await deleteBls(report.deletableIds, user?.id)
      selection.clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-links'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation'] }),
      ])
      showToast(`${report.deletableIds.length} B/L(s) excluido(s).`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir B/L(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const pageBlIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageBlIds.length > 0 && pageBlIds.every((id) => selection.isSelected(id))
  const blColumnCount = isAdmin ? 12 : 11

  return (
    <>
      <PageHeader
        title="BLs CNTR"
        description="Consulta paginada de B/Ls de container e importação de planilhas. Cada B/L registra seu próprio trecho POL/POD dentro da viagem e vincula clientes pela base cadastral."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              className="app-btn app-btn--secondary"
              to={filters.voyageId ? `/containers?voyage=${filters.voyageId}` : '/containers'}
            >
              <Boxes size={16} />
              Containers
            </Link>
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar
            </Button>
            {canImport ? (
              <>
                <Button variant="secondary" onClick={() => setCeMercanteOpen(true)}>
                  <Upload size={16} />
                  Importar CE Mercante
                </Button>
                <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
                  <Upload size={16} />
                  Importar B/L
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Texto livre">
            <Input
              placeholder="B/L ou cliente"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </Field>
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="POL">
            <Select value={filters.pol} onChange={(event) => updateFilter('pol', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pols.map((pol) => (
                <option key={pol} value={pol}>
                  {formatPortDisplayName(pol)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => (
                <option key={pod} value={pod}>
                  {formatPortDisplayName(pod)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status revisao">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
            </Select>
          </Field>
          <Field label="Status financeiro">
            <Select
              value={filters.financialStatus}
              onChange={(event) => updateFilter('financialStatus', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="invoiced">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
          <Field label="Status taxas locais">
            <Select value={filters.chargeStatus} onChange={(event) => updateFilter('chargeStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="review_required">Revisão</option>
              <option value="exempt">Isento</option>
              <option value="ready_for_billing">Faturado</option>
            </Select>
          </Field>
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="standard">Standard</option>
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
        </div>
      </FilterBar>

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Pendentes revisão" value={isSummaryLoading ? '...' : summary?.pendingReview ?? 0} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="B/Ls filtrados" value={isSummaryLoading ? '...' : summary?.totalBls ?? 0} />
          <MetricCard label="CNTRS" value={isSummaryLoading ? '...' : summary?.totalDistinctContainers ?? 0} />
          <MetricCard label="Sem faturamento" value={isSummaryLoading ? '...' : summary?.pendingFinancial ?? 0} />
          <MetricCard label="Taxas pendentes" value={isSummaryLoading ? '...' : summary?.chargePending ?? 0} />
          <MetricCard label="Faturados" value={isSummaryLoading ? '...' : summary?.chargeReady ?? 0} />
          <MetricCard label="Isentos" value={isSummaryLoading ? '...' : summary?.chargeExempt ?? 0} />
        </div>
      </div>

      {isAdmin ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => runBlDelete([...selection.selected])}
          deleting={deleting}
          noun={['B/L', 'B/Ls']}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(data?.count ?? 0, 'B/L retornado', 'B/Ls retornados')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar manifestos." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact app-table--sticky-actions min-w-[920px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                {isAdmin ? (
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os B/Ls da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageBlIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-3">No. B/L</th>
                <th scope="col" className="px-3 py-3">CE Mercante</th>
                <th scope="col" className="px-3 py-3">Navio/Viagem</th>
                <th scope="col" className="px-3 py-3">CNEE</th>
                <th scope="col" className="px-3 py-3">POL</th>
                <th scope="col" className="px-3 py-3">POD</th>
                <th scope="col" className="px-3 py-3">CNTRS</th>
                <th scope="col" className="px-3 py-3">Perfil</th>
                <th scope="col" className="px-3 py-3">Taxas locais</th>
                <th scope="col" className="px-3 py-3">Invoice</th>
                <th scope="col" className="px-3 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={blColumnCount} className="p-0">
                    <SkeletonTable rows={8} cols={6} />
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={blColumnCount} className="p-0">
                    <EmptyState title={emptyState.title} description={emptyState.description} />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((bl) => (
                <tr key={bl.id} className="hover:bg-[#21262d]/60">
                  {isAdmin ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar B/L ${bl.id}`}
                        checked={selection.isSelected(bl.id)}
                        onChange={() => selection.toggle(bl.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-3 font-semibold">
                    <Link className="text-[#58a6ff] hover:underline" to={`/manifestos/${bl.id}`}>
                      {bl.id}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{bl.ce_mercante ?? '-'}</td>
                  <td className="px-3 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--sm"
                      title={`${bl.voyage?.vessel?.name ?? '-'} / ${bl.voyage?.voyage_number ?? '-'}`}
                    >
                      {bl.voyage?.vessel?.name ?? '-'} / {bl.voyage?.voyage_number ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--sm"
                      title={bl.customer?.name ?? bl.consignee ?? '-'}
                    >
                      {bl.customer?.name ?? bl.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3">{bl.pol ?? '-'}</td>
                  <td className="px-3 py-3">{bl.pod ?? '-'}</td>
                  <td className="px-3 py-3">{countDistinctContainerNumbers(bl.bl_containers)}</td>
                  <td className="px-3 py-3">
                    <CargoProfileBadge
                      isImo={Boolean(bl.bl_containers?.some((container) => container.is_imo))}
                      isOog={Boolean(bl.bl_containers?.some((container) => container.is_oog))}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <ChargeStatusBadge status={bl.charge_status} />
                  </td>
                  <td className="px-3 py-3">
                    <InvoiceLink links={invoiceLinksByBl?.[bl.id] ?? []} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        className="app-table__action"
                        to={`/manifestos/${bl.id}`}
                      >
                        Abrir B/L
                      </Link>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="app-btn app-btn--secondary p-1 leading-none"
                          aria-label={`Ações para B/L ${bl.id}`}
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            setActionsMenu({
                              id: bl.id,
                              top: rect.bottom + window.scrollY + 4,
                              left: rect.right + window.scrollX - 160,
                            })
                          }}
                        >
                          <MoreVertical size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && totalPages > 1 ? (
          <TableFooterPagination
            page={filters.page}
            pageSize={filters.pageSize}
            totalCount={data?.count ?? 0}
            totalPages={totalPages}
            countLabel={`${data?.count ?? 0} B/Ls`}
            onPageChange={(page) => updateFilter('page', page)}
            onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
          />
        ) : null}
      </Card>

      {actionsMenu ? (
        <div
          data-actions-menu
          className="app-floating-menu"
          role="menu"
          style={{ top: actionsMenu.top, left: actionsMenu.left }}
        >
          {isAdmin ? (
            <button
              type="button"
              role="menuitem"
              className="app-floating-menu__danger"
              disabled={deleting}
              onClick={() => {
                const id = actionsMenu.id
                setActionsMenu(null)
                void runBlDelete([id])
              }}
            >
              <Trash2 size={14} />
              Excluir B/L
            </button>
          ) : null}
        </div>
      ) : null}

      <BlImportModal
        key={`bl-import-${blFreightOpen ? 'open' : 'closed'}-${filters.voyageId}`}
        open={blFreightOpen && canImport}
        onClose={() => setBlFreightOpen(false)}
        voyageId={filters.voyageId ? Number(filters.voyageId) : null}
      />
      <CeMercanteImportModal open={ceMercanteOpen && canImport} onClose={() => setCeMercanteOpen(false)} />
    </>
  )
}

function InvoiceLink({
  links,
}: {
  links: Array<{ id: number; invoice_number: string | null; status: string | null }>
}) {
  if (!links.length) {
    return <span className="text-xs text-[var(--app-muted-soft)]">-</span>
  }

  const latest = links[0]
  const label = latest.invoice_number ?? `INV-${latest.id}`
  return (
    <Link className="text-[#58a6ff] hover:underline" to={`/taxas-locais?invoice=${latest.id}`}>
      {label}
    </Link>
  )
}
