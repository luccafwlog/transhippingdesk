import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { BlDocumentImportModal } from '../components/shared/BlDocumentImportModal'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { ChargeStatusBadge } from '../components/shared/OperationalBadges'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { PreviewBox } from '../components/ui/PreviewBox'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { FileImportModal } from '../components/shared/FileImportModal'
import { useAuth } from '../hooks/useAuth'
import { fetchAllBls, type BlFilters, useBls, usePortOptions } from '../hooks/useBls'
import { usePageFilters } from '../hooks/usePageFilters'
import { summarizeChargeStatuses } from '../lib/chargeStatus'
import { useInvoiceLinks } from '../hooks/useBilling'
import { importBreakbulkManifest, parseBreakbulkManifestFile, type ParsedBreakbulkManifest } from '../services/breakbulkImport'
import { afterManifestoImportado } from '../services/cacheEffects'
import type { BLListItem } from '../types/database'

export function CargaSolta() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user, profile } = useAuth()
  const canImport = Boolean(profile || user)
  const { showToast } = useToast()
  const { data: portOptions } = usePortOptions()
  const initialVoyageId = searchParams.get('voyage') ?? ''
  const { filters, setFilters, updateFilter } = usePageFilters<BlFilters>({
    search: '',
    voyageId: initialVoyageId,
    cargoMode: 'carga_solta',
    pol: '',
    pod: searchParams.get('pod') ?? '',
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [blDocumentOpen, setBlDocumentOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [voyageId, setVoyageId] = useState(initialVoyageId)

  const { data, isLoading, error } = useBls(filters)
  const blIdsOnPage = useMemo(() => (data?.rows ?? []).map((row) => row.id), [data?.rows])
  const { data: invoiceLinksByBl } = useInvoiceLinks(blIdsOnPage)
  const [summaryRows, setSummaryRows] = useState<BLListItem[]>([])
  const summaryFilters = useMemo(
    () => ({
      search: filters.search,
      voyageId: filters.voyageId,
      cargoMode: filters.cargoMode,
      pol: filters.pol,
      pod: filters.pod,
      reviewStatus: filters.reviewStatus,
      financialStatus: filters.financialStatus,
      chargeStatus: filters.chargeStatus,
      cargoProfile: filters.cargoProfile,
      page: 1,
      pageSize: 1000,
    }),
    [
      filters.search,
      filters.voyageId,
      filters.cargoMode,
      filters.pol,
      filters.pod,
      filters.reviewStatus,
      filters.financialStatus,
      filters.chargeStatus,
      filters.cargoProfile,
    ],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rows = await fetchAllBls(summaryFilters)
      if (!cancelled) {
        setSummaryRows(rows)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [summaryFilters])

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const summary = useMemo(() => {
    const rows = summaryRows ?? []
    const totalMachines = rows.reduce((sum, row) => sum + Number(row.bb_machine_qty ?? 0), 0)
    const totalPackages = rows.reduce((sum, row) => sum + Number(row.bb_packages_total ?? row.bb_packages_qty ?? 0), 0)
    const totalWeightTon = rows.reduce(
      (sum, row) => sum + Number(row.bb_weight_ton ?? (row.total_weight_kg ? Number(row.total_weight_kg) / 1000 : 0)),
      0,
    )
    const totalCbm = rows.reduce((sum, row) => sum + Number(row.total_cbm ?? 0), 0)
    const charges = summarizeChargeStatuses(rows)
    return {
      totalBls: rows.length,
      totalMachines,
      totalPackages,
      totalWeightTon,
      totalCbm,
      chargePending: charges.pending,
      chargeReady: charges.ready,
      chargeExempt: charges.exempt,
    }
  }, [summaryRows])

  const activeFilterCount = (
    ['search', 'voyageId', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus'] as (keyof BlFilters)[]
  ).filter((key) => String(filters[key] ?? '').trim() !== '').length

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
      page: 1,
    }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllBls(filters)
      if (!rows.length) {
        showToast('Nenhum manifesto BB encontrado para exportar com os filtros atuais.', 'info')
        return
      }

      const { exportManifestWorkbook } = await import('../services/exports')
      await exportManifestWorkbook(rows)
      showToast(`Exportação concluída com ${rows.length} B/L(s) BB.`, 'success')
    } catch {
      showToast('Falha ao exportar manifestos BB.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="BLs Carga Solta"
        description="Consulta paginada de B/Ls break bulk no layout operacional atual da planilha BB."
        action={
          <div className="flex flex-wrap gap-2">
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
                <Button variant="secondary" onClick={() => setBlDocumentOpen(true)}>
                  <Upload size={16} />
                  Importar B/Ls (PDF/DOCX)
                </Button>
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload size={16} />
                  Importar Manifesto BB
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
              placeholder="B/L ou consignatario"
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
          <Field label="Revisao">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
            </Select>
          </Field>
          <Field label="Financeiro">
            <Select value={filters.financialStatus} onChange={(event) => updateFilter('financialStatus', event.target.value)}>
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
              <option value="ready_for_billing">Pronto para faturar</option>
            </Select>
          </Field>
        </div>
      </FilterBar>

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Taxas pendentes" value={Number(summary.chargePending).toLocaleString('pt-BR')} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="B/Ls filtrados" value={summary.totalBls} />
          <MetricCard label="Maquinas" value={Number(summary.totalMachines).toLocaleString('pt-BR')} />
          <MetricCard label="Total de volumes" value={Number(summary.totalPackages).toLocaleString('pt-BR')} />
          <MetricCard label="Peso (ton)" value={Number(summary.totalWeightTon).toLocaleString('pt-BR')} />
          <MetricCard label="CBM (M3)" value={Number(summary.totalCbm).toLocaleString('pt-BR')} />
          <MetricCard label="Prontos para faturar" value={Number(summary.chargeReady).toLocaleString('pt-BR')} />
          <MetricCard label="Isentos" value={Number(summary.chargeExempt).toLocaleString('pt-BR')} />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar carga solta." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[1420px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">No. B/L</th>
                <th scope="col" className="px-4 py-3">CE</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Maquinas</th>
                <th scope="col" className="px-4 py-3">Volumes</th>
                <th scope="col" className="px-4 py-3">Total de volumes</th>
                <th scope="col" className="px-4 py-3">Peso (ton)</th>
                <th scope="col" className="px-4 py-3">CBM (M3)</th>
                <th scope="col" className="px-4 py-3">Shipper</th>
                <th scope="col" className="px-4 py-3">Consignee</th>
                <th scope="col" className="px-4 py-3">Notify</th>
                <th scope="col" className="px-4 py-3">Taxas locais</th>
                <th scope="col" className="px-4 py-3">Invoice</th>
                <th scope="col" className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={14}>
                    Carregando carga solta...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-0">
                    <EmptyState title="Nenhum B/L de carga solta encontrado." description="Importe um manifesto BB, importe os B/Ls do armador ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((bl) => (
                <tr key={bl.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-[#58a6ff]">{bl.id}</td>
                  <td className="px-4 py-3">{bl.ce_mercante ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--xl"
                      title={`${bl.voyage?.vessel?.name ?? '-'} / ${bl.voyage?.voyage_number ?? '-'}`}
                    >
                      {bl.voyage?.vessel?.name ?? '-'} / {bl.voyage?.voyage_number ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatBBNumber(bl.bb_machine_qty)}</td>
                  <td className="px-4 py-3">{formatBBNumber(bl.bb_packages_qty)}</td>
                  <td className="px-4 py-3">{formatBBNumber(bl.bb_packages_total)}</td>
                  <td className="px-4 py-3">
                    {formatBBNumber(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : null))}
                  </td>
                  <td className="px-4 py-3">{Number(bl.total_cbm ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--lg" title={bl.shipper ?? '-'}>
                      {bl.shipper ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--lg" title={bl.consignee ?? '-'}>
                      {bl.customer?.name ?? bl.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--lg" title={bl.notify_party ?? '-'}>
                      {bl.notify_party ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ChargeStatusBadge status={bl.charge_status} />
                  </td>
                  <td className="px-4 py-3">
                    <InvoiceLink links={invoiceLinksByBl?.[bl.id] ?? []} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="app-table__action"
                      to={`/manifestos/${bl.id}`}
                    >
                      Abrir B/L
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TableFooterPagination
          page={filters.page}
          pageSize={filters.pageSize}
          totalCount={data?.count ?? 0}
          totalPages={totalPages}
          countLabel={`${data?.count ?? 0} registros`}
          onPageChange={(page) => updateFilter('page', page)}
          onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
        />
      </Card>

      <CeMercanteImportModal open={ceMercanteOpen && canImport} onClose={() => setCeMercanteOpen(false)} />

      {blDocumentOpen && canImport ? <BlDocumentImportModal onClose={() => setBlDocumentOpen(false)} /> : null}

      {uploadOpen && canImport ? (
        <FileImportModal
          title="Importar Manifesto BB"
          accept=".xlsx,.xls,.csv"
          parser={parseBreakbulkManifestFile}
          importer={async (nextManifest, file) => {
            if (!user || !voyageId) return
            await importBreakbulkManifest({ filename: file.name, voyageId: Number(voyageId), manifest: nextManifest, uploadedBy: user.id })
            await afterManifestoImportado(queryClient, { voyageId })
            showToast('Manifesto BB importado com sucesso.', 'success')
            setVoyageId('')
          }}
          canImport={(nextManifest) => nextManifest.bls.length > 0}
          ready={Boolean(voyageId && user)}
          prerequisite={<VoyageCombobox required label="Viagem de destino" selectedVoyageId={voyageId} onSelect={(id) => setVoyageId(id == null ? '' : String(id))} />}
          renderPreview={(nextManifest) => <BreakbulkPreview manifest={nextManifest} />}
          helper={
            <div className="app-panel app-panel--padded text-sm">
              <div className="app-panel__title">Estrutura obrigatoria da planilha</div>
              <div className="mt-2">BL, CE, MAQUINAS, PACKAGES, PACKAGES TOTAL, WEIGHT (TON), CBM (M3), SHIPPER, CONSIGNEE, NOTIFY.</div>
              <div className="app-panel__meta mt-2">Colunas opcionais: CNPJ, POL, POD. O layout antigo por itens ainda e aceito para compatibilidade.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="app-btn app-btn--secondary" href="/templates/carga-solta-modelo.xlsx" download="carga-solta-modelo.xlsx"><Download size={16} />Baixar modelo .xlsx</a>
                <a className="app-btn app-btn--secondary" href="/templates/carga-solta-modelo.csv" download="carga-solta-modelo.csv"><Download size={16} />Baixar modelo .csv</a>
              </div>
            </div>
          }
          onClose={() => { setUploadOpen(false); setVoyageId('') }}
        />
      ) : null}

    </>
  )
}

function BreakbulkPreview({ manifest }: { manifest: ParsedBreakbulkManifest }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        <PreviewBox label="B/Ls validos" value={manifest.bls.length} variant="metric-strip" />
        <PreviewBox label="Maquinas" value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)} variant="metric-strip" />
        <PreviewBox label="Total de volumes" value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_packages_total ?? bl.bb_packages_qty ?? 0), 0)} variant="metric-strip" />
        <PreviewBox label="Peso (ton)" value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? bl.total_weight_kg / 1000 : 0)), 0)} variant="metric-strip" />
        <PreviewBox label="CBM (M3)" value={manifest.bls.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0)} variant="metric-strip" />
        <PreviewBox label="Erros de parser" value={manifest.rowErrors.length} variant="metric-strip" />
      </div>
      <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
        <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
          <thead><tr>{['BL', 'CE', 'Maquinas', 'Volumes', 'Total de volumes', 'Peso (ton)', 'CBM (M3)', 'Shipper', 'Consignee', 'Notify'].map((label) => <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr></thead>
          <tbody>{manifest.bls.slice(0, 25).map((bl) => <tr key={bl.bl_id}>
            <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{bl.bl_id}</td><td className="px-3 py-2">{bl.ce_mercante ?? '-'}</td><td className="px-3 py-2">{formatBBNumber(bl.bb_machine_qty)}</td><td className="px-3 py-2">{formatBBNumber(bl.bb_packages_qty)}</td><td className="px-3 py-2">{formatBBNumber(bl.bb_packages_total)}</td><td className="px-3 py-2">{formatBBNumber(bl.bb_weight_ton ?? (bl.total_weight_kg ? bl.total_weight_kg / 1000 : null))}</td><td className="px-3 py-2">{formatBBNumber(bl.total_cbm)}</td><td className="px-3 py-2">{bl.shipper ?? '-'}</td><td className="px-3 py-2">{bl.consignee ?? '-'}</td><td className="px-3 py-2">{bl.notify_party ?? '-'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <TruncationNote shown={25} total={manifest.bls.length} noun="B/L" nounPlural="B/Ls" />
      {manifest.rowErrors.length ? <div className="max-h-44 overflow-auto rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{manifest.rowErrors.slice(0, 12).map((item, index) => <div key={`${item.row}-${index}`}>Linha {item.row}: {item.message}</div>)}</div> : null}
    </div>
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



function formatBBNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return Number(value).toLocaleString('pt-BR')
}
