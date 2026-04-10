import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useVehicleOptions, useVehicles, type VehiclePageFilters } from '../hooks/useVehicles'
import { formatDate } from '../lib/utils'
import { importVehicleRows, parseVehicleImportFile, type ParsedVehicleImport } from '../services/vehicleImport'

const pageSizes = [20, 50, 100]

export function Veiculos() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { data: options } = useVehicleOptions()
  const [selectedVesselId, setSelectedVesselId] = useState('')
  const [selectedVoyageId, setSelectedVoyageId] = useState('')
  const [filters, setFilters] = useState<VehiclePageFilters>({
    search: '',
    container: '',
    bl: '',
    page: 1,
    pageSize: 20,
  })
  const [importOpen, setImportOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsedImport, setParsedImport] = useState<ParsedVehicleImport | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importReport, setImportReport] = useState<{
    processed: number
    successCount: number
    errorCount: number
    errors: { row: number; message: string }[]
  } | null>(null)

  const vesselOptions = options?.vessels ?? []
  const voyageOptions = useMemo(
    () => (options?.voyages ?? []).filter((voyage) => String(voyage.vessel?.id ?? '') === selectedVesselId),
    [options?.voyages, selectedVesselId],
  )

  useEffect(() => {
    if (!selectedVoyageId) return
    const stillValid = voyageOptions.some((voyage) => String(voyage.id) === selectedVoyageId)
    if (!stillValid) {
      setSelectedVoyageId('')
    }
  }, [selectedVoyageId, voyageOptions])

  const voyageId = selectedVoyageId ? Number(selectedVoyageId) : null
  const { data, isLoading, error } = useVehicles(voyageId, filters)
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof VehiclePageFilters>(key: K, value: VehiclePageFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  function resetImportState() {
    setImportOpen(false)
    setFileName('')
    setParsedImport(null)
    setImportReport(null)
    setParsing(false)
    setImporting(false)
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setFileName(file?.name ?? '')
    setParsedImport(null)
    setImportReport(null)

    if (!file) return

    setParsing(true)
    try {
      const parsed = await parseVehicleImportFile(file)
      setParsedImport(parsed)
      showToast(
        parsed.rowErrors.length
          ? `Preview carregado com ${parsed.rows.length} linha(s) valida(s) e ${parsed.rowErrors.length} erro(s).`
          : `Preview carregado com ${parsed.rows.length} linha(s) valida(s).`,
        parsed.rowErrors.length ? 'info' : 'success',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao ler arquivo.'
      showToast(message, 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!voyageId || !parsedImport?.rows.length) return

    setImporting(true)
    try {
      const result = await importVehicleRows({ voyageId, rows: parsedImport.rows })
      setImportReport(result)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])

      showToast(
        `Importacao concluida: ${result.successCount} sucesso(s), ${result.errorCount} erro(s), ${result.processed} processado(s).`,
        result.errorCount ? 'info' : 'success',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao importar veiculos.'
      showToast(`Falha ao importar veiculos: ${message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Veiculos"
        description="Gestao e importacao de veiculos vinculados a viagem, containers e BLs."
        action={
          <Button variant="secondary" disabled={!voyageId} onClick={() => setImportOpen(true)}>
            <Upload size={16} />
            Importar Veiculos
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Navio">
            <Select value={selectedVesselId} onChange={(event) => setSelectedVesselId(event.target.value)}>
              <option value="">Selecione</option>
              {vesselOptions.map((vessel) => (
                <option key={vessel.id} value={vessel.id}>
                  {vessel.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Viagem">
            <Select
              disabled={!selectedVesselId}
              value={selectedVoyageId}
              onChange={(event) => setSelectedVoyageId(event.target.value)}
            >
              <option value="">{selectedVesselId ? 'Selecione' : 'Selecione um navio primeiro'}</option>
              {voyageOptions.map((voyage) => (
                <option key={voyage.id} value={voyage.id}>
                  {voyage.voyage_number}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!voyageId ? (
          <div className="mt-3 text-sm text-amber-200">Selecione uma viagem para habilitar listagem e importacao.</div>
        ) : null}
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Veiculos filtrados" value={isLoading ? '...' : data?.count ?? 0} />
        <MetricCard label="Containers distintos" value={isLoading ? '...' : data?.distinctContainerCount ?? 0} />
        <MetricCard label="BLs distintos" value={isLoading ? '...' : data?.distinctBlCount ?? 0} />
        <MetricCard label="Peso total (kg)" value={isLoading ? '...' : Number(data?.totalWeightKg ?? 0).toLocaleString('pt-BR')} />
      </div>

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Buscar por chassi">
            <Input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
          </Field>
          <Field label="Filtro por container">
            <Input value={filters.container} onChange={(event) => updateFilter('container', event.target.value)} />
          </Field>
          <Field label="Filtro por BL">
            <Input value={filters.bl} onChange={(event) => updateFilter('bl', event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar veiculos.</div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Chassi</th>
                <th className="px-4 py-3">Marca</th>
                <th className="px-4 py-3">Peso</th>
                <th className="px-4 py-3">Cubagem</th>
                <th className="px-4 py-3">Container</th>
                <th className="px-4 py-3">Tipo Container</th>
                <th className="px-4 py-3">Lacre</th>
                <th className="px-4 py-3">BL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                    Carregando veiculos...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                    Nenhum veiculo encontrado.
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{row.chassis}</td>
                  <td className="px-4 py-3">{row.brand}</td>
                  <td className="px-4 py-3">{Number(row.weight_kg).toLocaleString('pt-BR')} kg</td>
                  <td className="px-4 py-3">{Number(row.cbm).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3">{row.container?.container_number ?? '-'}</td>
                  <td className="px-4 py-3">{row.container?.type ?? '-'}</td>
                  <td className="px-4 py-3">{row.container?.seal_number ?? '-'}</td>
                  <td className="px-4 py-3">{row.bl?.id ?? '-'}</td>
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

      <Modal open={importOpen} onClose={resetImportState} title="Importar Veiculos">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Estrutura obrigatoria da planilha</div>
            <div className="mt-2">CHASSI, MARCA, PESO, CUBAGEM, CONTAINER, TIPO_CONTAINER, LACRE, BL.</div>
            <div className="mt-2 text-slate-400">
              Cada linha valida veiculo, container e BL antes da persistencia. Linhas invalidas sao rejeitadas individualmente.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/veiculos-modelo.xlsx"
                download="veiculos-modelo.xlsx"
              >
                <Download size={16} />
                Baixar modelo .xlsx
              </a>
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/veiculos-modelo.csv"
                download="veiculos-modelo.csv"
              >
                <Download size={16} />
                Baixar modelo .csv
              </a>
            </div>
          </div>

          <Field label="Arquivo .xlsx, .xls ou .csv">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFileChange} />
          </Field>

          {fileName ? <div className="text-sm text-slate-400">Arquivo selecionado: {fileName}</div> : null}
          {parsing ? <div className="text-sm text-slate-400">Lendo arquivo com SheetJS...</div> : null}

          {parsedImport ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="Linhas validas" value={parsedImport.rows.length} />
                <PreviewBox label="Erros de estrutura" value={parsedImport.rowErrors.length} />
                <PreviewBox label="Viagem selecionada" value={selectedVoyageId ? 1 : 0} />
              </div>

              <div className="max-h-72 overflow-auto rounded-xl border border-[#30363d]">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Chassi</th>
                      <th className="px-3 py-2">Marca</th>
                      <th className="px-3 py-2">Container</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Lacre</th>
                      <th className="px-3 py-2">BL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {parsedImport.rows.slice(0, 20).map((row) => (
                      <tr key={`${row.rowNumber}-${row.chassis}`}>
                        <td className="px-3 py-2 font-semibold text-white">{row.chassis}</td>
                        <td className="px-3 py-2">{row.brand}</td>
                        <td className="px-3 py-2">{row.container_number}</td>
                        <td className="px-3 py-2">{row.container_type}</td>
                        <td className="px-3 py-2">{row.seal_number}</td>
                        <td className="px-3 py-2">{row.bl_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsedImport.rowErrors.length ? (
                <div className="grid gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {parsedImport.rowErrors.slice(0, 8).map((rowError) => (
                    <div key={`${rowError.row}-${rowError.message}`}>
                      Linha {rowError.row}: {rowError.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {importReport ? (
            <div className="grid gap-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="Processados" value={importReport.processed} />
                <PreviewBox label="Sucesso" value={importReport.successCount} />
                <PreviewBox label="Erros" value={importReport.errorCount} />
              </div>
              {importReport.errors.length ? (
                <div className="max-h-48 overflow-auto rounded-xl border border-[#30363d] p-3 text-sm text-slate-300">
                  {importReport.errors.map((item) => (
                    <div key={`${item.row}-${item.message}`} className="border-b border-[#30363d] py-1 last:border-b-0">
                      Linha {item.row}: {item.message}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-emerald-200">Nenhum erro de integracao no lote importado.</div>
              )}
              <div className="text-xs text-slate-500">Atualizado em {formatDate(new Date().toISOString())}</div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetImportState}>
              Fechar
            </Button>
            <Button disabled={!voyageId || !parsedImport?.rows.length} loading={importing} onClick={handleImport}>
              Confirmar importacao
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  )
}
