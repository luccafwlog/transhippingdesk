import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Download, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions, useVoyageOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { countDistinctContainerNumbers } from '../lib/containerCounts'
import { formatCnpjCpf } from '../lib/utils'
import { computeFileHash, DuplicateManifestImportError, importManifest, RateLimitImportError } from '../services/manifestImport'
import { countDistinctManifestContainers, parseManifestFile, type ParsedManifest } from '../services/manifestParser'
import { logOperationalEvent } from '../services/operationalEvents'

const pageSizes = [20, 50, 100]

export function Manifestos() {
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const [filters, setFilters] = useState<BlFilters>({
    search: '',
    voyageId: initialVoyage,
    cargoMode: 'container',
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

  return (
    <>
      <PageHeader
        title="Manifestos CNTR"
        description="Consulta paginada de B/Ls de container e importacao de planilhas. Cada manifesto registra seu proprio trecho POL/POD dentro da viagem e vincula clientes pela base cadastral."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to={filters.voyageId ? `/containers?voyage=${filters.voyageId}` : '/containers'}
            >
              <Boxes size={16} />
              Containers
            </Link>
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
              Importar Manifesto CNTR
            </Button>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-8">
          <Field label="Texto livre">
            <Input
              placeholder="B/L ou cliente"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </Field>
          <Field label="Viagem">
            <VoyageSelect value={filters.voyageId} onChange={(value) => updateFilter('voyageId', value)} />
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
              <option value="not_calculated">Nao calculado</option>
              <option value="calculated">Calculado</option>
              <option value="review_required">Revisao</option>
              <option value="reviewed">Revisado</option>
              <option value="ready_for_billing">Pronto faturar</option>
              <option value="exempt">Isento</option>
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
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        <SummaryCard label="B/Ls filtrados" value={isSummaryLoading ? '...' : summary?.totalBls ?? 0} />
        <SummaryCard label="CNTRS" value={isSummaryLoading ? '...' : summary?.totalDistinctContainers ?? 0} />
        <SummaryCard label="Pendentes revisao" value={isSummaryLoading ? '...' : summary?.pendingReview ?? 0} />
        <SummaryCard label="Sem faturamento" value={isSummaryLoading ? '...' : summary?.pendingFinancial ?? 0} />
        <SummaryCard label="Taxas pendentes" value={isSummaryLoading ? '...' : summary?.chargePending ?? 0} />
        <SummaryCard label="Pronto faturar" value={isSummaryLoading ? '...' : summary?.chargeReady ?? 0} />
        <SummaryCard label="Isentos" value={isSummaryLoading ? '...' : summary?.chargeExempt ?? 0} />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar manifestos." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[920px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">No. B/L</th>
                <th className="px-4 py-3">CE Mercante</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="w-[168px] px-4 py-3">CNEE</th>
                <th className="px-4 py-3">POL</th>
                <th className="px-4 py-3">POD</th>
                <th className="px-4 py-3">CNTRS</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Taxas locais</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    Carregando manifestos...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-0">
                    <EmptyState title="Nenhum B/L encontrado." description="Importe um manifesto ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((bl) => (
                <tr key={bl.id} className="hover:bg-[#21262d]/60">
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
                    <ProfileBadge
                      profile={getCargoProfile(
                        Boolean(bl.bl_containers?.some((container) => container.is_imo)),
                        Boolean(bl.bl_containers?.some((container) => container.is_oog)),
                      )}
                    />
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

      <UploadManifestModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CeMercanteImportModal open={ceMercanteOpen} onClose={() => setCeMercanteOpen(false)} />
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
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
      <div className="app-kpi-card__sub">Considera os filtros ativos desta tela.</div>
    </Card>
  )
}

function ProfileBadge({ profile }: { profile: ReturnType<typeof getCargoProfile> }) {
  const tone =
    profile === 'IMO/OOG' ? 'red' : profile === 'IMO' ? 'red' : profile === 'OOG' ? 'yellow' : 'blue'
  return <Badge tone={tone}>{profile}</Badge>
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

function ChargeStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'calculated':
      return <Badge tone="blue">Calculado</Badge>
    case 'review_required':
      return <Badge tone="yellow">Revisao</Badge>
    case 'reviewed':
      return <Badge tone="green">Revisado</Badge>
    case 'ready_for_billing':
      return <Badge tone="green">Pronto</Badge>
    case 'exempt':
      return <Badge tone="slate">Isento</Badge>
    default:
      return <Badge tone="slate">Nao calc.</Badge>
  }
}

function getCargoProfile(isImo: boolean, isOog: boolean) {
  if (isImo && isOog) return 'IMO/OOG'
  if (isImo) return 'IMO'
  if (isOog) return 'OOG'
  return 'Padrao'
}

function VoyageSelect({
  value,
  onChange,
  emptyLabel = 'Todas',
}: {
  value: string
  onChange: (value: string) => void
  emptyLabel?: string
}) {
  const { data } = useVoyageOptions()

  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {data?.map((voyage) => (
        <option key={voyage.id} value={voyage.id}>
          {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
        </option>
      ))}
    </Select>
  )
}

function UploadManifestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: voyages } = useVoyageOptions()
  const [voyageId, setVoyageId] = useState('')
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

  useEffect(() => {
    if (!open || voyageId || !voyages?.length) return

    if (voyages.length === 1) {
      setVoyageId(String(voyages[0].id))
    }
  }, [open, voyageId, voyages])

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
      showToast('Nao foi possivel ler o arquivo. Confira o formato .xlsx ou .csv.', 'error')
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
          results.push({ file: file.name, status: 'error', message: 'Preview nao carregado para este arquivo.' })
          continue
        }
        try {
          const fileHash = await computeFileHash(await file.arrayBuffer())
          await importManifestWithRetry({
            filename: file.name,
            voyageId: Number(voyageId),
            manifest,
            uploadedBy: user.id,
            fileHash: fileHash || null,
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
          results.push({ file: file.name, status: 'error', message: 'Falha ao importar manifesto.' })
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['bls'] })
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
        onClose()
        return
      } else if (successCount > 0) {
        setImportStatusMessage(`Importacao parcial: ${successCount} sucesso(s), ${errorCount} erro(s).`)
        showToast(`Importacao concluida com ${successCount} sucesso(s) e ${errorCount} erro(s).`, 'info')
      } else {
        setImportStatusMessage('Falha na importacao: nenhum manifesto foi importado.')
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
    <Modal open={open} onClose={onClose} title="Importar Manifesto CNTR">
      <div className="grid gap-5">
        <Field label="Viagem de destino">
          <VoyageSelect value={voyageId} onChange={setVoyageId} emptyLabel="Selecione uma viagem" />
        </Field>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setCreateVoyageOpen(true)}>
            Criar viagem agora
          </Button>
        </div>
        <Field label="Arquivos .xlsx ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" multiple onChange={handleFile} />
        </Field>

        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
          Clientes sao vinculados por CNPJ/CPF ja existente em <span className="font-semibold text-white">Clientes &gt; Importar base</span>.
          Manifestos nao criam novos cadastros automaticamente.
        </div>

        {parsing ? <div className="text-sm text-slate-400">Processando arquivo com SheetJS sob demanda...</div> : null}

        {files.length > 0 ? (
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
            {files.length} arquivo(s) selecionado(s). O preview detalhado abaixo mostra o arquivo {Math.min(previewIndex + 1, files.length)}.
          </div>
        ) : null}

        {primaryManifest ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
              <div className="text-xs uppercase tracking-wider text-slate-500">Trecho detectado no manifesto</div>
              <div className="mt-1 font-semibold text-white">{routeSummary.label}</div>
              <div className="mt-1 text-slate-400">
                A viagem agrupa navio e numero da viagem. O POL/POD permanece registrado nos B/Ls deste manifesto.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PreviewBox label="B/Ls" value={totals.bls} />
              <PreviewBox label="Ocorrencias CNTR" value={totals.containerOccurrences} />
              <PreviewBox label="Containers distintos" value={totals.containers} />
              <PreviewBox label="Pendentes revisao" value={totals.pending} />
            </div>

            {routeSummary.multipleRoutes ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                O arquivo trouxe mais de uma combinacao POL/POD. Revise o parsing antes de importar.
              </div>
            ) : null}

            <div className="max-h-72 overflow-auto rounded-xl border border-[#30363d]">
              <table className="app-table app-table--compact min-w-[720px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">B/L</th>
                    <th className="px-3 py-2">Consignatario</th>
                    <th className="px-3 py-2">CNPJ</th>
                    <th className="px-3 py-2">Containers distintos</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {primaryManifest.bls.slice(0, 25).map((bl) => (
                    <tr key={bl.id}>
                      <td className="px-3 py-2 font-semibold text-white">{bl.id}</td>
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

            {primaryManifest.rowErrors.length ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
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
            <div className="max-h-44 overflow-auto rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Resumo da importacao</div>
            <div className="grid gap-1">
              {importSummary.map((item) => (
                <div key={`${item.file}-${item.message}`} className={item.status === 'success' ? 'text-green-300' : 'text-red-300'}>
                  {item.status === 'success' ? 'OK' : 'ERRO'} | {item.file} | {item.message}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {importStatusMessage ? (
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-slate-200">
            {importStatusMessage}
          </div>
        ) : null}

        {files.length > 1 ? (
          <div className="flex items-center justify-between rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs text-slate-400">
            <span>
              Arquivo em preview: <span className="font-semibold text-white">{files[previewIndex]?.name ?? '-'}</span>
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

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!files.length || !voyageId} loading={submitting} onClick={handleImport}>
            Confirmar importacao
          </Button>
        </div>
        {!voyageId ? (
          <div className="text-sm text-amber-200">Selecione ou crie uma viagem de destino para habilitar a confirmacao.</div>
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
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
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
    return { label: 'Nao identificado', multipleRoutes: false }
  }

  if (routeLabels.length === 1) {
    return { label: routeLabels[0], multipleRoutes: false }
  }

  return { label: routeLabels.join(' | '), multipleRoutes: true }
}
