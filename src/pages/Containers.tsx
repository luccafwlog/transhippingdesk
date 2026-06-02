import { useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, CalendarDays, Download } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { type ContainerFilters, fetchAllContainers, useContainers, usePortOptions, useVoyageOptions, useContainerTypeOptions } from '../hooks/useBls'
import {
  importContainerFlagsRows,
  parseContainerFlagsImportFile,
  type ParsedContainerFlagsImport,
} from '../services/containerFlagsImport'

const pageSizes = [20, 50, 100]

export function Containers() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const { showToast } = useToast()
  const { user } = useAuth()
  const [filters, setFilters] = useState<ContainerFilters>({
    search: '',
    voyageId: initialVoyage,
    cargoMode: 'container',
    pol: '',
    pod: '',
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    containerType: '',
    page: 1,
    pageSize: 20,
  })
  const [exporting, setExporting] = useState(false)
  const [datesImportOpen, setDatesImportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [flagsFileName, setFlagsFileName] = useState('')
  const [parsedFlags, setParsedFlags] = useState<ParsedContainerFlagsImport | null>(null)
  const [parsingFlags, setParsingFlags] = useState(false)
  const [importingFlags, setImportingFlags] = useState(false)
  const { data, isLoading, error } = useContainers(filters)
  const { data: portOptions } = usePortOptions()
  const { data: typeOptions } = useContainerTypeOptions()

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof ContainerFilters>(key: K, value: ContainerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = (
    ['search', 'voyageId', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile', 'containerType'] as (keyof ContainerFilters)[]
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
      cargoProfile: '',
      containerType: '',
      page: 1,
    }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllContainers(filters)
      if (!rows.length) {
        showToast('Nenhum container encontrado para exportar com os filtros atuais.', 'info')
        return
      }

      const { exportContainerWorkbook } = await import('../services/exports')
      await exportContainerWorkbook(rows)
      showToast(`Exportacao concluida com ${rows.length} container(es).`, 'success')
    } catch {
      showToast('Falha ao exportar containers.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleFlagsFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFlagsFileName(nextFile?.name ?? '')
    setParsedFlags(null)

    if (!nextFile) return

    setParsingFlags(true)
    try {
      const parsed = await parseContainerFlagsImportFile(nextFile)
      setParsedFlags(parsed)
      showToast(
        parsed.rowErrors.length
          ? `Planilha lida com ${parsed.rows.length} linha(s) valida(s) e ${parsed.rowErrors.length} ignorada(s).`
          : `Planilha lida com ${parsed.rows.length} linha(s) valida(s).`,
        parsed.rowErrors.length ? 'info' : 'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler a planilha.'
      showToast(message, 'error')
    } finally {
      setParsingFlags(false)
    }
  }

  async function handleImportFlags() {
    if (!parsedFlags?.rows.length) return

    setImportingFlags(true)
    try {
      const result = await importContainerFlagsRows(parsedFlags.rows, user?.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])

      showToast(
        `Atualizacao concluida: ${result.updated} linha(s) aplicada(s), ${result.unchanged} sem mudanca e ${result.missing} sem match no sistema.`,
        'success',
      )
      resetImportModal()
    } catch {
      showToast('Falha ao atualizar flags de IMO/OOG.', 'error')
    } finally {
      setImportingFlags(false)
    }
  }

  function resetImportModal() {
    setImportOpen(false)
    setFlagsFileName('')
    setParsedFlags(null)
    setParsingFlags(false)
    setImportingFlags(false)
  }

  return (
    <>
      <PageHeader
        title="Containers"
        description="Lista consolidada dos containers importados via manifestos. O total distinto considera o numero do container, mesmo quando ele aparece em mais de um B/L."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDatesImportOpen(true)}>
              <CalendarDays size={16} />
              Importar Datas Demurrage
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Importar IMO/OOG
            </Button>
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar Containers
            </Button>
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to="/manifestos"
            >
              <Boxes size={16} />
              Voltar aos Manifestos
            </Link>
          </div>
        }
      />

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Texto livre">
            <Input
              placeholder="Container, B/L, cliente ou navio"
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
          <Field label="Status revisao do B/L">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
            </Select>
          </Field>
          <Field label="Status financeiro do B/L">
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
              <option value="not_calculated">Não calculado</option>
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
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
          <Field label="Tipo de container">
            <Select value={filters.containerType ?? ''} onChange={(event) => updateFilter('containerType', event.target.value)}>
              <option value="">Todos</option>
              {typeOptions?.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FilterBar>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Registros filtrados" value={isLoading ? '...' : data?.count ?? 0} />
        <SummaryCard label="Containers distintos" value={isLoading ? '...' : data?.distinctCount ?? 0} />
        <SummaryCard label="B/Ls envolvidos" value={isLoading ? '...' : data?.blCount ?? 0} />
        <SummaryCard label="OOG distintos" value={isLoading ? '...' : data?.oogDistinctCount ?? 0} />
        <SummaryCard label="IMO distintos" value={isLoading ? '...' : data?.imoDistinctCount ?? 0} />
      </div>

      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-slate-400">Resumo por tipo</div>
            <div className="mt-1 text-xs text-slate-500">Conta containers distintos por tipo com base nos filtros ativos.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isLoading ? (
              <span className="text-sm text-slate-400">Carregando tipos...</span>
            ) : data?.typeSummary.length ? (
              data.typeSummary.map((item) => (
                <div key={item.type} className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm">
                  <span className="font-semibold text-white">{item.type}</span>
                  <span className="ml-2 text-slate-400">{item.distinctCount}</span>
                </div>
              ))
            ) : (
              <span className="text-sm text-slate-400">Nenhum tipo encontrado.</span>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar containers." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[1060px] border-collapse text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="w-[84px] px-4 py-3">CNEE</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">POL</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Perfil</th>
                <th scope="col" className="px-4 py-3">Taxas locais</th>
                <th scope="col" className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    Carregando containers...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <EmptyState title="Nenhum container encontrado." description="Ajuste os filtros de viagem ou POD." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((container) => (
                <tr key={container.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{container.container_number}</td>
                  <td className="px-4 py-3">
                    <Link className="text-[#58a6ff] hover:underline" to={`/manifestos/${container.bl?.id}`}>
                      {container.bl?.id ?? '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--xs"
                      title={container.bl?.customer?.name ?? container.bl?.consignee ?? '-'}
                    >
                      {container.bl?.customer?.name ?? container.bl?.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--xl"
                      title={`${container.bl?.voyage?.vessel?.name ?? '-'} / ${container.bl?.voyage?.voyage_number ?? '-'}`}
                    >
                      {container.bl?.voyage?.vessel?.name ?? '-'} / {container.bl?.voyage?.voyage_number ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{container.bl?.pol ?? '-'}</td>
                  <td className="px-4 py-3">{container.bl?.pod ?? '-'}</td>
                  <td className="px-4 py-3">{container.type ?? '-'}</td>
                  <td className="px-4 py-3">
                    <ProfileBadge profile={getCargoProfile(Boolean(container.is_imo), Boolean(container.is_oog))} />
                  </td>
                  <td className="px-4 py-3">
                    <ChargeStatusBadge status={container.bl?.charge_status ?? null} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="app-table__action"
                      to={`/manifestos/${container.bl?.id}`}
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
            Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros · {data?.distinctCount ?? 0} containers distintos
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

      <ContainerDatesImportModal open={datesImportOpen} onClose={() => setDatesImportOpen(false)} />

      <Modal open={importOpen} onClose={resetImportModal} title="Importar Flags de IMO/OOG">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Uso do arquivo</div>
            <div className="mt-2">
              Esta planilha atualiza containers existentes com base na combinacao <span className="font-semibold text-white">B/L + Container</span>.
            </div>
            <div className="mt-2">
              As colunas obrigatorias sao <span className="font-semibold text-white">Container</span>, <span className="font-semibold text-white">BL</span>, <span className="font-semibold text-white">IMO</span> e <span className="font-semibold text-white">OOG</span>.
            </div>
            <div className="mt-2 text-slate-400">
              Em <span className="font-semibold text-white">IMO</span>, informe a classe ou o texto completo do IMO. Se deixar em branco, o sistema entende que o container não é IMO. Em <span className="font-semibold text-white">OOG</span>, use apenas Sim ou Não.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/imo-oog-modelo.xlsx"
                download="imo-oog-modelo.xlsx"
              >
                <Download size={16} />
                Baixar modelo .xlsx
              </a>
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/imo-oog-modelo.csv"
                download="imo-oog-modelo.csv"
              >
                <Download size={16} />
                Baixar modelo .csv
              </a>
            </div>
          </div>

          <Field label="Arquivo .xlsx, .xls ou .csv">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFlagsFile} />
          </Field>

          {flagsFileName ? <div className="text-sm text-slate-400">Arquivo selecionado: {flagsFileName}</div> : null}
          {parsingFlags ? <div className="text-sm text-slate-400">Lendo planilha com SheetJS...</div> : null}

          {parsedFlags ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="Linhas validas" value={parsedFlags.rows.length} />
                <PreviewBox label="Linhas ignoradas" value={parsedFlags.rowErrors.length} />
                <PreviewBox label="Atualizações previstas" value={parsedFlags.rows.length} />
              </div>

              <div className="app-table-scroll max-h-72 rounded-xl border border-[#30363d]">
                <table className="app-table app-table--compact min-w-[680px] text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">BL</th>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">IMO</th>
                      <th scope="col" className="px-3 py-2">OOG</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {parsedFlags.rows.slice(0, 20).map((row) => (
                      <tr key={`${row.bl_id}-${row.container_number}`}>
                        <td className="px-3 py-2 font-semibold text-white">{row.bl_id}</td>
                        <td className="px-3 py-2">{row.container_number}</td>
                        <td className="px-3 py-2">{row.imo_value ?? '-'}</td>
                        <td className="px-3 py-2">{row.is_oog ? 'Sim' : 'Nao'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsedFlags.rowErrors.length ? (
                <div className="grid gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {parsedFlags.rowErrors.slice(0, 8).map((rowError) => (
                    <div key={`${rowError.row}-${rowError.message}`}>
                      Linha {rowError.row}: {rowError.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetImportModal}>
              Cancelar
            </Button>
            <Button disabled={!parsedFlags?.rows.length} loading={importingFlags} onClick={handleImportFlags}>
              Atualizar containers
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  const tone =
    label === 'IMO distintos'
      ? 'gold'
      : label === 'OOG distintos'
        ? 'green'
        : label === 'B/Ls envolvidos'
          ? 'navy'
          : 'blue'

  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
      <div className="app-kpi-card__sub">Considera os filtros ativos desta tela.</div>
    </Card>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

function ProfileBadge({ profile }: { profile: ReturnType<typeof getCargoProfile> }) {
  const tone =
    profile === 'IMO/OOG' ? 'red' : profile === 'IMO' ? 'red' : profile === 'OOG' ? 'yellow' : 'blue'
  return <Badge tone={tone}>{profile}</Badge>
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
      return <Badge tone="slate">Não calc.</Badge>
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
