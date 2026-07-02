import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, Download, FileText, Trash2, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { BlImportModal } from '../components/shared/BlImportModal'
import { MercanteEdiModal } from '../components/shared/MercanteEdiModal'
import { CargoProfileBadge, ChargeStatusBadge } from '../components/shared/OperationalBadges'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { checkBlDependencies, deleteBls } from '../services/bls'
import { formatBlockedSummary } from '../services/deleteDependencies'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { countDistinctContainerNumbers } from '../lib/containerCounts'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatCnpjCpf } from '../lib/utils'
import { computeFileHash, DuplicateManifestImportError, importManifest, RateLimitImportError } from '../services/manifestImport'
import { countDistinctManifestContainers, parseManifestFile, type ParsedManifest } from '../services/manifestParser'
import { computeManifestOverwriteDiff } from '../services/manifestOverwritePreview'
import { supabase } from '../services/supabase'
import { logOperationalEvent } from '../services/operationalEvents'

const pageSizes = [20, 50, 100]

export function Manifestos() {
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const initialPod = searchParams.get('pod') ?? ''
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { isAdmin, user } = useAuth()
  const selection = useRowSelection<string>()
  const [deleting, setDeleting] = useState(false)
  const [filters, setFilters] = useState<BlFilters>({
    search: '',
    voyageId: initialVoyage,
    cargoMode: 'container',
    pol: '',
    pod: initialPod,
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [ediModalOpen, setEdiModalOpen] = useState(false)
  const [ediModalVoyage, setEdiModalVoyage] = useState<{
    voyage_number: string
    vessel?: { name?: string | null; imo?: string | null; carrier?: { scac?: string | null } | null } | null
    pol?: { locode?: string | null; name?: string | null } | null
    pod?: { locode?: string | null; name?: string | null } | null
  } | null>(null)
  const [ediModalBls, setEdiModalBls] = useState<Array<{
    id: string
    shipper?: string | null
    consignee?: string | null
    pol?: string | null
    pod?: string | null
    cargo_description?: string | null
    total_weight_kg?: number | null
    total_cbm?: number | null
    manifest_customer_cnpj_cpf?: string | null
    manifest_customer_name?: string | null
    bl_containers?: Array<{
      id: number
      container_number: string
      seal_number?: string | null
      type?: string | null
      tare_weight_kg?: number | null
      gross_weight_kg?: number | null
      cbm?: number | null
      is_imo?: boolean | null
      imo_class?: string | null
      un_number?: string | null
    }> | null
    bl_freight_lines?: Array<{
      bl_id: string
      seq: number
      description: string | null
      category: string | null
      mercante_code: string | null
      currency: string | null
      amount: number | null
      payment: string | null
    }> | null
  }>>([])
  const [ediModalPol, setEdiModalPol] = useState<string>('')
  const [ediModalPod, setEdiModalPod] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const { showToast } = useToast()
  const { data, isLoading, error } = useBls(filters)
  const { data: summary, isLoading: isSummaryLoading } = useBlSummary(filters)
  const { data: portOptions } = usePortOptions()
  const blIdsOnPage = useMemo(() => (data?.rows ?? []).map((row) => row.id), [data?.rows])
  const { data: invoiceLinksByBl } = useInvoiceLinks(blIdsOnPage)

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof BlFilters>(key: K, value: BlFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = (
    ['search', 'voyageId', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile'] as (keyof BlFilters)[]
  ).filter((key) => String(filters[key] ?? '').trim() !== '').length
  const filterDescription = describeActiveFilters([
    { label: 'Texto', value: filters.search },
    { label: 'Viagem', value: filters.voyageId },
    { label: 'POL', value: filters.pol },
    { label: 'POD', value: filters.pod },
    { label: 'Revisao', value: filters.reviewStatus },
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
      showToast(`Exportacao concluida com ${rows.length} B/L(s).`, 'success')
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
      ])
      showToast(`${report.deletableIds.length} B/L(s) excluido(s).`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir B/L(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  function handleOpenEdiModal() {
    const selectedIds = [...selection.selected]
    if (!selectedIds.length) return
    const selectedBls = (data?.rows ?? []).filter((row) => selection.isSelected(row.id))
    if (!selectedBls.length) return

    const groups = new Map<string, { pol: string; pod: string; bls: typeof selectedBls }>()
    for (const bl of selectedBls) {
      const key = `${bl.pol?.trim() ?? ''}__${bl.pod?.trim() ?? ''}`
      if (!groups.has(key)) {
        groups.set(key, { pol: bl.pol?.trim() ?? '', pod: bl.pod?.trim() ?? '', bls: [] })
      }
      groups.get(key)!.bls.push(bl)
    }

    const first = [...groups.values()][0]!
    const firstBl = first.bls[0]
    setEdiModalVoyage({
      voyage_number: firstBl.voyage?.voyage_number ?? '',
      vessel: firstBl.voyage?.vessel
        ? { name: firstBl.voyage.vessel.name, imo: firstBl.voyage.vessel.imo ?? '', carrier: firstBl.voyage.vessel.carrier }
        : null,
      pol: { locode: first.pol || null, name: null },
      pod: { locode: first.pod || null, name: null },
    })
    setEdiModalBls(first.bls as typeof ediModalBls)
    setEdiModalPol(first.pol)
    setEdiModalPod(first.pod)
    setEdiModalOpen(true)

    if (groups.size > 1) {
      showToast(`Agrupado em ${groups.size} rota(s). Selecionar um grupo por vez.`, 'info')
    }
  }

  const pageBlIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageBlIds.length > 0 && pageBlIds.every((id) => selection.isSelected(id))
  const blColumnCount = isAdmin ? 12 : 11

  return (
    <>
      <PageHeader
        title="BLs CNTR"
        description="Consulta paginada de B/Ls de container e importação de planilhas. Cada manifesto registra seu proprio trecho POL/POD dentro da viagem e vincula clientes pela base cadastral."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              className="app-btn app-btn--secondary"
              to={filters.voyageId ? `/containers?voyage=${filters.voyageId}` : '/containers'}
            >
              <Boxes size={16} />
              Containers
            </Link>
            <Button
              variant="secondary"
              onClick={handleOpenEdiModal}
              disabled={!selection.count}
              title={!selection.count ? 'Selecione B/Ls para gerar EDI Mercante' : 'Gerar EDI Mercante dos B/Ls selecionados'}
            >
              <FileText size={16} />
              Gerar EDI Mercante
            </Button>
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar
            </Button>
            <Button variant="secondary" onClick={() => setCeMercanteOpen(true)}>
              <Upload size={16} />
              Importar CE Mercante
            </Button>
            <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
              <Upload size={16} />
              Importar B/L
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload size={16} />
              Importar Manifesto CNTR
            </Button>
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
                  {pol}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => (
                <option key={pod} value={pod}>
                  {pod}
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

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <SummaryCard label="B/Ls filtrados" value={isSummaryLoading ? '...' : summary?.totalBls ?? 0} />
        <SummaryCard label="CNTRS" value={isSummaryLoading ? '...' : summary?.totalDistinctContainers ?? 0} />
        <SummaryCard label="Pendentes revisao" value={isSummaryLoading ? '...' : summary?.pendingReview ?? 0} />
        <SummaryCard label="Sem faturamento" value={isSummaryLoading ? '...' : summary?.pendingFinancial ?? 0} />
        <SummaryCard label="Taxas pendentes" value={isSummaryLoading ? '...' : summary?.chargePending ?? 0} />
        <SummaryCard label="Faturados" value={isSummaryLoading ? '...' : summary?.chargeReady ?? 0} />
        <SummaryCard label="Isentos" value={isSummaryLoading ? '...' : summary?.chargeExempt ?? 0} />
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
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os B/Ls da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageBlIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">No. B/L</th>
                <th scope="col" className="px-4 py-3">CE Mercante</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="w-[168px] px-4 py-3">CNEE</th>
                <th scope="col" className="px-4 py-3">POL</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">CNTRS</th>
                <th scope="col" className="px-4 py-3">Perfil</th>
                <th scope="col" className="px-4 py-3">Taxas locais</th>
                <th scope="col" className="px-4 py-3">Invoice</th>
                <th scope="col" className="px-4 py-3">Acoes</th>
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
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar B/L ${bl.id}`}
                        checked={selection.isSelected(bl.id)}
                        onChange={() => selection.toggle(bl.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-semibold">
                    <Link className="text-[#58a6ff] hover:underline" to={`/manifestos/${bl.id}`}>
                      {bl.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{bl.ce_mercante ?? '-'}</td>
                  <td className="px-4 py-3">
                    {bl.voyage?.vessel?.name ?? '-'} / {bl.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--md"
                      title={bl.customer?.name ?? bl.consignee ?? '-'}
                    >
                      {bl.customer?.name ?? bl.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{bl.pol ?? '-'}</td>
                  <td className="px-4 py-3">{bl.pod ?? '-'}</td>
                  <td className="px-4 py-3">{countDistinctContainerNumbers(bl.bl_containers)}</td>
                  <td className="px-4 py-3">
                    <CargoProfileBadge
                      isImo={Boolean(bl.bl_containers?.some((container) => container.is_imo))}
                      isOog={Boolean(bl.bl_containers?.some((container) => container.is_oog))}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <ChargeStatusBadge status={bl.charge_status} />
                  </td>
                  <td className="px-4 py-3">
                    <InvoiceLink links={invoiceLinksByBl?.[bl.id] ?? []} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        className="app-table__action"
                        to={`/manifestos/${bl.id}`}
                      >
                        Abrir B/L
                      </Link>
                      {isAdmin ? (
                        <button
                          onClick={() => runBlDelete([bl.id])}
                          disabled={deleting}
                          className="text-red-400 hover:text-red-300 disabled:opacity-40"
                          title="Excluir B/L"
                          aria-label={`Excluir B/L ${bl.id}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="app-table__footer">
          <span>
            Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros
          </span>
          <div className="app-table__footer-controls">
            <Select
              className="w-28"
              value={filters.pageSize}
              onChange={(event) => updateFilter('pageSize', Number(event.target.value))}
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}/pag.
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={filters.page <= 1}
              onClick={() => updateFilter('page', Math.max(1, filters.page - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              disabled={filters.page >= totalPages}
              onClick={() => updateFilter('page', Math.min(totalPages, filters.page + 1))}
            >
              Proxima
            </Button>
          </div>
        </div>
      </Card>

      <UploadManifestModal
        key={`${uploadOpen ? 'open' : 'closed'}-${filters.voyageId}`}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        initialVoyageId={filters.voyageId}
      />
      <BlImportModal
        key={`${blFreightOpen ? 'open' : 'closed'}-${filters.voyageId}`}
        open={blFreightOpen}
        onClose={() => setBlFreightOpen(false)}
        voyageId={filters.voyageId ? Number(filters.voyageId) : null}
      />
      <CeMercanteImportModal open={ceMercanteOpen} onClose={() => setCeMercanteOpen(false)} />
      <MercanteEdiModal
        open={ediModalOpen}
        onClose={() => setEdiModalOpen(false)}
        voyage={ediModalVoyage ?? { voyage_number: '', pol: { locode: '', name: '' }, pod: { locode: '', name: '' } }}
        bls={ediModalBls}
        prefilledPol={ediModalPol}
        prefilledPod={ediModalPod}
      />

    </>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  const tone =
    label === 'Sem faturamento'
      ? 'green'
      : label === 'Pendentes revisao'
        ? 'gold'
        : label === 'CNTRS'
          ? 'blue'
          : 'navy'

  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`} title="Considera os filtros ativos desta tela.">
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
      </Card>
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
    <Link className="text-[#58a6ff] hover:underline" to={`/faturamento?invoice=${latest.id}`}>
      {label}
    </Link>
  )
}

function UploadManifestModal({
  open,
  onClose,
  initialVoyageId = '',
}: {
  open: boolean
  onClose: () => void
  initialVoyageId?: string
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [files, setFiles] = useState<File[]>([])
  const [manifestsByFile, setManifestsByFile] = useState<Record<string, ParsedManifest>>({})
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createVoyageOpen, setCreateVoyageOpen] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importSummary, setImportSummary] = useState<Array<{ file: string; status: 'success' | 'error'; message: string }>>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null)
  const [waitMessage, setWaitMessage] = useState<string | null>(null)

  const primaryManifest = files.length ? manifestsByFile[files[previewIndex]?.name] ?? null : null
  const totals = useMemo(
    () => ({
      bls: primaryManifest?.bls.length ?? 0,
      containerOccurrences: primaryManifest?.bls.reduce((sum, bl) => sum + (bl.containers?.length ?? 0), 0) ?? 0,
      containers: countDistinctManifestContainers(primaryManifest),
      pending: primaryManifest?.bls.filter((bl) => bl.review_status === 'pending_review').length ?? 0,
    }),
    [primaryManifest],
  )
  const routeSummary = useMemo(() => summarizeManifestRoutes(primaryManifest), [primaryManifest])

  // Preview de sobrescrita (#307): B/Ls já existentes na viagem que este
  // manifesto mudaria. Read-only — só dá transparência antes de confirmar.
  const previewFileName = files[previewIndex]?.name ?? null
  const { data: existingOverwriteBls } = useQuery({
    queryKey: ['manifest-overwrite-existing', voyageId, previewFileName],
    enabled: Boolean(voyageId) && Boolean(primaryManifest?.bls.length),
    queryFn: async () => {
      const ids = primaryManifest?.bls.map((bl) => bl.id) ?? []
      if (!ids.length) return [] as Parameters<typeof computeManifestOverwriteDiff>[1]
      const { data, error } = await supabase
        .from('bls')
        .select('id, shipper, consignee, cargo_description, pol, pod, total_weight_kg, total_cbm')
        .eq('voyage_id', Number(voyageId))
        .in('id', ids)
      if (error) throw error
      return (data ?? []) as unknown as Parameters<typeof computeManifestOverwriteDiff>[1]
    },
  })
  const overwrites = useMemo(
    () => computeManifestOverwriteDiff(primaryManifest?.bls ?? [], existingOverwriteBls ?? []),
    [primaryManifest, existingOverwriteBls],
  )

  function resetModalState() {
    setFiles([])
    setManifestsByFile({})
    setParsing(false)
    setSubmitting(false)
    setProgress({ current: 0, total: 0 })
    setImportSummary([])
    setPreviewIndex(0)
    setImportStatusMessage(null)
    setWaitMessage(null)
  }

  function closeModal() {
    resetModalState()
    onClose()
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? [])
    setFiles(nextFiles)
    setManifestsByFile({})
    setImportSummary([])
    setProgress({ current: 0, total: 0 })
    setPreviewIndex(0)
    if (!nextFiles.length) return

    setParsing(true)
    try {
      const parsedEntries = await Promise.all(
        nextFiles.map(async (currentFile) => ({
          name: currentFile.name,
          manifest: await parseManifestFile(currentFile),
        })),
      )
      const nextManifests: Record<string, ParsedManifest> = {}
      for (const entry of parsedEntries) nextManifests[entry.name] = entry.manifest
      setManifestsByFile(nextManifests)
      showToast(
        nextFiles.length === 1 ? 'Preview do manifesto carregado.' : `Preview de ${nextFiles.length} manifestos carregado.`,
        'success',
      )
    } catch {
      showToast('Não foi possível ler o arquivo. Confira o formato .xlsx ou .csv.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!files.length || !voyageId || !user) return

    setSubmitting(true)
    setImportSummary([])
    setImportStatusMessage(null)
    setWaitMessage(null)
    setProgress({ current: 0, total: files.length })
    const results: Array<{ file: string; status: 'success' | 'error'; message: string }> = []
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const manifest = manifestsByFile[file.name]
        setProgress({ current: index + 1, total: files.length })
        if (!manifest) {
          results.push({ file: file.name, status: 'error', message: 'Preview não carregado para este arquivo.' })
          continue
        }
        try {
          const fileHash = await computeFileHash(await file.arrayBuffer())
          if (!fileHash) {
            results.push({ file: file.name, status: 'error', message: 'Nao foi possivel calcular o hash do arquivo para deduplicacao.' })
            continue
          }
          await importManifestWithRetry({
            filename: file.name,
            voyageId: Number(voyageId),
            manifest,
            uploadedBy: user.id,
            fileHash,
            onRateLimitWait: (seconds) => setWaitMessage(`Limite atingido. Aguardando ${seconds}s para retomar...`),
            onResume: () => setWaitMessage(null),
          })
          results.push({ file: file.name, status: 'success', message: 'Importado com sucesso.' })
          if (index < files.length - 1) {
            setWaitMessage('Aguardando alguns segundos antes do proximo arquivo...')
            await sleep(3000)
            setWaitMessage(null)
          }
        } catch (error) {
          if (error instanceof DuplicateManifestImportError) {
            void logOperationalEvent({
              code: 'manifest_import_duplicate_hash',
              message: error.message,
              changedBy: user?.id ?? null,
              entityId: file.name,
              context: { voyageId: Number(voyageId), filename: file.name },
            })
            results.push({ file: file.name, status: 'error', message: error.message })
            continue
          }
          if (error instanceof RateLimitImportError) {
            void logOperationalEvent({
              code: 'manifest_import_rate_limited',
              message: error.message,
              changedBy: user?.id ?? null,
              entityId: file.name,
              context: { voyageId: Number(voyageId), filename: file.name },
            })
            results.push({ file: file.name, status: 'error', message: error.message })
            continue
          }
          console.error('Erro ao importar manifesto:', error)
          results.push({ file: file.name, status: 'error', message: String(error instanceof Error ? error.message : error) })
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['bls'] })
      await queryClient.invalidateQueries({ queryKey: ['bl-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['invoice-links'] })
      await queryClient.invalidateQueries({ queryKey: ['voyages'] })
      setImportSummary(results)
      const successCount = results.filter((item) => item.status === 'success').length
      const errorCount = results.length - successCount
      const allProcessed = results.length === files.length
      const allSucceeded = allProcessed && successCount === files.length

      if (allSucceeded) {
        setImportStatusMessage(
          successCount === 1 ? 'Manifesto importado com sucesso.' : `${successCount} manifestos importados com sucesso.`,
        )
        showToast(
          successCount === 1 ? 'Manifesto importado com sucesso.' : `${successCount} manifestos importados com sucesso.`,
          'success',
        )
        closeModal()
        return
      } else if (successCount > 0) {
        setImportStatusMessage(`Importacao parcial: ${successCount} sucesso(s), ${errorCount} erro(s).`)
        showToast(`Importacao concluida com ${successCount} sucesso(s) e ${errorCount} erro(s).`, 'info')
      } else {
        setImportStatusMessage('Falha na importação: nenhum manifesto foi importado.')
        showToast('Nenhum manifesto foi importado. Revise os erros abaixo.', 'error')
      }
      if (files.length > 1) {
        const nextPendingIndex = files.findIndex((file, index) => index > previewIndex && !results.some((row) => row.file === file.name))
        if (nextPendingIndex >= 0) setPreviewIndex(nextPendingIndex)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={closeModal} title="Importar Manifesto CNTR">
      <div className="grid gap-5">
        <VoyageCombobox
          required
          label="Viagem de destino"
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setCreateVoyageOpen(true)}>
            Criar viagem agora
          </Button>
        </div>
        <Field label="Arquivos .xlsx ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" multiple onChange={handleFile} />
        </Field>

        <div className="app-panel app-panel--padded text-sm">
          Clientes sao vinculados por CNPJ/CPF ja existente em <span className="font-semibold text-[var(--app-text-strong)]">Clientes &gt; Importar base</span>.
          Manifestos não criam novos cadastros automaticamente.
        </div>

        {parsing ? <div className="app-panel__meta">Processando arquivo com SheetJS sob demanda...</div> : null}

        {files.length > 0 ? (
          <div className="app-panel app-panel--padded text-sm">
            {files.length} arquivo(s) selecionado(s). O preview detalhado abaixo mostra o arquivo {Math.min(previewIndex + 1, files.length)}.
          </div>
        ) : null}

        {primaryManifest ? (
          <div className="grid gap-4">
            <div className="app-panel app-panel--padded text-sm">
              <div className="app-metric-tile__label">Trecho detectado no manifesto</div>
              <div className="mt-1 font-semibold text-[var(--app-text-strong)]">{routeSummary.label}</div>
              <div className="app-panel__meta mt-1">
                A viagem agrupa navio e numero da viagem. O POL/POD permanece registrado nos B/Ls deste manifesto.
              </div>
            </div>

            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <PreviewBox label="B/Ls" value={totals.bls} />
              <PreviewBox label="Ocorrencias CNTR" value={totals.containerOccurrences} />
              <PreviewBox label="Containers distintos" value={totals.containers} />
              <PreviewBox label="Pendentes revisao" value={totals.pending} />
            </div>

            {overwrites.length > 0 ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-semibold">
                  {overwrites.length} B/L(s) já existente(s) nesta viagem serão sobrescritos por este manifesto:
                </div>
                <ul className="mt-1 space-y-1">
                  {overwrites.slice(0, 10).map((ow) => (
                    <li key={ow.bl_number}>
                      <span className="font-mono text-xs font-semibold">{ow.bl_number}</span>{' '}
                      <span className="text-amber-800">
                        {ow.diffs.map((d) => `${d.field}: "${d.from}" → "${d.to}"`).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {overwrites.length > 10 ? (
                  <div className="mt-1 text-xs">… e mais {overwrites.length - 10} B/L(s).</div>
                ) : null}
                <div className="mt-1 text-xs">
                  Confira antes de confirmar — a importação aplica essas mudanças (ADR 0017: nada em silêncio).
                </div>
              </div>
            ) : null}

            {routeSummary.multipleRoutes ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                O arquivo trouxe mais de uma combinacao POL/POD. Revise o parsing antes de importar.
              </div>
            ) : null}

            <div className="app-table-scroll app-table-scroll--sticky rounded-xl border border-[var(--app-border)]">
              <table className="app-table app-table--compact min-w-[720px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">B/L</th>
                    <th scope="col" className="px-3 py-2">Consignatario</th>
                    <th scope="col" className="px-3 py-2">CNPJ</th>
                    <th scope="col" className="px-3 py-2">Containers distintos</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {primaryManifest.bls.slice(0, 25).map((bl) => (
                    <tr key={bl.id}>
                      <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{bl.id}</td>
                      <td className="px-3 py-2">{bl.consignee ?? '-'}</td>
                      <td className="px-3 py-2">{formatCnpjCpf(bl.cnpj_cpf)}</td>
                      <td className="px-3 py-2">{countDistinctContainerNumbers(bl.containers)}</td>
                      <td className="px-3 py-2">
                        <ReviewBadge status={bl.review_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TruncationNote shown={25} total={primaryManifest.bls.length} noun="B/L" nounPlural="B/Ls" />

            {primaryManifest.rowErrors.length ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {primaryManifest.rowErrors.length} linha(s) com erro serao registradas em import_errors.
              </div>
            ) : null}
          </div>
        ) : null}

        {submitting ? (
          <div className="rounded-xl border border-blue-500/40 bg-blue-500/15 p-3 text-sm font-bold text-blue-900">
            Importando arquivo {progress.current} de {progress.total}...
          </div>
        ) : null}

        {waitMessage ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-sm font-semibold text-amber-900">
            {waitMessage}
          </div>
        ) : null}

        {importSummary.length ? (
            <div className="app-panel app-panel--padded max-h-44 overflow-auto text-sm">
            <div className="app-metric-tile__label mb-2">Resumo da importação</div>
            <div className="grid gap-1">
              {importSummary.map((item) => (
                <div key={`${item.file}-${item.message}`} className={item.status === 'success' ? 'text-green-700' : 'text-red-700'}>
                  {item.status === 'success' ? 'OK' : 'ERRO'} | {item.file} | {item.message}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {importStatusMessage ? (
          <div className="app-panel px-3 py-2 text-sm">
            {importStatusMessage}
          </div>
        ) : null}

        {files.length > 1 ? (
          <div className="app-panel flex items-center justify-between gap-3 px-3 py-2 text-xs text-[var(--app-muted)]">
            <span>
              Arquivo em preview: <span className="font-semibold text-[var(--app-text-strong)]">{files[previewIndex]?.name ?? '-'}</span>
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={previewIndex <= 0} onClick={() => setPreviewIndex((current) => Math.max(0, current - 1))}>
                Anterior
              </Button>
              <Button
                variant="ghost"
                disabled={previewIndex >= files.length - 1}
                onClick={() => setPreviewIndex((current) => Math.min(files.length - 1, current + 1))}
              >
                Proximo
              </Button>
            </div>
          </div>
        ) : null}

        <div className="app-modal__actions">
            <Button variant="secondary" onClick={closeModal}>
            Cancelar
          </Button>
          <Button disabled={!files.length || !voyageId} loading={submitting} onClick={handleImport}>
            Confirmar importação
          </Button>
        </div>
        {!voyageId ? (
          <div className="text-sm text-amber-700">Selecione ou crie uma viagem de destino para habilitar a confirmação.</div>
        ) : null}
      </div>

      <VoyageCreateModal
        open={createVoyageOpen}
        onClose={() => setCreateVoyageOpen(false)}
        title="Criar viagem para este manifesto"
        initialValues={primaryManifest?.suggestedVoyage}
        note={
          primaryManifest
            ? `Trecho detectado neste arquivo: ${routeSummary.label}. A viagem sera criada sem amarrar esse trecho, porque cada manifesto da viagem carrega seu proprio POL/POD.`
            : undefined
        }
        onSaved={(createdVoyageId) => {
          setVoyageId(String(createdVoyageId))
          setCreateVoyageOpen(false)
        }}
      />

    </Modal>
  )
}

async function importManifestWithRetry(payload: {
  filename: string
  voyageId: number
  manifest: ParsedManifest
  uploadedBy: string
  fileHash: string | null
  onRateLimitWait?: (seconds: number) => void
  onResume?: () => void
}) {
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      payload.onResume?.()
      await importManifest(payload)
      return
    } catch (error) {
      const isRateLimit = error instanceof RateLimitImportError
      const isLast = attempt === maxAttempts
      if (!isRateLimit || isLast) throw error
      payload.onRateLimitWait?.(60)
      await sleep(60000)
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="app-metric-tile">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}

function ReviewBadge({ status }: { status: string }) {
  if (status === 'pending_review') return <Badge tone="yellow">Pendente</Badge>
  if (status === 'reviewed') return <Badge tone="green">Revisado</Badge>
  return <Badge tone="blue">OK</Badge>
}

function summarizeManifestRoutes(manifest: ParsedManifest | null) {
  const routeLabels = Array.from(
    new Set(
      (manifest?.bls ?? [])
        .map((bl) => {
          if (!bl.pol && !bl.pod) return null
          return `${bl.pol ?? '-'} -> ${bl.pod ?? '-'}`
        })
        .filter((route): route is string => Boolean(route)),
    ),
  )

  if (routeLabels.length === 0) {
    return { label: 'Não identificado', multipleRoutes: false }
  }

  if (routeLabels.length === 1) {
    return { label: routeLabels[0], multipleRoutes: false }
  }

  return { label: routeLabels.join(' | '), multipleRoutes: true }
}
