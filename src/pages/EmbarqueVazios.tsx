import { Fragment, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, ChevronDown, ChevronUp, Clock3, Download, Package, Truck, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { useAuth } from '../hooks/useAuth'
import { PAGE_SIZES, usePageFilters } from '../hooks/usePageFilters'
import {
  parseVaziosManifestFile,
  importVaziosManifest,
  listVaziosBookings,
  type ParsedVaziosManifest,
} from '../services/vaziosImport'
import {
  getVaziosExportOperation,
  listActiveReorgRates,
  listVaziosBookingsForOperation,
  updateVaziosBooking,
  upsertOvertimeDepot,
  upsertReorgService,
  upsertVaziosExportOperation,
} from '../services/vaziosExportOperations'
import { listCurrentDepotServices, resolveCurrentDepotTariff } from '../services/depots'
import { computeOperationTotals } from '../services/vaziosCusto'
import { normalizePortCode } from '../services/portCode'
import type { VaziosReorgServiceType } from '../types/database'
import { formatBRL, formatDate } from '../lib/utils'

type Filters = {
  search: string
  voyageId: string
  page: number
  pageSize: number
}

const REORG_SERVICES: Array<{ value: VaziosReorgServiceType; label: string }> = [
  { value: 'bundle', label: 'Bundle' },
  { value: 'desova', label: 'Desova' },
  { value: 'visual_check', label: 'Visual check' },
]

const BOOKING_ADR_FLAGS = [
  { key: 'material', label: 'Material' },
  { key: 'bundle', label: 'Bundle' },
  { key: 'transporte', label: 'Transporte' },
  { key: 'overtime_handling', label: 'OT Handling' },
  { key: 'overtime_transport', label: 'OT Transporte' },
] as const

function reorgDraftKey(service: VaziosReorgServiceType, containerType: string) {
  return `${service}:${containerType}`
}

function parseReorgServiceType(value: string): VaziosReorgServiceType {
  if (value === 'bundle' || value === 'desova' || value === 'visual_check') return value
  throw new Error(`Tipo de serviço de reorganização inválido: ${value}`)
}

export function EmbarqueVazios() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const { can, user } = useAuth()
  const canEditVazios = can('vazios_edit')
  const { showToast } = useToast()
  const initialVoyageId = searchParams.get('voyage') ?? ''

  const { filters, setFilters, updateFilter } = usePageFilters<Filters>({
    search: '',
    voyageId: initialVoyageId,
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [uploadPort, setUploadPort] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<ParsedVaziosManifest | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null)
  const [operationPortState, setOperationPortState] = useState({
    voyageId: '',
    selected: '',
    draft: '',
  })
  const [osDrafts, setOsDrafts] = useState<Record<string, string>>({})
  const [overtimeDrafts, setOvertimeDrafts] = useState<Record<string, string>>({})
  const [reorgDrafts, setReorgDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'containers' | 'costs'>('containers')
  const [operationQuantities, setOperationQuantities] = useState({ bundle: 0, desova: 0 })

  const { data, isLoading, error } = useQuery({
    queryKey: ['vazios-bookings', filters],
    queryFn: () => listVaziosBookings(filters),
  })

  const {
    data: operationBookingsData,
    isLoading: operationBookingsLoading,
  } = useQuery({
    queryKey: ['vazios-bookings', 'operation-options', filters.voyageId],
    queryFn: () => listVaziosBookingsForOperation(filters.voyageId),
    enabled: Boolean(filters.voyageId),
  })

  const operationPortOptions = [...new Set(
    (operationBookingsData?.rows ?? [])
      .map((booking) => normalizePortCode(booking.embark_port))
      .filter((port): port is string => Boolean(port)),
  )].sort()
  const hasCurrentOperationPortState = operationPortState.voyageId === filters.voyageId
  const selectedOperationPort = hasCurrentOperationPortState
    ? operationPortState.selected
    : (operationPortOptions[0] ?? '')
  const operationPortDraft = hasCurrentOperationPortState
    ? operationPortState.draft
    : (operationPortOptions[0] ?? '')
  const operationVoyageId = Number(filters.voyageId)
  const operationDraftPrefix = `${operationVoyageId}:${selectedOperationPort}`
  const operationQueryKey = [
    'vazios-export-operation',
    operationVoyageId,
    selectedOperationPort,
  ] as const

  const {
    data: operationData,
    isLoading: operationLoading,
    error: operationError,
  } = useQuery({
    queryKey: operationQueryKey,
    queryFn: () => getVaziosExportOperation(operationVoyageId, selectedOperationPort),
    enabled: Boolean(filters.voyageId && selectedOperationPort),
  })

  const { data: reorgRatesData, error: reorgRatesError } = useQuery({
    queryKey: ['vazios-reorg-rates', 'active'],
    queryFn: listActiveReorgRates,
    enabled: Boolean(filters.voyageId),
  })

  const operation = operationData?.embark_port === selectedOperationPort
    ? operationData
    : null
  const osDraft = osDrafts[operationDraftPrefix] ?? operation?.os_number ?? ''

  const selectedPortBookings = (operationBookingsData?.rows ?? []).filter(
    (booking) => normalizePortCode(booking.embark_port) === selectedOperationPort,
  )
  const costCatalog = useQuery({
    queryKey: ['vazios-cost-catalog', selectedPortBookings.map((booking) => booking.depot_id ?? '').sort()],
    queryFn: async () => {
      const depotIds = [...new Set(selectedPortBookings.map((booking) => booking.depot_id).filter((id): id is string => Boolean(id)))]
      const entries = await Promise.all(depotIds.map(async (depotId) => [depotId, await resolveCurrentDepotTariff(depotId)] as const))
      const services = (await Promise.all(depotIds.map((depotId) => listCurrentDepotServices(depotId)))).flat()
      return { tariffs: new Map(entries), services }
    },
    enabled: activeTab === 'costs' && selectedPortBookings.length > 0,
  })
  const bookingDepots = selectedPortBookings
    .map((booking) => booking.depot?.trim())
    .filter((depot): depot is string => Boolean(depot))
  const savedDepots = Array.isArray(operation?.overtime)
    ? operation.overtime.map((row) => row.depot)
    : []
  const operationDepots = [...new Set([...bookingDepots, ...savedDepots])].sort()
  const bookingTypes = selectedPortBookings
    .map((booking) => booking.container_type?.trim())
    .filter((containerType): containerType is string => Boolean(containerType))
  const savedTypes = Array.isArray(operation?.reorg)
    ? operation.reorg.map((row) => row.container_type)
    : []
  const operationContainerTypes = [...new Set([...bookingTypes, ...savedTypes])].sort()
  const reorgRates = new Map<VaziosReorgServiceType, number>()
  if (Array.isArray(reorgRatesData)) {
    const today = new Date().toISOString().slice(0, 10)
    const rates = [...reorgRatesData]
      .filter((rate) => rate.valid_from <= today && (!rate.valid_to || rate.valid_to >= today))
      .sort((left, right) => right.valid_from.localeCompare(left.valid_from))
    for (const rate of rates) {
      const service = parseReorgServiceType(rate.service)
      if (!reorgRates.has(service)) reorgRates.set(service, Number(rate.rate_brl))
    }
  }

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  const activeFilterCount = (['search', 'voyageId'] as (keyof Filters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length

  function clearFilters() {
    setFilters((f) => ({ ...f, search: '', voyageId: '', page: 1 }))
  }

  async function persistChange(
    key: string,
    action: () => Promise<void>,
    successMessage: string,
  ) {
    if (!canEditVazios) return false
    setSavingKey(key)
    try {
      await action()
      showToast(successMessage, 'success')
      return true
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao salvar alteração.', 'error')
      return false
    } finally {
      setSavingKey((current) => current === key ? null : current)
    }
  }

  function commitOperationPort(value: string) {
    const normalized = normalizePortCode(value) ?? ''
    setOperationPortState({
      voyageId: filters.voyageId,
      selected: normalized,
      draft: normalized,
    })
  }

  async function saveBookingPatch(
    id: string,
    patch: Parameters<typeof updateVaziosBooking>[1],
  ) {
    await persistChange(`booking:${id}`, async () => {
      await updateVaziosBooking(id, patch)
      await queryClient.invalidateQueries({ queryKey: ['vazios-bookings'] })
    }, 'Dados ADR do booking atualizados.')
  }

  async function ensureOperationId() {
    if (operationError) {
      throw new Error('Não foi possível confirmar os dados atuais da operação.')
    }
    if (operation?.id) return operation.id
    if (!operationVoyageId || !selectedOperationPort) {
      throw new Error('Informe a viagem e o porto da operação.')
    }
    const saved = await upsertVaziosExportOperation({
      voyageId: operationVoyageId,
      embarkPort: selectedOperationPort,
      osNumber: osDraft.trim() || null,
    })
    return saved.id
  }

  async function saveOperationOs() {
    if (operationError) return
    const osNumber = osDraft.trim() || null
    if (!operation && osNumber == null) return
    if (operation?.os_number === osNumber) return
    const saved = await persistChange('operation:os', async () => {
      await upsertVaziosExportOperation({
        voyageId: operationVoyageId,
        embarkPort: selectedOperationPort,
        osNumber,
      })
      await queryClient.invalidateQueries({ queryKey: operationQueryKey })
    }, 'OS da operação atualizada.')
    if (saved) {
      setOsDrafts((current) => {
        const next = { ...current }
        delete next[operationDraftPrefix]
        return next
      })
    }
  }

  async function saveOvertimePercent(depot: string) {
    const saved = Array.isArray(operation?.overtime)
      ? operation.overtime.find((row) => row.depot === depot)?.percent
      : undefined
    const draftStateKey = `${operationDraftPrefix}:overtime:${depot}`
    const rawValue = overtimeDrafts[draftStateKey] ?? String(saved ?? 0)
    const percent = Number(rawValue)
    if (!rawValue.trim() || !Number.isFinite(percent) || percent < 0 || percent > 999.99) {
      showToast('Informe um percentual entre 0 e 999,99.', 'error')
      setOvertimeDrafts((current) => ({ ...current, [draftStateKey]: String(saved ?? 0) }))
      return
    }
    if (saved == null && percent === 0) return
    if (saved != null && Number(saved) === percent) return

    const changed = await persistChange(`overtime:${depot}`, async () => {
      const operationId = await ensureOperationId()
      await upsertOvertimeDepot({ operationId, depot, percent })
      await queryClient.invalidateQueries({ queryKey: operationQueryKey })
    }, `Overtime do depot ${depot} atualizado.`)
    if (changed) {
      setOvertimeDrafts((current) => {
        const next = { ...current }
        delete next[draftStateKey]
        return next
      })
    }
  }

  async function saveReorgQty(service: VaziosReorgServiceType, containerType: string) {
    const key = reorgDraftKey(service, containerType)
    const draftStateKey = `${operationDraftPrefix}:reorg:${key}`
    const saved = Array.isArray(operation?.reorg)
      ? operation.reorg.find(
        (row) => row.service === service && row.container_type === containerType,
      )?.qty
      : undefined
    const rawValue = reorgDrafts[draftStateKey] ?? String(saved ?? 0)
    const qty = Number(rawValue)
    if (!rawValue.trim() || !Number.isInteger(qty) || qty < 0) {
      showToast('Informe uma quantidade inteira maior ou igual a zero.', 'error')
      setReorgDrafts((current) => ({ ...current, [draftStateKey]: String(saved ?? 0) }))
      return
    }
    if (saved == null && qty === 0) return
    if (saved === qty) return

    const changed = await persistChange(`reorg:${key}`, async () => {
      const operationId = await ensureOperationId()
      await upsertReorgService({ operationId, service, containerType, qty })
      await queryClient.invalidateQueries({ queryKey: operationQueryKey })
    }, 'Serviço de reorganização atualizado.')
    if (changed) {
      setReorgDrafts((current) => {
        const next = { ...current }
        delete next[draftStateKey]
        return next
      })
    }
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
    if (!manifest || !voyageId || !uploadPort.trim() || !user) return
    setSubmitting(true)
    try {
      await importVaziosManifest({
        filename: file?.name ?? 'vazios.xlsx',
        voyageId: Number(voyageId),
        port: normalizePortCode(uploadPort) ?? uploadPort.trim().toUpperCase(),
        manifest,
        uploadedBy: user.id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vazios-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
      showToast(`${manifest.bookings.length} containers importados ou atualizados.`, 'success')
      setUploadOpen(false)
      setVoyageId('')
      setUploadPort('')
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
        title="Vazios — Exportação"
        description="Containers vazios que embarcam (saem) pelo porto. O container é a identidade da linha; booking é referência."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to="/embarquevazios/depots"
            >
              <Package size={16} />
              Tabela de Depots
            </Link>
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              href="/templates/vazios-modelo.xlsx"
              download="vazios-modelo.xlsx"
            >
              <Download size={16} />
              Baixar template
            </a>
            {canEditVazios ? (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload size={16} />
                Importar Planilha
              </Button>
            ) : null}
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
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="Por página">
            <Select value={filters.pageSize} onChange={(e) => updateFilter('pageSize', Number(e.target.value))}>
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}/pag.</option>
              ))}
            </Select>
          </Field>
        </div>
      </FilterBar>

      <datalist id="vazios-embark-port-options">
        {operationPortOptions.map((port) => <option key={port} value={port} />)}
      </datalist>

      <div className="mb-5 flex gap-2 border-b border-[var(--app-border)]" role="tablist" aria-label="Vazios EXP">
        <button type="button" role="tab" aria-selected={activeTab === 'containers'} onClick={() => setActiveTab('containers')} className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === 'containers' ? 'border-[var(--app-blue-btn)] text-white' : 'border-transparent text-[var(--app-muted)]'}`}>Containers / dados</button>
        <button type="button" role="tab" aria-selected={activeTab === 'costs'} onClick={() => setActiveTab('costs')} className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === 'costs' ? 'border-[var(--app-blue-btn)] text-white' : 'border-transparent text-[var(--app-muted)]'}`}>Custos / operação</button>
      </div>

      {activeTab === 'containers' ? <>
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Operação da escala</h2>
            <p className="mt-1 text-sm text-slate-400">
              OS, overtime por depot e serviços extras dos vazios embarcados.
            </p>
          </div>
          {filters.voyageId ? (
            canEditVazios ? (
              <span className="text-xs text-slate-400">
                {savingKey?.startsWith('operation:') || savingKey?.startsWith('overtime:') || savingKey?.startsWith('reorg:')
                  ? 'Salvando...'
                  : 'Salva automaticamente ao sair do campo'}
              </span>
            ) : (
              <Badge tone="slate">Somente leitura</Badge>
            )
          ) : null}
        </div>

        {!filters.voyageId ? (
          <div className="mt-5 grid max-w-md gap-2">
            <VoyageCombobox
              clearable
              label="Viagem"
              selectedVoyageId={null}
              onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
            />
            <p className="text-sm text-[var(--app-muted)]">
              Selecione a viagem para lançar OS, overtime por depot e serviços extras da escala.
            </p>
          </div>
        ) : (
        <>
          {operationError ? <div className="mt-4"><InlineError message="Erro ao carregar a operação da escala." /></div> : null}
          {reorgRatesError ? <div className="mt-4"><InlineError message="Erro ao carregar tarifas de reorganização." /></div> : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Field label="Porto de embarque">
              <Input
                aria-label="Porto da operação"
                list="vazios-embark-port-options"
                placeholder="Selecione ou digite o porto"
                value={operationPortDraft}
                onChange={(event) => {
                  const next = event.target.value
                  const normalized = normalizePortCode(next)
                  setOperationPortState({
                    voyageId: filters.voyageId,
                    selected: normalized && operationPortOptions.includes(normalized)
                      ? normalized
                      : selectedOperationPort,
                    draft: next,
                  })
                }}
                onBlur={(event) => commitOperationPort(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitOperationPort(event.currentTarget.value)
                }}
              />
            </Field>
            <Field label="OS da operação">
              <Input
                aria-label="OS da operação"
                placeholder="Número da ordem de serviço"
                value={osDraft}
                readOnly={!canEditVazios}
                disabled={!selectedOperationPort || operationLoading || Boolean(operationError) || savingKey === 'operation:os'}
                onChange={(event) => setOsDrafts((current) => ({
                  ...current,
                  [operationDraftPrefix]: event.target.value,
                }))}
                onBlur={() => void saveOperationOs()}
              />
            </Field>
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
              <div className="text-xs uppercase tracking-wider text-slate-500">Bookings no porto</div>
              <div className="mt-1 text-2xl font-bold text-white">
                {operationBookingsLoading ? '...' : selectedPortBookings.length}
              </div>
            </div>
          </div>

          {!selectedOperationPort ? (
            <div className="mt-5 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-400">
              Selecione ou informe um porto para consultar a operação da escala.
            </div>
          ) : operationLoading ? (
            <div className="mt-5 text-sm text-slate-400">Carregando operação...</div>
          ) : (
            <div className="mt-6 grid gap-6">
              <section>
                <h3 className="text-sm font-semibold text-white">Overtime por depot</h3>
                <p className="mt-1 text-xs text-slate-400">Percentual aplicado aos movimentos marcados com OT.</p>
                {operationDepots.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {operationDepots.map((depot) => {
                      const savedPercent = Array.isArray(operation?.overtime)
                        ? operation.overtime.find((row) => row.depot === depot)?.percent
                        : undefined
                      const key = `overtime:${depot}`
                      const draftStateKey = `${operationDraftPrefix}:overtime:${depot}`
                      return (
                        <Field key={depot} label={depot}>
                          <div className="flex items-center gap-2">
                            <Input
                              aria-label={`Percentual de overtime do depot ${depot}`}
                              className="min-w-0"
                              type="number"
                              min="0"
                              max="999.99"
                              step="0.01"
                              value={overtimeDrafts[draftStateKey] ?? String(savedPercent ?? 0)}
                              readOnly={!canEditVazios}
                              disabled={Boolean(operationError) || savingKey === key}
                              onChange={(event) => setOvertimeDrafts((current) => ({
                                ...current,
                                [draftStateKey]: event.target.value,
                              }))}
                              onBlur={() => void saveOvertimePercent(depot)}
                            />
                            <span className="text-sm text-slate-400">%</span>
                          </div>
                        </Field>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-400">Nenhum depot informado nos bookings deste porto.</div>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white">Serviços de reorganização</h3>
                <p className="mt-1 text-xs text-slate-400">Valor calculado pela quantidade × tarifa ativa.</p>
                {operationContainerTypes.length ? (
                  <div className="app-table-scroll mt-3 rounded-xl border border-[#30363d]">
                    <table className="app-table app-table--compact min-w-[680px] text-left text-sm whitespace-nowrap">
                      <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th scope="col" className="px-3 py-2">Serviço</th>
                          <th scope="col" className="px-3 py-2">Tipo</th>
                          <th scope="col" className="px-3 py-2">Quantidade</th>
                          <th scope="col" className="px-3 py-2">Tarifa</th>
                          <th scope="col" className="px-3 py-2">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#30363d]">
                        {REORG_SERVICES.flatMap((service) => operationContainerTypes.map((containerType) => {
                          const draftKey = reorgDraftKey(service.value, containerType)
                          const draftStateKey = `${operationDraftPrefix}:reorg:${draftKey}`
                          const savedQty = Array.isArray(operation?.reorg)
                            ? operation.reorg.find(
                              (row) => row.service === service.value && row.container_type === containerType,
                            )?.qty
                            : undefined
                          const qty = Number(reorgDrafts[draftStateKey] ?? savedQty ?? 0)
                          const rate = reorgRates.get(service.value)
                          const savingReorgKey = `reorg:${draftKey}`
                          return (
                            <tr key={draftKey}>
                              <td className="px-3 py-2 font-medium text-white">{service.label}</td>
                              <td className="px-3 py-2">{containerType}</td>
                              <td className="px-3 py-2">
                                <Input
                                  aria-label={`${service.label} ${containerType} quantidade`}
                                  className="w-28"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={reorgDrafts[draftStateKey] ?? String(savedQty ?? 0)}
                                  readOnly={!canEditVazios}
                                  disabled={Boolean(operationError) || savingKey === savingReorgKey}
                                  onChange={(event) => setReorgDrafts((current) => ({
                                    ...current,
                                    [draftStateKey]: event.target.value,
                                  }))}
                                  onBlur={() => void saveReorgQty(service.value, containerType)}
                                />
                              </td>
                              <td className="px-3 py-2">{rate == null ? <Link className="app-table__action" to="/embarquevazios/depots">Sem tarifa</Link> : formatBRL(rate)}</td>
                              <td className="px-3 py-2 font-semibold text-white">
                                {rate == null || !Number.isFinite(qty) ? '-' : formatBRL(qty * rate)}
                              </td>
                            </tr>
                          )
                        }))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-400">Nenhum tipo de container informado neste porto.</div>
                )}
              </section>
            </div>
          )}
        </>
        )}
      </Card>
      </> : (
        <Card className="mb-5">
          <PageHeader title="Custos da operação" description="Valores calculados por container a partir do Cadastro de Depot; Embarque Direto não gera tarifa de depot." />
          {costCatalog.error ? <InlineError message="Erro ao carregar tarifas vigentes." /> : null}
          {selectedPortBookings.length === 0 ? <EmptyState title="Nenhum container no porto selecionado" description="Selecione uma viagem e um porto na aba Containers / dados." /> : null}
          {selectedPortBookings.length > 0 && costCatalog.data ? (() => {
            const totals = computeOperationTotals(selectedPortBookings.map((booking) => ({ container_number: booking.container_number ?? '—', depot_id: booking.depot_id, hand_in_date: booking.hand_in_date, hand_out_date: booking.hand_out_date, overtime_handling_pct: booking.overtime_handling_pct, overtime_transport_pct: booking.overtime_transport_pct, visual_check: booking.visual_check })), costCatalog.data.tariffs, costCatalog.data.services, operationQuantities)
            return <div className="grid gap-4"><div className="grid gap-3 md:grid-cols-3"><Field label="Bundle por operação"><Input type="number" min={0} value={operationQuantities.bundle} onChange={(event) => setOperationQuantities((current) => ({ ...current, bundle: Number(event.target.value) }))} /></Field><Field label="Desova por operação"><Input type="number" min={0} value={operationQuantities.desova} onChange={(event) => setOperationQuantities((current) => ({ ...current, desova: Number(event.target.value) }))} /></Field><div className="rounded-xl border border-[var(--app-border)] p-3"><div className="text-xs uppercase text-[var(--app-muted)]">Total</div><div className="mt-1 text-2xl font-bold">{formatBRL(totals.total)}</div></div></div><div className="app-table-scroll"><table className="app-table app-table--compact w-full text-left text-sm"><thead><tr><th>Container</th><th>Handling</th><th>Storage</th><th>Transporte</th><th>Overtime</th><th>Serviços</th><th>Total</th></tr></thead><tbody>{totals.rows.map((row) => <tr key={row.container_number}><td>{row.container_number}</td><td>{formatBRL(row.handling)}</td><td>{formatBRL(row.storage)}</td><td>{formatBRL(row.transporte)}</td><td>{formatBRL(row.overtime)}</td><td>{formatBRL(row.services)}</td><td className="font-semibold">{formatBRL(row.total)}</td></tr>)}</tbody></table></div></div>
          })() : null}
        </Card>
      )}
      {activeTab === 'containers' ? <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar bookings." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[1120px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Booking</th>
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Data Movimentação</th>
                <th scope="col" className="px-4 py-3">Terminal Origem</th>
                <th scope="col" className="px-4 py-3">Destino</th>
                <th scope="col" className="px-4 py-3">Observações</th>
                <th scope="col" className="px-4 py-3">ADR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={9}>Carregando...</td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-0">
                    <EmptyState title="Nenhum booking de vazio encontrado." description="Importe uma planilha ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {(data?.rows ?? []).map((booking) => {
                const manifestData = (booking as { manifest?: { voyage?: { vessel?: { name?: string }; voyage_number?: string } } }).manifest
                const vesselVoyage = manifestData?.voyage
                  ? `${manifestData.voyage.vessel?.name ?? 'Navio'} / ${manifestData.voyage.voyage_number ?? '-'}`
                  : '-'
                const expanded = expandedBookingId === booking.id
                const panelId = `vazios-booking-adr-${booking.id}`
                const savingBooking = savingKey === `booking:${booking.id}`
                const overtimeLabels = [
                  booking.overtime_handling ? 'Handling' : null,
                  booking.overtime_transport ? 'Transporte' : null,
                ].filter(Boolean).join(' + ')
                return (
                  <Fragment key={booking.id}>
                    <tr className={expanded ? 'bg-[#21262d]/60' : 'hover:bg-[#21262d]/60'}>
                      <td className="px-4 py-3 font-semibold text-[#58a6ff]">
                        <div className="flex items-center gap-2">
                          <button
                            className="app-table__icon-button"
                            type="button"
                            aria-label={`${expanded ? 'Recolher' : 'Expandir'} dados ADR do booking ${booking.booking_number}`}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            title={expanded ? 'Recolher dados ADR' : 'Ver dados ADR'}
                            onClick={() => setExpandedBookingId(expanded ? null : booking.id)}
                          >
                            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {booking.booking_number}
                        </div>
                      </td>
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
                      <td className="px-4 py-3">
                        <div className="flex max-w-[320px] flex-wrap gap-1">
                          <Badge tone={booking.embark_port ? 'blue' : 'yellow'}>
                            {booking.embark_port ?? 'Sem porto'}
                          </Badge>
                          <Badge tone={booking.depot ? 'green' : 'slate'}>
                            {booking.depot ?? 'Direto'}
                          </Badge>
                          {booking.material ? (
                            <span title="Material do armador">
                              <Badge tone="blue" className="gap-1">
                                <Package size={12} aria-hidden="true" />
                                <span className="sr-only">Material do armador</span>
                              </Badge>
                            </span>
                          ) : null}
                          {booking.bundle ? (
                            <span title="Bundle">
                              <Badge tone="blue" className="gap-1">
                                <Boxes size={12} aria-hidden="true" />
                                <span className="sr-only">Bundle</span>
                              </Badge>
                            </span>
                          ) : null}
                          {booking.transporte ? (
                            <span title="Transporte">
                              <Badge tone="green" className="gap-1">
                                <Truck size={12} aria-hidden="true" />
                                <span className="sr-only">Transporte</span>
                              </Badge>
                            </span>
                          ) : null}
                          {overtimeLabels ? (
                            <span title={`Overtime ${overtimeLabels}`}>
                              <Badge tone="yellow" className="gap-1">
                                <Clock3 size={12} aria-hidden="true" />
                                <span className="text-[10px]">
                                  {booking.overtime_handling ? 'H' : ''}{booking.overtime_transport ? 'T' : ''}
                                </span>
                                <span className="sr-only">Overtime {overtimeLabels}</span>
                              </Badge>
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr id={panelId} className="bg-[#0d1117]">
                        <td colSpan={9} className="whitespace-normal px-5 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-white">Dados ADR do booking</div>
                              <div className="text-xs text-slate-400">
                                Embarque direto é representado por depot vazio.
                              </div>
                            </div>
                            {!canEditVazios ? <Badge tone="slate">Somente leitura</Badge> : null}
                          </div>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <Field label="Porto Embarque">
                              <Input
                                aria-label={`Porto de embarque do booking ${booking.booking_number}`}
                                list="vazios-embark-port-options"
                                defaultValue={booking.embark_port ?? ''}
                                placeholder="Selecione ou digite"
                                readOnly={!canEditVazios}
                                disabled={savingBooking}
                                onBlur={(event) => {
                                  const next = normalizePortCode(event.currentTarget.value)
                                  if (next !== booking.embark_port) {
                                    void saveBookingPatch(booking.id, { embark_port: next })
                                  }
                                }}
                              />
                            </Field>
                            <Field label="Depot">
                              <Input
                                aria-label={`Depot do booking ${booking.booking_number}`}
                                defaultValue={booking.depot ?? ''}
                                placeholder="Vazio = Embarque Direto"
                                readOnly={!canEditVazios}
                                disabled={savingBooking}
                                onBlur={(event) => {
                                  const next = event.currentTarget.value.trim() || null
                                  if (next !== booking.depot) {
                                    void saveBookingPatch(booking.id, { depot: next })
                                  }
                                }}
                              />
                            </Field>
                            <Field label="Hand-in">
                              <Input
                                aria-label={`Hand-in do booking ${booking.booking_number}`}
                                type="date"
                                defaultValue={booking.hand_in_date ?? ''}
                                readOnly={!canEditVazios}
                                disabled={savingBooking}
                                onBlur={(event) => {
                                  const next = event.currentTarget.value || null
                                  if (next !== booking.hand_in_date) {
                                    void saveBookingPatch(booking.id, { hand_in_date: next })
                                  }
                                }}
                              />
                            </Field>
                            <Field label="Hand-out">
                              <Input
                                aria-label={`Hand-out do booking ${booking.booking_number}`}
                                type="date"
                                defaultValue={booking.hand_out_date ?? ''}
                                readOnly={!canEditVazios}
                                disabled={savingBooking}
                                onBlur={(event) => {
                                  const next = event.currentTarget.value || null
                                  if (next !== booking.hand_out_date) {
                                    void saveBookingPatch(booking.id, { hand_out_date: next })
                                  }
                                }}
                              />
                            </Field>
                            {BOOKING_ADR_FLAGS.map((flag) => (
                              <label key={flag.key} className="app-field">
                                <span className="app-field__label">{flag.label}</span>
                                <span className="flex h-10 items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 text-sm text-slate-200">
                                  <input
                                    aria-label={`${flag.label} do booking ${booking.booking_number}`}
                                    type="checkbox"
                                    checked={booking[flag.key]}
                                    disabled={!canEditVazios || savingBooking}
                                    onChange={(event) => void saveBookingPatch(booking.id, {
                                      [flag.key]: event.currentTarget.checked,
                                    })}
                                  />
                                  {booking[flag.key] ? 'Sim' : 'Não'}
                                </span>
                              </label>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
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
        />
      </Card> : null}

      {/* Modal de importação */}
      <Modal open={uploadOpen && canEditVazios} onClose={() => setUploadOpen(false)} title="Importar Planilha de Vazios">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Formato esperado</div>
            <div className="mt-2 text-slate-400">
              Colunas: <strong>Container</strong> (obrigatório), Booking, POD, Current Status, Depot, datas, OT Handling / OT Transporte e serviços.
              Use o template disponivel no botao "Baixar template".
            </div>
          </div>

          <VoyageCombobox
            required
            label="Viagem de destino"
            selectedVoyageId={voyageId}
            onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
          />

          <Field label="Porto de embarque">
            <Input required value={uploadPort} onChange={(event) => setUploadPort(event.target.value.toUpperCase())} placeholder="BRSSZ" />
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
            <Button disabled={!manifest || !voyageId || !uploadPort.trim() || !user} loading={submitting} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
