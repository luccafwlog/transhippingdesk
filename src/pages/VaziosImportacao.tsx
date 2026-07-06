import { useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { useAuth } from '../hooks/useAuth'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatDate } from '../lib/utils'
import {
  parseVaziosImportacaoFile,
  importVaziosImportacaoManifest,
  listVaziosImportacaoContainers,
  listVaziosImportacaoManifests,
  type ParsedVaziosImportacaoManifest,
} from '../services/vaziosImportacaoImport'
import { exportVaziosImportacaoWorkbook } from '../services/exports'

const pageSizes = [20, 50, 100]
const exportPageSize = 200

type Filters = {
  search: string
  manifestId: string
  voyageId: string
  pod: string
  page: number
  pageSize: number
}

export function VaziosImportacao() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [filters, setFilters] = useState<Filters>({
    search: '',
    manifestId: '',
    voyageId: searchParams.get('voyage') ?? '',
    pod: searchParams.get('pod') ?? '',
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [voyageId, setVoyageId] = useState(searchParams.get('voyage') ?? '')
  const [description, setDescription] = useState('')
  const [manifest, setManifest] = useState<ParsedVaziosImportacaoManifest | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['vazios-importacao-containers', filters],
    queryFn: () => listVaziosImportacaoContainers(filters),
  })

  const { data: manifests } = useQuery({
    queryKey: ['vazios-importacao-manifests'],
    queryFn: listVaziosImportacaoManifests,
  })

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = (['search', 'manifestId', 'voyageId', 'pod'] as (keyof Filters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length
  const filterDescription = describeActiveFilters([
    { label: 'Texto', value: filters.search },
    { label: 'Manifesto', value: filters.manifestId },
    { label: 'Viagem', value: filters.voyageId },
    { label: 'POD', value: filters.pod },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'container',
    entityPlural: 'containers',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum container vazio importado ainda.',
    emptyWithFilters: 'Nenhum container encontrado.',
  })

  function clearFilters() {
    setFilters((f) => ({ ...f, search: '', manifestId: '', voyageId: '', pod: '', page: 1 }))
  }

  function resetUpload() {
    setUploadOpen(false)
    setVoyageId('')
    setDescription('')
    setManifest(null)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setManifest(null)
    if (!nextFile) return
    setParsing(true)
    try {
      setManifest(await parseVaziosImportacaoFile(nextFile))
      showToast('Preview carregado.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!manifest || !user || !voyageId) return
    setSubmitting(true)
    try {
      await importVaziosImportacaoManifest({
        manifest,
        uploadedBy: user.id,
        voyageId: Number(voyageId),
        description: description.trim() || undefined,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vazios-importacao-containers'] }),
        queryClient.invalidateQueries({ queryKey: ['vazios-importacao-manifests'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast(`${manifest.containers.length} containers importados.`, 'success')
      resetUpload()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = []
      let page = 1
      let total = 0
      while (true) {
        const result = await listVaziosImportacaoContainers({ ...filters, page, pageSize: exportPageSize })
        if (page === 1) total = result.count
        rows.push(...result.rows)
        if (rows.length >= total || result.rows.length === 0) break
        page += 1
      }
      await exportVaziosImportacaoWorkbook(rows)
      showToast(`${rows.length} container(s) exportado(s).`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao exportar vazios.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Vazios — Importação"
        description="Containers vazios que descarregam (chegam) ao porto. São os futuros vazios de exportação."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload size={16} />
              Importar Planilha
            </Button>
          </div>
        }
      />

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Texto livre">
            <Input
              placeholder="Container ou tipo"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
            />
          </Field>
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="Manifesto">
            <Select value={filters.manifestId} onChange={(e) => updateFilter('manifestId', e.target.value)}>
              <option value="">Todos</option>
              {(manifests ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.description ? m.description : formatDate(m.imported_at)}{' '}
                  ({m.total_containers} ctrs)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Por página">
            <Select value={filters.pageSize} onChange={(e) => updateFilter('pageSize', Number(e.target.value))}>
              {pageSizes.map((s) => (
                <option key={s} value={s}>{s}/pag.</option>
              ))}
            </Select>
          </Field>
        </div>
      </FilterBar>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(data?.count ?? 0, 'container retornado', 'containers retornados')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar containers." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[600px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Tara (kg)</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">Navio / Viagem</th>
                <th scope="col" className="px-4 py-3">Manifesto</th>
                <th scope="col" className="px-4 py-3">Importado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>Carregando...</td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      title={emptyState.title}
                      description={emptyState.description}
                    />
                  </td>
                </tr>
              ) : null}
              {(data?.rows ?? []).map((row) => {
                const manifestLabel = row.manifest?.description
                  ? row.manifest.description
                  : formatDate(row.manifest?.imported_at)
                return (
                  <tr key={row.id} className="hover:bg-[#21262d]/60">
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.container_number}</td>
                    <td className="px-4 py-3">{row.container_type ?? '-'}</td>
                    <td className="px-4 py-3">{row.tare_kg != null ? String(row.tare_kg) : '-'}</td>
                    <td className="px-4 py-3">{row.pod ?? '-'}</td>
                    <td className="px-4 py-3">
                      {row.manifest?.voyage
                        ? `${row.manifest.voyage.vessel?.name ?? '-'} / ${row.manifest.voyage.voyage_number}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3">{manifestLabel}</td>
                    <td className="px-4 py-3">{formatDate(row.manifest?.imported_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="app-table__footer">
          <span>
            Página {filters.page} de {totalPages} - {data?.count ?? 0} registros
          </span>
          <div className="app-table__footer-controls">
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

      <Modal open={uploadOpen} onClose={resetUpload} title="Importar Planilha de Vazios (Importacao)">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Formato esperado</div>
            <div className="mt-2 text-slate-400">
              Colunas: <strong>Container</strong> (obrigatorio), <strong>Tipo</strong>, <strong>Tara</strong> (kg).
            </div>
          </div>

          <VoyageCombobox
            required
            label="Viagem de destino"
            selectedVoyageId={voyageId}
            onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
          />

          <Field label="Descricao (opcional)">
            <Input
              placeholder="Ex: Importacao semana 15"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field label="Arquivo .xlsx">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
          </Field>

          {parsing ? <div className="text-sm text-slate-400">Processando arquivo...</div> : null}

          {manifest ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Containers validos</div>
                  <div className="mt-1 text-2xl font-bold text-white">{manifest.containers.length}</div>
                </div>
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Avisos</div>
                  <div className="mt-1 text-2xl font-bold text-white">{manifest.rowErrors.length}</div>
                </div>
              </div>

              <div className="app-table-scroll max-h-64 rounded-xl border border-[#30363d]">
                <table className="app-table app-table--compact min-w-[480px] text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Tara (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {manifest.containers.slice(0, 25).map((c, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-semibold text-white">{c.container_number}</td>
                        <td className="px-3 py-2">{c.container_type ?? '-'}</td>
                        <td className="px-3 py-2">{c.tare_kg != null ? String(c.tare_kg) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TruncationNote shown={25} total={manifest.containers.length} noun="container" nounPlural="containers" />

              {manifest.rowErrors.length ? (
                <div className="max-h-32 overflow-auto rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {manifest.rowErrors.slice(0, 10).map((e, i) => (
                    <div key={i}>Linha {e.row}: {e.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetUpload}>Cancelar</Button>
            <Button disabled={!manifest || !user || !voyageId} loading={submitting} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
