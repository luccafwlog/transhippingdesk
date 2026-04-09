import { useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Download } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { type ContainerFilters, fetchAllContainers, useContainers, usePortOptions, useVoyageOptions } from '../hooks/useBls'
import { formatCnpjCpf } from '../lib/utils'
import {
  importContainerFlagsRows,
  parseContainerFlagsImportFile,
  type ParsedContainerFlagsImport,
} from '../services/containerFlagsImport'
import { exportContainerWorkbook } from '../services/exports'

const pageSizes = [20, 50, 100]

export function Containers() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const { showToast } = useToast()
  const [filters, setFilters] = useState<ContainerFilters>({
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
  const [exporting, setExporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [flagsFileName, setFlagsFileName] = useState('')
  const [parsedFlags, setParsedFlags] = useState<ParsedContainerFlagsImport | null>(null)
  const [parsingFlags, setParsingFlags] = useState(false)
  const [importingFlags, setImportingFlags] = useState(false)
  const { data, isLoading, error } = useContainers(filters)
  const { data: portOptions } = usePortOptions()

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof ContainerFilters>(key: K, value: ContainerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllContainers(filters)
      if (!rows.length) {
        showToast('Nenhum container encontrado para exportar com os filtros atuais.', 'info')
        return
      }

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
      const message = error instanceof Error ? error.message : 'Nao foi possivel ler a planilha.'
      showToast(message, 'error')
    } finally {
      setParsingFlags(false)
    }
  }

  async function handleImportFlags() {
    if (!parsedFlags?.rows.length) return

    setImportingFlags(true)
    try {
      const result = await importContainerFlagsRows(parsedFlags.rows)
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

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
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
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Registros filtrados" value={isLoading ? '...' : data?.count ?? 0} />
        <SummaryCard label="Containers distintos" value={isLoading ? '...' : data?.distinctCount ?? 0} />
        <SummaryCard label="B/Ls envolvidos" value={isLoading ? '...' : data?.blCount ?? 0} />
        <SummaryCard label="OOG distintos" value={isLoading ? '...' : data?.oogDistinctCount ?? 0} />
        <SummaryCard label="IMO distintos" value={isLoading ? '...' : data?.imoDistinctCount ?? 0} />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar containers.</div> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1460px] border-collapse text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Container</th>
                <th className="px-4 py-3">B/L</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="px-4 py-3">POL</th>
                <th className="px-4 py-3">POD</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Seal</th>
                <th className="px-4 py-3">Peso bruto</th>
                <th className="px-4 py-3">CBM</th>
                <th className="px-4 py-3">IMO</th>
                <th className="px-4 py-3">OOG</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={15} className="px-4 py-8 text-center text-slate-400">
                    Carregando containers...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-8 text-center text-slate-400">
                    Nenhum container encontrado.
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
                  <td className="px-4 py-3">{container.bl?.customer?.name ?? container.bl?.consignee ?? '-'}</td>
                  <td className="px-4 py-3">{formatCnpjCpf(container.bl?.customer?.cnpj_cpf)}</td>
                  <td className="px-4 py-3">
                    {container.bl?.voyage?.vessel?.name ?? '-'} / {container.bl?.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">{container.bl?.pol ?? '-'}</td>
                  <td className="px-4 py-3">{container.bl?.pod ?? '-'}</td>
                  <td className="px-4 py-3">{container.type ?? '-'}</td>
                  <td className="px-4 py-3">{container.seal_number ?? '-'}</td>
                  <td className="px-4 py-3">{Number(container.gross_weight_kg ?? 0).toLocaleString('pt-BR')} kg</td>
                  <td className="px-4 py-3">{Number(container.cbm ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <Badge tone={container.is_imo ? 'red' : 'slate'}>{container.is_imo ? 'SIM' : 'NAO'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={container.is_oog ? 'yellow' : 'slate'}>{container.is_oog ? 'SIM' : 'NAO'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {container.is_oog ? <Badge tone="yellow">OOG</Badge> : null}
                      {container.is_imo ? <Badge tone="red">IMO</Badge> : null}
                      {!container.is_oog && !container.is_imo ? <Badge tone="blue">Standard</Badge> : null}
                    </div>
                    {container.is_imo && (container.imo_class || container.un_number) ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {container.imo_class ?? '-'} / {container.un_number ?? '-'}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="inline-flex rounded-lg border border-[#1f6feb]/40 bg-[#1f6feb]/10 px-3 py-1.5 font-semibold text-[#8cc8ff] hover:bg-[#1f6feb]/20"
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

        <div className="flex flex-col justify-between gap-3 border-t border-[#30363d] p-4 text-sm text-slate-400 md:flex-row md:items-center">
          <span>
            Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros · {data?.distinctCount ?? 0} containers distintos
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
              Em <span className="font-semibold text-white">IMO</span>, informe a classe ou o texto completo do IMO. Se deixar em branco, o sistema entende que o container nao e IMO. Em <span className="font-semibold text-white">OOG</span>, use apenas Sim ou Nao.
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
                <PreviewBox label="Atualizacoes previstas" value={parsedFlags.rows.length} />
              </div>

              <div className="max-h-72 overflow-auto rounded-xl border border-[#30363d]">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">BL</th>
                      <th className="px-3 py-2">Container</th>
                      <th className="px-3 py-2">IMO</th>
                      <th className="px-3 py-2">OOG</th>
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
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">Considera os filtros ativos desta tela.</div>
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
