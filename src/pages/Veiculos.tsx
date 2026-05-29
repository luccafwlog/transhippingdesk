import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
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
  const [importVoyageId, setImportVoyageId] = useState('')
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
  const allVoyageOptions = useMemo(() => options?.voyages ?? [], [options?.voyages])
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

  useEffect(() => {
    if (!importOpen) return

    if (selectedVoyageId && !importVoyageId) {
      setImportVoyageId(selectedVoyageId)
      return
    }

    if (!selectedVoyageId && !importVoyageId && allVoyageOptions.length === 1) {
      setImportVoyageId(String(allVoyageOptions[0].id))
    }
  }, [importOpen, importVoyageId, selectedVoyageId, allVoyageOptions])

  const voyageId = selectedVoyageId ? Number(selectedVoyageId) : null
  const importTargetVoyageId = importVoyageId ? Number(importVoyageId) : null
  const { data, isLoading, error } = useVehicles(voyageId, filters)
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof VehiclePageFilters>(key: K, value: VehiclePageFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = (['search', 'container', 'bl'] as (keyof VehiclePageFilters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length

  function clearFilters() {
    setFilters((current) => ({ ...current, search: '', container: '', bl: '', page: 1 }))
  }

  function resetImportState() {
    setImportOpen(false)
    setImportVoyageId('')
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
    if (!importTargetVoyageId || !parsedImport?.rows.length) return

    setImporting(true)
    try {
      const result = await importVehicleRows({ voyageId: importTargetVoyageId, rows: parsedImport.rows })
      setImportReport(result)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])

      showToast(
        `Importacao concluida: ${result.successCount} sucesso(s), ${result.errorCount} erro(s), ${result.processed} processado(s).`,
        result.errorCount ? 'info' : 'success',
      )
      if (!result.errorCount) {
        resetImportState()
      }
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
        description="Gestão e importação de veículos vinculados a viagem, containers e BLs."
        action={
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
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
          <div className="mt-3 text-sm text-amber-200">
            Selecione uma viagem apenas para visualização da lista. A importação usa o seletor próprio dentro do modal.
          </div>
        ) : null}
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Veiculos filtrados" value={isLoading ? '...' : data?.count ?? 0} />
        <MetricCard label="Containers distintos" value={isLoading ? '...' : data?.distinctContainerCount ?? 0} />
        <MetricCard label="BLs distintos" value={isLoading ? '...' : data?.distinctBlCount ?? 0} />
        <MetricCard label="Peso total (kg)" value={isLoading ? '...' : Number(data?.totalWeightKg ?? 0).toLocaleString('pt-BR')} />
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-3">
        <BreakdownCard
          title="Veiculos por marca"
          loading={isLoading}
          items={data?.vehiclesByBrand ?? []}
          emptyLabel="Nenhuma marca no filtro."
        />
        <BreakdownCard
          title="Veiculos por tipo de container"
          loading={isLoading}
          items={data?.vehiclesByContainerType ?? []}
          emptyLabel="Nenhum tipo no filtro."
        />
        <BreakdownCard
          title="Containers por tipo de container"
          loading={isLoading}
          items={data?.containersByContainerType ?? []}
          emptyLabel="Nenhum container no filtro."
        />
      </div>

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
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
      </FilterBar>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar veiculos." /> : null}
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Chassi</th>
                <th scope="col" className="px-4 py-3">Marca</th>
                <th scope="col" className="px-4 py-3">Modelo</th>
                <th scope="col" className="px-4 py-3">Peso</th>
                <th scope="col" className="px-4 py-3">Cubagem</th>
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">Tipo Container</th>
                <th scope="col" className="px-4 py-3">Lacre</th>
                <th scope="col" className="px-4 py-3">BL</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={9}>
                    Carregando veiculos...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={9} className="p-0">
                    <EmptyState title="Nenhum veiculo encontrado." description="Importe uma planilha de veiculos ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.chassis}</td>
                  <td className="px-4 py-3">{row.brand}</td>
                  <td className="px-4 py-3">{row.model}</td>
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

        <div className="app-table__footer">
          <span>
            Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros
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

      <Modal open={importOpen} onClose={resetImportState} title="Importar Veiculos">
        <div className="grid gap-5">
          <div className="app-panel app-panel--padded text-sm">
            <div className="app-panel__title">Estrutura obrigatoria da planilha</div>
            <div className="mt-2">CHASSI, MARCA, MODELO, PESO, CUBAGEM, CONTAINER, TIPO_CONTAINER, LACRE, BL.</div>
            <div className="app-panel__meta mt-2">
              Cada linha valida veiculo, container e BL antes da persistencia. Linhas inválidas são rejeitadas individualmente.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="app-btn app-btn--secondary"
                href="/templates/veiculos-modelo.xlsx"
                download="veiculos-modelo.xlsx"
              >
                <Download size={16} />
                Baixar modelo .xlsx
              </a>
              <a
                className="app-btn app-btn--secondary"
                href="/templates/veiculos-modelo.csv"
                download="veiculos-modelo.csv"
              >
                <Download size={16} />
                Baixar modelo .csv
              </a>
            </div>
          </div>

          <Field label="Viagem de destino">
            <Select value={importVoyageId} onChange={(event) => setImportVoyageId(event.target.value)}>
              <option value="">Selecione uma viagem</option>
              {allVoyageOptions.map((voyage) => (
                <option key={voyage.id} value={voyage.id}>
                  {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Arquivo .xlsx, .xls ou .csv">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFileChange} />
          </Field>

          {fileName ? <div className="app-panel__meta">Arquivo selecionado: {fileName}</div> : null}
          {parsing ? <div className="app-panel__meta">Lendo arquivo com SheetJS...</div> : null}

          {parsedImport ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="Linhas validas" value={parsedImport.rows.length} />
                <PreviewBox label="Erros de estrutura" value={parsedImport.rowErrors.length} />
                <PreviewBox label="Viagem selecionada" value={importVoyageId ? 1 : 0} />
              </div>

              <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
                <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Chassi</th>
                      <th scope="col" className="px-3 py-2">Marca</th>
                      <th scope="col" className="px-3 py-2">Modelo</th>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Lacre</th>
                      <th scope="col" className="px-3 py-2">BL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedImport.rows.slice(0, 20).map((row) => (
                      <tr key={`${row.rowNumber}-${row.chassis}`}>
                        <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.chassis}</td>
                        <td className="px-3 py-2">{row.brand}</td>
                        <td className="px-3 py-2">{row.model}</td>
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
                <div className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
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
            <div className="app-panel app-panel--padded grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="Processados" value={importReport.processed} />
                <PreviewBox label="Sucesso" value={importReport.successCount} />
                <PreviewBox label="Erros" value={importReport.errorCount} />
              </div>
              {importReport.errors.length ? (
                <div className="max-h-48 overflow-auto rounded-xl border border-[var(--app-border)] p-3 text-sm text-[var(--app-text)]">
                  {importReport.errors.map((item) => (
                    <div key={`${item.row}-${item.message}`} className="border-b border-[var(--app-border)] py-1 last:border-b-0">
                      Linha {item.row}: {item.message}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-green-700">Nenhum erro de integracao no lote importado.</div>
              )}
              <div className="app-panel__meta">Atualizado em {formatDate(new Date().toISOString())}</div>
            </div>
          ) : null}

          <div className="app-modal__actions">
            <Button variant="secondary" onClick={resetImportState}>
              Fechar
            </Button>
            <Button disabled={!importTargetVoyageId || !parsedImport?.rows.length} loading={importing} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  const tone =
    label.includes('Peso')
      ? 'gold'
      : label.includes('Containers')
        ? 'green'
        : label.includes('B/L')
          ? 'navy'
          : 'blue'

  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
    </Card>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  const tone =
    label === 'Erros' ? 'gold' : label === 'Sucesso' ? 'green' : label === 'Processados' ? 'blue' : 'navy'

  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
    </Card>
  )
}

function BreakdownCard({
  title,
  items,
  loading,
  emptyLabel,
}: {
  title: string
  items: Array<{ label: string; count: number }>
  loading: boolean
  emptyLabel: string
}) {
  return (
    <Card>
      <div className="app-panel__title">{title}</div>
      <div className="mt-3 grid gap-2">
        {loading ? <div className="app-panel__meta">Carregando...</div> : null}
        {!loading && !items.length ? <div className="app-panel__meta">{emptyLabel}</div> : null}
        {!loading
          ? items.slice(0, 8).map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-sm">
                <span className="truncate pr-2 text-[var(--app-text)]">{item.label}</span>
                <span className="font-semibold text-[var(--app-text-strong)]">{item.count}</span>
              </div>
            ))
          : null}
      </div>
    </Card>
  )
}
