import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { fetchAllBls, type BlFilters, useBls, usePortOptions, useVoyageOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { formatDate } from '../lib/utils'
import { importBreakbulkManifest, parseBreakbulkManifestFile, type ParsedBreakbulkManifest } from '../services/breakbulkImport'
import type { BLListItem } from '../types/database'

const pageSizes = [20, 50, 100]

export function CargaSolta() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: voyageOptions } = useVoyageOptions()
  const { data: portOptions } = usePortOptions()
  const [filters, setFilters] = useState<BlFilters>({
    search: '',
    voyageId: '',
    cargoMode: 'carga_solta',
    pol: '',
    pod: '',
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [voyageId, setVoyageId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<ParsedBreakbulkManifest | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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
    return {
      totalBls: rows.length,
      totalMachines,
      totalPackages,
      totalWeightTon,
      totalCbm,
      chargePending: rows.filter((row) => row.charge_status === 'review_required' || row.charge_status === 'not_calculated').length,
      chargeReady: rows.filter((row) => row.charge_status === 'ready_for_billing').length,
      chargeExempt: rows.filter((row) => row.charge_status === 'exempt').length,
    }
  }, [summaryRows])

  function updateFilter<K extends keyof BlFilters>(key: K, value: BlFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
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
      showToast(`Exportacao concluida com ${rows.length} B/L(s) BB.`, 'success')
    } catch {
      showToast('Falha ao exportar manifestos BB.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setManifest(null)

    if (!nextFile) return

    setParsing(true)
    try {
      setManifest(await parseBreakbulkManifestFile(nextFile))
      showToast('Preview do manifesto BB carregado.', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível ler o arquivo.'
      showToast(message, 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!manifest || !file || !voyageId || !user) return

    setSubmitting(true)
    try {
      await importBreakbulkManifest({
        filename: file.name,
        voyageId: Number(voyageId),
        manifest,
        uploadedBy: user.id,
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['port-options'] }),
      ])

      showToast('Manifesto BB importado com sucesso.', 'success')
      setUploadOpen(false)
      setVoyageId('')
      setFile(null)
      setManifest(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao importar manifesto BB.'
      showToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Manifestos BB"
        description="Consulta paginada de B/Ls break bulk no layout operacional atual da planilha BB."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar
            </Button>
            <Button variant="secondary" onClick={() => setCeMercanteOpen(true)}>
              <Upload size={16} />
              Importar CE Mercante
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload size={16} />
              Importar Manifesto BB
            </Button>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <Field label="Texto livre">
            <Input
              placeholder="B/L ou consignatario"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </Field>
          <Field label="Viagem">
            <Select value={filters.voyageId} onChange={(event) => updateFilter('voyageId', event.target.value)}>
              <option value="">Todas</option>
              {voyageOptions?.map((voyage) => (
                <option key={voyage.id} value={voyage.id}>
                  {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                </option>
              ))}
            </Select>
          </Field>
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
              <option value="not_calculated">Não calculado</option>
              <option value="calculated">Calculado</option>
              <option value="review_required">Revisao</option>
              <option value="reviewed">Revisado</option>
              <option value="ready_for_billing">Pronto faturar</option>
              <option value="exempt">Isento</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-8">
        <SummaryCard label="B/Ls filtrados" value={summary.totalBls} />
        <SummaryCard label="Maquinas" value={Number(summary.totalMachines).toLocaleString('pt-BR')} />
        <SummaryCard label="Packages Total" value={Number(summary.totalPackages).toLocaleString('pt-BR')} />
        <SummaryCard label="Weight (Ton)" value={Number(summary.totalWeightTon).toLocaleString('pt-BR')} />
        <SummaryCard label="CBM (M3)" value={Number(summary.totalCbm).toLocaleString('pt-BR')} />
        <SummaryCard label="Taxas pendentes" value={Number(summary.chargePending).toLocaleString('pt-BR')} />
        <SummaryCard label="Pronto faturar" value={Number(summary.chargeReady).toLocaleString('pt-BR')} />
        <SummaryCard label="Isentos" value={Number(summary.chargeExempt).toLocaleString('pt-BR')} />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar carga solta." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1420px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">No. B/L</th>
                <th scope="col" className="px-4 py-3">CE</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Maquinas</th>
                <th scope="col" className="px-4 py-3">Packages</th>
                <th scope="col" className="px-4 py-3">Packages Total</th>
                <th scope="col" className="px-4 py-3">Weight (Ton)</th>
                <th scope="col" className="px-4 py-3">CBM (M3)</th>
                <th scope="col" className="px-4 py-3">Shipper</th>
                <th scope="col" className="px-4 py-3">Consignee</th>
                <th scope="col" className="px-4 py-3">Notify</th>
                <th scope="col" className="px-4 py-3">Taxas locais</th>
                <th scope="col" className="px-4 py-3">Invoice</th>
                <th scope="col" className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={14}>
                    Carregando carga solta...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-0">
                    <EmptyState title="Nenhum B/L de carga solta encontrado." description="Importe um manifesto BB ou ajuste os filtros." />
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

        <div className="app-table__footer">
          <span>
            Pagina {filters.page} de {totalPages} - {data?.count ?? 0} registros
          </span>
          <div className="app-table__footer-controls">
            <Select className="w-28" value={filters.pageSize} onChange={(event) => updateFilter('pageSize', Number(event.target.value))}>
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

      <CeMercanteImportModal open={ceMercanteOpen} onClose={() => setCeMercanteOpen(false)} />

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Importar Manifesto BB">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Estrutura obrigatoria da planilha</div>
            <div className="mt-2">
              BL, CE, MAQUINAS, PACKAGES, PACKAGES TOTAL, WEIGHT (TON), CBM (M3), SHIPPER, CONSIGNEE, NOTIFY.
            </div>
            <div className="mt-2 text-slate-400">
              Colunas opcionais: CNPJ, POL, POD. O layout antigo por itens ainda e aceito para compatibilidade, mas
              o padrao operacional agora e resumido por BL.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/carga-solta-modelo.xlsx"
                download="carga-solta-modelo.xlsx"
              >
                <Download size={16} />
                Baixar modelo .xlsx
              </a>
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/carga-solta-modelo.csv"
                download="carga-solta-modelo.csv"
              >
                <Download size={16} />
                Baixar modelo .csv
              </a>
            </div>
          </div>

          <Field label="Viagem de destino">
            <Select value={voyageId} onChange={(event) => setVoyageId(event.target.value)}>
              <option value="">Selecione uma viagem</option>
              {voyageOptions?.map((voyage) => (
                <option key={voyage.id} value={voyage.id}>
                  {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Arquivo .xlsx, .xls ou .csv">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
          </Field>

          {file ? <div className="text-sm text-slate-400">Arquivo selecionado: {file.name}</div> : null}
          {parsing ? <div className="text-sm text-slate-400">Processando arquivo...</div> : null}

          {manifest ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="B/Ls validos" value={manifest.bls.length} />
                <PreviewBox
                  label="Maquinas"
                  value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)}
                />
                <PreviewBox
                  label="Packages Total"
                  value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_packages_total ?? bl.bb_packages_qty ?? 0), 0)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox
                  label="Weight (Ton)"
                  value={manifest.bls.reduce(
                    (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? bl.total_weight_kg / 1000 : 0)),
                    0,
                  )}
                />
                <PreviewBox
                  label="CBM (M3)"
                  value={manifest.bls.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0)}
                />
                <PreviewBox label="Erros de parser" value={manifest.rowErrors.length} />
              </div>

              <div className="app-table-scroll max-h-72 rounded-xl border border-[#30363d]">
                <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">BL</th>
                      <th scope="col" className="px-3 py-2">CE</th>
                      <th scope="col" className="px-3 py-2">Maquinas</th>
                      <th scope="col" className="px-3 py-2">Packages</th>
                      <th scope="col" className="px-3 py-2">Packages Total</th>
                      <th scope="col" className="px-3 py-2">Weight (Ton)</th>
                      <th scope="col" className="px-3 py-2">CBM (M3)</th>
                      <th scope="col" className="px-3 py-2">Shipper</th>
                      <th scope="col" className="px-3 py-2">Consignee</th>
                      <th scope="col" className="px-3 py-2">Notify</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {manifest.bls.slice(0, 25).map((bl) => (
                      <tr key={bl.bl_id}>
                        <td className="px-3 py-2 font-semibold text-white">{bl.bl_id}</td>
                        <td className="px-3 py-2">{bl.ce_mercante ?? '-'}</td>
                        <td className="px-3 py-2">{formatBBNumber(bl.bb_machine_qty)}</td>
                        <td className="px-3 py-2">{formatBBNumber(bl.bb_packages_qty)}</td>
                        <td className="px-3 py-2">{formatBBNumber(bl.bb_packages_total)}</td>
                        <td className="px-3 py-2">
                          {formatBBNumber(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : null))}
                        </td>
                        <td className="px-3 py-2">{formatBBNumber(bl.total_cbm)}</td>
                        <td className="px-3 py-2">
                          <span className="app-table__truncate app-table__truncate--lg" title={bl.shipper ?? '-'}>
                            {bl.shipper ?? '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="app-table__truncate app-table__truncate--lg" title={bl.consignee ?? '-'}>
                            {bl.consignee ?? '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="app-table__truncate app-table__truncate--lg" title={bl.notify_party ?? '-'}>
                            {bl.notify_party ?? '-'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {manifest.rowErrors.length ? (
                <div className="max-h-44 overflow-auto rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {manifest.rowErrors.slice(0, 12).map((item, index) => (
                    <div key={`${item.row}-${index}`}>Linha {item.row}: {item.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={!manifest || !voyageId || !user} loading={submitting} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>

          <div className="text-xs text-slate-500">Atualizado em {formatDate(new Date().toISOString())}</div>
        </div>
      </Modal>
    </>
  )
}

function InvoiceLink({
  links,
}: {
  links: Array<{ id: number; invoice_number: string | null; status: string | null }>
}) {
  if (!links.length) {
    return <span className="text-xs text-slate-500">-</span>
  }

  const latest = links[0]
  const label = latest.invoice_number ?? `INV-${latest.id}`
  return (
    <Link className="text-[#58a6ff] hover:underline" to={`/faturamento?invoice=${latest.id}`}>
      {label}
    </Link>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  const tone =
    label === 'Weight (Ton)'
      ? 'gold'
      : label === 'CBM (M3)'
        ? 'green'
        : label === 'Packages Total'
          ? 'blue'
          : 'navy'

  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
    </Card>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{formatBBNumber(value)}</div>
    </div>
  )
}

function formatBBNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return Number(value).toLocaleString('pt-BR')
}

function ChargeStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'calculated':
      return <span className="app-badge app-badge--blue">Calculado</span>
    case 'review_required':
      return <span className="app-badge app-badge--yellow">Revisao</span>
    case 'reviewed':
      return <span className="app-badge app-badge--green">Revisado</span>
    case 'ready_for_billing':
      return <span className="app-badge app-badge--green">Pronto</span>
    case 'exempt':
      return <span className="app-badge app-badge--slate">Isento</span>
    default:
      return <span className="app-badge app-badge--slate">Não calc.</span>
  }
}
