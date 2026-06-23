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
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import {
  parseVaziosManifestFile,
  importVaziosManifest,
  listVaziosBookings,
  type ParsedVaziosManifest,
} from '../services/vaziosImport'
import { formatDate } from '../lib/utils'

const pageSizes = [20, 50, 100]

type Filters = {
  search: string
  voyageId: string
  page: number
  pageSize: number
}

export function EmbarqueVazios() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: voyageOptions } = useVoyageOptions()
  const initialVoyageId = searchParams.get('voyage') ?? ''

  const [filters, setFilters] = useState<Filters>({
    search: '',
    voyageId: initialVoyageId,
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<ParsedVaziosManifest | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['vazios-bookings', filters],
    queryFn: () => listVaziosBookings(filters),
  })

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = (['search', 'voyageId'] as (keyof Filters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length

  function clearFilters() {
    setFilters((f) => ({ ...f, search: '', voyageId: '', page: 1 }))
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setManifest(null)
    if (!nextFile) return
    setParsing(true)
    try {
      setManifest(await parseVaziosManifestFile(nextFile))
      showToast('Preview carregado.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!manifest || !voyageId || !user) return
    setSubmitting(true)
    try {
      await importVaziosManifest({
        filename: file?.name ?? 'vazios.xlsx',
        voyageId: Number(voyageId),
        manifest,
        uploadedBy: user.id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vazios-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
      showToast(`${manifest.bookings.length} bookings importados.`, 'success')
      setUploadOpen(false)
      setVoyageId('')
      setFile(null)
      setManifest(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Vazios — Exportacao"
        description="Containers vazios que embarcam (saem) pelo porto. Identificados por booking number."
        action={
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              href="/templates/vazios-modelo.xlsx"
              download="vazios-modelo.xlsx"
            >
              <Download size={16} />
              Baixar template
            </a>
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
              placeholder="Booking ou container"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
            />
          </Field>
          <Field label="Viagem">
            <Select value={filters.voyageId} onChange={(e) => updateFilter('voyageId', e.target.value)}>
              <option value="">Todas</option>
              {voyageOptions?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vessel?.name ?? 'Navio'} / {v.voyage_number}
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
        {error ? <InlineError message="Erro ao carregar bookings." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[900px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Booking</th>
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Data Movimentacao</th>
                <th scope="col" className="px-4 py-3">Terminal Origem</th>
                <th scope="col" className="px-4 py-3">Destino</th>
                <th scope="col" className="px-4 py-3">Observações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>Carregando...</td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState title="Nenhum booking de vazio encontrado." description="Importe uma planilha ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {(data?.rows ?? []).map((booking) => {
                const manifestData = (booking as { manifest?: { voyage?: { vessel?: { name?: string }; voyage_number?: string } } }).manifest
                const vesselVoyage = manifestData?.voyage
                  ? `${manifestData.voyage.vessel?.name ?? 'Navio'} / ${manifestData.voyage.voyage_number ?? '-'}`
                  : '-'
                return (
                  <tr key={booking.id} className="hover:bg-[#21262d]/60">
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]">{booking.booking_number}</td>
                    <td className="px-4 py-3">{booking.container_number ?? '-'}</td>
                    <td className="px-4 py-3">{booking.container_type ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="app-table__truncate app-table__truncate--xl" title={vesselVoyage}>
                        {vesselVoyage}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {booking.movement_date ? formatDate(booking.movement_date) : '-'}
                    </td>
                    <td className="px-4 py-3">{booking.origin_terminal ?? '-'}</td>
                    <td className="px-4 py-3">{booking.destination ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="app-table__truncate app-table__truncate--lg" title={booking.notes ?? '-'}>
                        {booking.notes ?? '-'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="app-table__footer">
          <span>
            Pagina {filters.page} de {totalPages} - {data?.count ?? 0} registros
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

      {/* Modal de importação */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Importar Planilha de Vazios">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Formato esperado</div>
            <div className="mt-2 text-slate-400">
              Colunas: <strong>Booking</strong> (obrigatorio), Container, Tipo, Data Movimentacao, Terminal Origem, Destino, Observações.
              Use o template disponivel no botao "Baixar template".
            </div>
          </div>

          <Field label="Viagem de destino">
            <Select value={voyageId} onChange={(e) => setVoyageId(e.target.value)}>
              <option value="">Selecione uma viagem</option>
              {voyageOptions?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vessel?.name ?? 'Navio'} / {v.voyage_number}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Arquivo .xlsx">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
          </Field>

          {parsing ? <div className="text-sm text-slate-400">Processando arquivo...</div> : null}

          {manifest ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Bookings validos</div>
                  <div className="mt-1 text-2xl font-bold text-white">{manifest.bookings.length}</div>
                </div>
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Avisos</div>
                  <div className="mt-1 text-2xl font-bold text-white">{manifest.rowErrors.length}</div>
                </div>
              </div>

              <div className="app-table-scroll max-h-64 rounded-xl border border-[#30363d]">
                <table className="app-table app-table--compact min-w-[700px] text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">Booking</th>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {manifest.bookings.slice(0, 25).map((b, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-semibold text-white">{b.booking_number}</td>
                        <td className="px-3 py-2">{b.container_number ?? '-'}</td>
                        <td className="px-3 py-2">{b.container_type ?? '-'}</td>
                        <td className="px-3 py-2">{b.movement_date ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TruncationNote shown={25} total={manifest.bookings.length} noun="booking" nounPlural="bookings" />

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
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>Cancelar</Button>
            <Button disabled={!manifest || !voyageId || !user} loading={submitting} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
