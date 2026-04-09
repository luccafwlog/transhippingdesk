import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Download, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions, useVoyageOptions } from '../hooks/useBls'
import { countDistinctContainerNumbers } from '../lib/containerCounts'
import { formatCnpjCpf } from '../lib/utils'
import { exportManifestWorkbook } from '../services/exports'
import { importManifest } from '../services/manifestImport'
import { countDistinctManifestContainers, parseManifestFile, type ParsedManifest } from '../services/manifestParser'

const pageSizes = [20, 50, 100]

export function Manifestos() {
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const [filters, setFilters] = useState<BlFilters>({
    search: '',
    voyageId: initialVoyage,
    pol: '',
    pod: '',
    reviewStatus: '',
    financialStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { showToast } = useToast()
  const { data, isLoading, error } = useBls(filters)
  const { data: summary, isLoading: isSummaryLoading } = useBlSummary(filters)
  const { data: portOptions } = usePortOptions()

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
        title="Manifestos"
        description="Consulta paginada de B/Ls e importacao de planilhas. Cada manifesto registra seu proprio trecho POL/POD dentro da viagem e vincula clientes pela base cadastral."
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
            <Button onClick={() => setUploadOpen(true)}>
              <Upload size={16} />
              Importar Manifesto
            </Button>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
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

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="B/Ls filtrados" value={isSummaryLoading ? '...' : summary?.totalBls ?? 0} />
        <SummaryCard label="CNTRS" value={isSummaryLoading ? '...' : summary?.totalDistinctContainers ?? 0} />
        <SummaryCard label="Pendentes revisao" value={isSummaryLoading ? '...' : summary?.pendingReview ?? 0} />
        <SummaryCard
          label="Sem faturamento"
          value={isSummaryLoading ? '...' : summary?.pendingFinancial ?? 0}
        />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? (
          <div className="p-5 text-sm text-red-200">Erro ao carregar manifestos. Verifique Supabase e migrations.</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">No. B/L</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="w-[84px] px-4 py-3">CNEE</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">POL</th>
                <th className="px-4 py-3">POD</th>
                <th className="px-4 py-3">CNTRS</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Revisao</th>
                <th className="px-4 py-3">Financeiro</th>
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
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    Nenhum B/L encontrado.
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
                  <td className="px-4 py-3">
                    {bl.voyage?.vessel?.name ?? '-'} / {bl.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block max-w-[84px] overflow-hidden text-clip whitespace-nowrap" title={bl.customer?.name ?? bl.consignee ?? '-'}>
                      {bl.customer?.name ?? bl.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatCnpjCpf(bl.customer?.cnpj_cpf)}</td>
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
                    <ReviewBadge status={bl.review_status ?? 'ok'} />
                  </td>
                  <td className="px-4 py-3">
                    <FinancialBadge status={bl.financial_status ?? 'pending'} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="inline-flex rounded-lg border border-[#1f6feb]/40 bg-[#1f6feb]/10 px-3 py-1.5 font-semibold text-[#8cc8ff] hover:bg-[#1f6feb]/20"
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

        <div className="flex flex-col justify-between gap-3 border-t border-[#30363d] p-4 text-sm text-slate-400 md:flex-row md:items-center">
          <span>
            Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros
          </span>
          <div className="flex items-center gap-2">
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
    </>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">Considera os filtros ativos desta tela.</div>
    </Card>
  )
}

function ProfileBadge({ profile }: { profile: ReturnType<typeof getCargoProfile> }) {
  const tone =
    profile === 'IMO/OOG' ? 'red' : profile === 'IMO' ? 'red' : profile === 'OOG' ? 'yellow' : 'blue'
  return <Badge tone={tone}>{profile}</Badge>
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
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<ParsedManifest | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createVoyageOpen, setCreateVoyageOpen] = useState(false)

  const totals = useMemo(
    () => ({
      bls: manifest?.bls.length ?? 0,
      containers: countDistinctManifestContainers(manifest),
      pending: manifest?.bls.filter((bl) => bl.review_status === 'pending_review').length ?? 0,
    }),
    [manifest],
  )
  const routeSummary = useMemo(() => summarizeManifestRoutes(manifest), [manifest])

  useEffect(() => {
    if (!open || voyageId || !voyages?.length) return

    if (voyages.length === 1) {
      setVoyageId(String(voyages[0].id))
    }
  }, [open, voyageId, voyages])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setManifest(null)

    if (!nextFile) return

    setParsing(true)
    try {
      setManifest(await parseManifestFile(nextFile))
      showToast('Preview do manifesto carregado.', 'success')
    } catch {
      showToast('Nao foi possivel ler o arquivo. Confira o formato .xlsx ou .csv.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!manifest || !file || !voyageId || !user) return

    setSubmitting(true)
    try {
      await importManifest({
        filename: file.name,
        voyageId: Number(voyageId),
        manifest,
        uploadedBy: user.id,
      })
      await queryClient.invalidateQueries({ queryKey: ['bls'] })
      await queryClient.invalidateQueries({ queryKey: ['voyages'] })
      showToast('Manifesto importado com sucesso.', 'success')
      onClose()
      setFile(null)
      setManifest(null)
      setVoyageId('')
    } catch {
      showToast('Falha ao importar manifesto. Verifique os dados e permissoes no Supabase.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Importar Manifesto">
      <div className="grid gap-5">
        <Field label="Viagem de destino">
          <VoyageSelect value={voyageId} onChange={setVoyageId} emptyLabel="Selecione uma viagem" />
        </Field>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setCreateVoyageOpen(true)}>
            Criar viagem agora
          </Button>
        </div>
        <Field label="Arquivo .xlsx ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>

        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
          Clientes sao vinculados por CNPJ/CPF ja existente em <span className="font-semibold text-white">Clientes &gt; Importar base</span>.
          Manifestos nao criam novos cadastros automaticamente.
        </div>

        {parsing ? <div className="text-sm text-slate-400">Processando arquivo com SheetJS sob demanda...</div> : null}

        {manifest ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
              <div className="text-xs uppercase tracking-wider text-slate-500">Trecho detectado no manifesto</div>
              <div className="mt-1 font-semibold text-white">{routeSummary.label}</div>
              <div className="mt-1 text-slate-400">
                A viagem agrupa navio e numero da viagem. O POL/POD permanece registrado nos B/Ls deste manifesto.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <PreviewBox label="B/Ls" value={totals.bls} />
              <PreviewBox label="Containers distintos" value={totals.containers} />
              <PreviewBox label="Pendentes revisao" value={totals.pending} />
            </div>

            {routeSummary.multipleRoutes ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                O arquivo trouxe mais de uma combinacao POL/POD. Revise o parsing antes de importar.
              </div>
            ) : null}

            <div className="max-h-72 overflow-auto rounded-xl border border-[#30363d]">
              <table className="w-full min-w-[720px] text-left text-sm">
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
                  {manifest.bls.slice(0, 25).map((bl) => (
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

            {manifest.rowErrors.length ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                {manifest.rowErrors.length} linha(s) com erro serao registradas em import_errors.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!manifest || !voyageId} loading={submitting} onClick={handleImport}>
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
        initialValues={manifest?.suggestedVoyage}
        note={
          manifest
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

function FinancialBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    invoiced: 'Faturado',
    paid: 'Pago',
    cancelled: 'Cancelado',
  }
  const tone = status === 'paid' ? 'green' : status === 'cancelled' ? 'red' : status === 'invoiced' ? 'blue' : 'yellow'
  return <Badge tone={tone}>{labels[status] ?? status}</Badge>
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
