import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Boxes, FileText, Gem, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Field, Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { AccordionSection, Info, MetricPanel, MetricSection, NavigationCard } from '../components/shared/VoyageSectionCards'
import { AddPodToVoyageModal, ExportScheduleModal, PodScheduleModal, PolScheduleModal } from '../components/shared/VoyageScheduleModals'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageVehicleStats } from '../hooks/useVehicles'
import { useVaziosImportacaoStats, type VoyageVaziosImportacaoStat } from '../hooks/useVaziosImportacaoStats'
import { useViagemSchedulesAndStats } from '../hooks/useViagemSchedulesAndStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatDate } from '../lib/utils'
import {
  collectVoyagePorts,
  countDistinctBatchIds,
  formatMetric,
  formatPortDisplayName,
  getGraniteModuleStats,
  getVaziosModuleStats,
  normalizePortName,
  normalizeVoyageStatus,
  splitVoyageBls,
  stripFileExtension,
  summarizeContainerTypes,
  summarizeModuleAvailability,
  type VoyageBl,
} from './viagensHelpers'
import { deleteVoyage } from '../services/voyages'
import {
  buildVoyagePodEntityId,
  buildVoyagePolEntityId,
  getVoyagePodCeStatusLabel,
  saveVoyagePolSchedule,
  saveVoyagePodSchedule,
  type VoyagePodCeStatus,
} from '../services/voyageRouteSchedules'
import {
  saveVoyageExportSchedule,
  deleteVoyageExportSchedule,
  type VoyageExportSchedule,
} from '../services/voyageExportSchedules'
import { VoyageImportActions } from '../components/shared/VoyageImportActions'

type VoyageSectionKey = 'importação' | 'exportação' | 'origemTrechos'

const VOYAGE_SECTION_ITEMS: Array<{ key: VoyageSectionKey; label: string; description: string }> = [
  {
    key: 'importação',
    label: 'Importação',
    description: 'Consolidado dos fluxos de CNTR, carga geral, carga solta e veículos vinculados à viagem.',
  },
  {
    key: 'exportação',
    label: 'Exportação',
    description: 'Resumo dos módulos de Granito e Vazios vinculados à mesma viagem.',
  },
  {
    key: 'origemTrechos',
    label: 'Origem e Manifestos',
    description: 'ETD editavel por manifesto e consolidado dos manifestos identificados na viagem.',
  },
]

export function Viagens() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { isAdmin, user } = useAuth()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [editingVoyageId, setEditingVoyageId] = useState<number | null>(null)
  const [deletingVoyageId, setDeletingVoyageId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [vesselFilter, setVesselFilter] = useState(() => searchParams.get('vessel') ?? '')
  const [voyageFilter, setVoyageFilter] = useState('')
  const [openVoyageSections, setOpenVoyageSections] = useState<Record<number, Partial<Record<VoyageSectionKey, boolean>>>>({})
  const [editingPod, setEditingPod] = useState<{
    voyageId: number
    voyageLabel: string
    pod: string
    eta: string | null
    etb: string | null
    ata: string | null
    atd: string | null
    rtw: number | null
    ceStatus: VoyagePodCeStatus | null
    linked: boolean | null
  } | null>(null)
  const [editingPol, setEditingPol] = useState<{
    voyageId: number
    voyageLabel: string
    pol: string
    etd: string | null
  } | null>(null)
  const [addingPodVoyage, setAddingPodVoyage] = useState<{ voyageId: number; voyageLabel: string } | null>(null)
  const [editingExport, setEditingExport] = useState<{
    voyageId: number
    voyageLabel: string
    existing: VoyageExportSchedule | null
  } | null>(null)

  const filteredVoyages = useMemo(() => {
    const normalizedVesselFilter = vesselFilter.trim().toUpperCase()
    const normalizedVoyageFilter = voyageFilter.trim().toUpperCase()

    return (data ?? []).filter((voyage) => {
      const vesselName = voyage.vessel?.name?.toUpperCase() ?? ''
      const voyageNumber = voyage.voyage_number?.toUpperCase() ?? ''

      const matchesVessel = !normalizedVesselFilter || vesselName.includes(normalizedVesselFilter)
      const matchesVoyage = !normalizedVoyageFilter || voyageNumber.includes(normalizedVoyageFilter)

      return matchesVessel && matchesVoyage
    })
  }, [data, vesselFilter, voyageFilter])
  const activeFilterCount = (vesselFilter.trim() ? 1 : 0) + (voyageFilter.trim() ? 1 : 0)
  const filterDescription = describeActiveFilters([
    { label: 'Navio', value: vesselFilter },
    { label: 'Viagem', value: voyageFilter },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'viagem',
    entityPlural: 'viagens',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhuma viagem cadastrada ainda.',
  })

  const polEntityIds = useMemo(
    () =>
      Array.from(
        new Set(
          filteredVoyages.flatMap((voyage) =>
            collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null).map((pol) => buildVoyagePolEntityId(voyage.id, pol)),
          ),
        ),
      ),
    [filteredVoyages],
  )

  const filteredVoyageIds = useMemo(() => filteredVoyages.map((voyage) => voyage.id), [filteredVoyages])
  const { data: vehicleStatsData } = useVoyageVehicleStats(filteredVoyageIds)
  const { data: vaziosImpStatsData } = useVaziosImportacaoStats(filteredVoyageIds)
  const { voyagesWithUnpaidBls, polSchedules, podSchedules, podSchedulesByVoyage, exportSchedulesData } =
    useViagemSchedulesAndStats(filteredVoyageIds, polEntityIds)
  const vehicleStatsByVoyage = useMemo(() => vehicleStatsData?.byVoyageId ?? {}, [vehicleStatsData])
  const vaziosImpStatsByVoyage = useMemo(() => vaziosImpStatsData?.byVoyageId ?? {}, [vaziosImpStatsData])
  const moduleStatsByVoyage = useMemo(
    () =>
      Object.fromEntries(
        filteredVoyages.map((voyage) => [
          voyage.id,
          {
            granite: getGraniteModuleStats(voyage.granite_manifests),
            vazios: getVaziosModuleStats(voyage.vazios_manifests),
          },
        ]),
      ),
    [filteredVoyages],
  )
  const deletingVoyage = data?.find((voyage) => voyage.id === deletingVoyageId)

  function toggleVoyageSection(voyageId: number, section: VoyageSectionKey) {
    setOpenVoyageSections((current) => ({
      ...current,
      [voyageId]: {
        ...current[voyageId],
        [section]: !current[voyageId]?.[section],
      },
    }))
  }

  async function handleDeleteVoyage() {
    if (!deletingVoyageId) return

    setDeleting(true)
    try {
      await deleteVoyage(deletingVoyageId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])

      showToast('Viagem excluida com sucesso.', 'success')
      setDeletingVoyageId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao excluir viagem.'
      showToast(message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Viagens"
        description="Cadastro de navio/viagem com planejamento de escalas e visão separada entre operação de importação e exportação."
        action={
          isAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Nova Viagem
            </Button>
          ) : null
        }
      />

      <FilterBar
        activeCount={activeFilterCount}
        onClear={() => { setVesselFilter(''); setVoyageFilter('') }}
      >
        <div className="app-filter-grid">
          <Field label="Navio">
            <Input
              placeholder="Filtrar por navio"
              value={vesselFilter}
              onChange={(event) => setVesselFilter(event.target.value)}
            />
          </Field>
          <Field label="Viagem">
            <Input
              placeholder="Filtrar por numero da viagem"
              value={voyageFilter}
              onChange={(event) => setVoyageFilter(event.target.value)}
            />
          </Field>
        </div>
      </FilterBar>

      {error ? <InlineError message="Erro ao carregar viagens." /> : null}

      <div className="mb-3 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{formatResultCount(filteredVoyages.length, 'viagem visivel', 'viagens visiveis')}</span>
        <span className="text-xs text-slate-400">{filterDescription}</span>
      </div>

      <div className="grid gap-4">
        {isLoading ? <Card>Carregando viagens...</Card> : null}
        {!isLoading && filteredVoyages.length === 0 ? (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        ) : null}
        {filteredVoyages.map((voyage) => {
          const vehicleStats = vehicleStatsByVoyage[voyage.id] ?? {
            totalVehicles: 0,
            distinctContainerCount: 0,
            containerNumbers: [],
            brandSummary: '-',
            vehicleByContainerTypeSummary: '-',
          }
          const vaziosImpStats: VoyageVaziosImportacaoStat = vaziosImpStatsByVoyage[voyage.id] ?? {
            totalManifests: 0,
            distinctContainers: 0,
            containerTypes: '',
            destinations: '',
          }
          const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
          const importBatches = voyage.import_batches ?? []
          const distinctContainerBatchCount = countDistinctBatchIds(containerBls)
          const distinctBreakbulkBatchCount = countDistinctBatchIds(breakbulkBls)
          const containerManifestCount =
            importBatches.filter((batch) => batch.cargo_mode !== 'carga_solta').length || distinctContainerBatchCount
          const breakbulkManifestCount =
            importBatches.filter((batch) => batch.cargo_mode === 'carga_solta').length || distinctBreakbulkBatchCount
          const totalImportManifestCount =
            importBatches.length || containerManifestCount + breakbulkManifestCount
          const totalBls = (voyage.bls ?? []).length
          const billingClosed = totalBls > 0 && voyagesWithUnpaidBls != null && !voyagesWithUnpaidBls.has(voyage.id)
          const flatContainers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
          const vehicleContainerNumbers = new Set(vehicleStats.containerNumbers)
          const generalCargoContainers = flatContainers.filter(
            (container) => !vehicleContainerNumbers.has(String(container.container_number ?? '').trim().toUpperCase()),
          )
          const totalContainers = countDistinctContainerNumbers(flatContainers)
          const totalGeneralCargoContainers = countDistinctContainerNumbers(generalCargoContainers)
          const totalImoContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_imo))
          const totalOogContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_oog))
          const totalGeneralCargoImoContainers = countDistinctContainerNumbersBy(
            generalCargoContainers,
            (container) => Boolean(container.is_imo),
          )
          const totalGeneralCargoOogContainers = countDistinctContainerNumbersBy(
            generalCargoContainers,
            (container) => Boolean(container.is_oog),
          )
          const totalBreakbulkMachines = breakbulkBls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)
          const totalBreakbulkPackages = breakbulkBls.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0)
          const totalBreakbulkPackagesTotal = breakbulkBls.reduce(
            (sum, bl) => sum + Number(bl.bb_packages_total ?? bl.bb_packages_qty ?? bl.bl_breakbulk_items?.length ?? 0),
            0,
          )
          const totalBreakbulkWeightTon = breakbulkBls.reduce(
            (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
            0,
          )
          const totalBreakbulkCbm = breakbulkBls.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0)
          const graniteStats = moduleStatsByVoyage[voyage.id]?.granite ?? getGraniteModuleStats(voyage.granite_manifests)
          const vaziosStats = moduleStatsByVoyage[voyage.id]?.vazios ?? getVaziosModuleStats(voyage.vazios_manifests)
          const exportSchedule = exportSchedulesData?.get(voyage.id) ?? null
          const scheduledPodRows = podSchedulesByVoyage.get(voyage.id) ?? []
          const originPorts = collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null)
          const destinationPorts = collectVoyagePorts(
            voyage.bls,
            'pod',
            voyage.pod?.name ?? null,
            scheduledPodRows
              .filter(
                (schedule) =>
                  Boolean(schedule.eta || schedule.etb || schedule.ata || schedule.atd) ||
                  schedule.rtw !== null ||
                  schedule.linked === true ||
                  (schedule.ceStatus !== null && schedule.ceStatus !== 'missing' && schedule.ceStatus !== 'waiting'),
              )
              .map((schedule) => schedule.pod),
          )
          const containerTypes = summarizeContainerTypes(flatContainers)
          const generalCargoContainerTypes = summarizeContainerTypes(generalCargoContainers)
          const podRows = destinationPorts.map((pod) => {
            const schedule = podSchedules?.get(buildVoyagePodEntityId(voyage.id, pod))
            const routeBls = (voyage.bls ?? []).filter((bl) => normalizePortName(bl.pod) === normalizePortName(pod))
            const routeCeFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
            const autoCeStatus =
              routeBls.length === 0
                ? null
                : routeCeFilledCount === routeBls.length
                  ? 'approved'
                  : routeCeFilledCount > 0
                    ? 'partial'
                    : 'missing'
            return {
              pod,
              eta: schedule?.eta ?? null,
              etb: schedule?.etb ?? null,
              ata: schedule?.ata ?? null,
              atd: schedule?.atd ?? null,
              rtw: schedule?.rtw ?? null,
              ceStatus: schedule?.ceStatus ?? autoCeStatus,
              linked: schedule?.linked ?? Boolean(schedule?.eta || schedule?.etb || schedule?.ata || schedule?.atd),
            }
          })
          const plannedPodCount = podRows.filter((row) => row.eta || row.etb || row.ata || row.atd).length
          const manifestRows = collectVoyageManifestRowsGroupedByRoute({
            voyageId: voyage.id,
            batches: importBatches,
            bls: voyage.bls,
            polSchedules,
          })
          const voyageSectionState = openVoyageSections[voyage.id] ?? {}

          const importacaoContent = (
            <>
              <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
                <MetricPanel title="Container">
                  <Info label="B/Ls CNTR" value={String(containerBls.length)} />
                  <Info label="CNTRS distintos" value={String(totalContainers)} />
                  <Info label="Containers IMO" value={String(totalImoContainers)} />
                  <Info label="Containers OOG" value={String(totalOogContainers)} />
                  <Info label="Tipos de container" value={containerTypes || '-'} />
                </MetricPanel>

                <MetricPanel title="Container de Carga Geral">
                  <Info label="CNTRS distintos" value={String(totalGeneralCargoContainers)} />
                  <Info label="Containers IMO" value={String(totalGeneralCargoImoContainers)} />
                  <Info label="Containers OOG" value={String(totalGeneralCargoOogContainers)} />
                  <Info label="Tipos de container" value={generalCargoContainerTypes || '-'} />
                </MetricPanel>

                <MetricPanel title="Veiculos">
                  <Info label="Veiculos vinculados" value={String(vehicleStats.totalVehicles)} />
                  <Info label="Containers com veiculos" value={String(vehicleStats.distinctContainerCount)} />
                  <Info label="Marcas de veiculos" value={vehicleStats.brandSummary} />
                  <Info label="Veiculos por tipo CNTR" value={vehicleStats.vehicleByContainerTypeSummary} />
                  <Info label="Tipos de Container" value={containerTypes || '-'} />
                </MetricPanel>

                <MetricPanel title="Carga solta">
                  <Info label="B/Ls carga solta" value={String(breakbulkBls.length)} />
                  <Info label="Maquinas" value={formatMetric(totalBreakbulkMachines)} />
                  <Info label="Packages" value={formatMetric(totalBreakbulkPackages)} />
                  <Info label="Packages total" value={formatMetric(totalBreakbulkPackagesTotal)} />
                  <Info label="Weight total" value={`${formatMetric(totalBreakbulkWeightTon)} ton`} />
                  <Info label="CBM total" value={formatMetric(totalBreakbulkCbm)} />
                </MetricPanel>

                <MetricPanel title="Vazios Importacao">
                  <Info label="Manifestos" value={String(vaziosImpStats.totalManifests)} />
                  <Info label="Containers distintos" value={String(vaziosImpStats.distinctContainers)} />
                  <Info label="Tipos" value={vaziosImpStats.containerTypes || '-'} />
                  <Info label="Destinos" value={vaziosImpStats.destinations || '-'} />
                </MetricPanel>
              </div>

              {user?.id ? (
                <MetricSection
                  title="Importação rápida"
                  description="Importe manifestos e planilhas diretamente nesta viagem sem sair da tela."
                >
                  <VoyageImportActions
                    voyageId={voyage.id}
                    voyageLabel={`${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`}
                    userId={user.id}
                    types={['cntr', 'bb', 'vaziosImp', 'vehicles']}
                  />
                </MetricSection>
              ) : null}
            </>
          )

          const exportacaoContent = (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <MetricPanel title="Granito">
                  <Info label="Manifestos" value={String(graniteStats.totalManifests)} />
                  <Info label="B/Ls" value={String(graniteStats.totalBls)} />
                  <Info label="Peso total" value={`${formatMetric(graniteStats.totalWeightTon)} ton`} />
                  <Info label="Prontos faturamento" value={String(graniteStats.readyForBillingCount)} />
                  <Info label="Faturados" value={String(graniteStats.invoicedCount)} />
                  <Info label="Portos descarga" value={graniteStats.dischargePorts || '-'} />
                </MetricPanel>

                <MetricPanel title="Vazios">
                  <Info label="Manifestos" value={String(vaziosStats.totalManifests)} />
                  <Info label="Bookings" value={String(vaziosStats.totalBookings)} />
                  <Info label="Containers distintos" value={String(vaziosStats.distinctContainers)} />
                  <Info label="Tipos" value={vaziosStats.containerTypes || '-'} />
                  <Info label="Destinos" value={vaziosStats.destinations || '-'} />
                  <Info label="Terminais origem" value={vaziosStats.originTerminals || '-'} />
                </MetricPanel>
              </div>

              {user?.id ? (
                <MetricSection
                  title="Exportação rápida"
                  description="Importe manifestos e planilhas de exportação diretamente nesta viagem."
                >
                  <VoyageImportActions
                    voyageId={voyage.id}
                    voyageLabel={`${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`}
                    userId={user.id}
                    types={['granite', 'vaziosExp']}
                  />
                </MetricSection>
              ) : null}
            </>
          )

          const origemTrechosContent = (
            <div className="app-panel app-panel--padded">
              <div className="mb-3">
                <div className="app-panel__title">Manifestos vinculados</div>
                <div className="app-panel__meta">
                  Um manifesto por linha, com ETD editavel e quantidade de B/Ls vinculados.
                </div>
              </div>

              <div className="app-voyage-table-frame">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[52%]" />
                      <col className="w-[18%]" />
                      <col className="w-[14%]" />
                      <col className="w-[16%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="px-3 py-2">Manifesto</th>
                        <th scope="col" className="px-3 py-2">ETD</th>
                        <th scope="col" className="px-3 py-2">B/Ls</th>
                        <th scope="col" className="px-3 py-2">Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifestRows.length ? (
                        manifestRows.map((row) => (
                          <tr key={`${voyage.id}-manifest-${row.batchId}`}>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-[var(--app-text-strong)]">{row.routeLabel}</div>
                              <div className="text-xs text-[var(--app-muted)]">{row.filenameLabel}</div>
                            </td>
                            <td className="px-3 py-2">{formatDate(row.etd)}</td>
                            <td className="px-3 py-2">{row.blCount}</td>
                            <td className="px-3 py-2">
                              <Button
                                variant="secondary"
                                className="app-voyage-icon-btn"
                                aria-label={`Editar ETD do manifesto ${row.filenameLabel}`}
                                onClick={() =>
                                  setEditingPol({
                                    voyageId: voyage.id,
                                    voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                                    pol: row.pol,
                                    etd: row.etd,
                                  })
                                }
                                disabled={!row.pol || row.pol === '-'}
                              >
                                <Pencil size={15} />
                              </Button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-[var(--app-muted)]">
                            Nenhum manifesto identificado nesta viagem.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )

          return (
            <Card key={voyage.id} className="grid gap-5">
              <section className="app-voyage-hero">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="grid gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-[var(--app-muted-soft)]">
                        {voyage.vessel?.carrier?.name ?? 'Armador nao informado'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-bold text-[var(--app-text-strong)]">
                          {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                        </h2>
                        <span className="rounded-full border border-[#1f6feb]/30 bg-[#1f6feb]/10 px-3 py-1 text-xs font-semibold text-[#8cc8ff]">
                          {voyage.status ?? 'active'}
                        </span>
                        {billingClosed ? (
                          <span
                            className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
                            title="Todos os B/Ls desta viagem estao quitados ou isentos."
                          >
                            Faturamento Encerrado
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="app-voyage-hero-stats">
                      {[
                        `${totalBls} B/Ls`,
                        `${totalContainers} CNTRs`,
                        `${plannedPodCount} Escala${plannedPodCount === 1 ? '' : 's'} planejada${plannedPodCount === 1 ? '' : 's'}`,
                        `${totalImportManifestCount} Manifesto${totalImportManifestCount === 1 ? '' : 's'}`,
                        `Modulos: ${summarizeModuleAvailability({
                          hasCntrs: containerBls.length > 0,
                          hasBreakbulk: breakbulkBls.length > 0,
                          hasVehicles: vehicleStats.totalVehicles > 0,
                          hasGranite: graniteStats.totalManifests > 0,
                          hasVazios: vaziosStats.totalManifests > 0,
                        })}`,
                      ].map((item) => (
                        <span key={`${voyage.id}-${item}`} className="app-voyage-hero-stat">
                          {item}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--app-muted)]">
                      <div className="flex flex-wrap items-center gap-2">
                        {originPorts.length ? (
                          originPorts.map((port) => (
                            <span key={`${voyage.id}-origin-${port}`} className="app-voyage-token">
                              {port}
                            </span>
                          ))
                        ) : (
                          <span className="app-voyage-token">Origem a definir</span>
                        )}
                      </div>
                      <ArrowRight size={16} className="text-[var(--app-muted)]" />
                      <div className="flex flex-wrap items-center gap-2">
                        {destinationPorts.length ? (
                          destinationPorts.map((port) => (
                            <span key={`${voyage.id}-destination-${port}`} className="app-voyage-token">
                              {port}
                            </span>
                          ))
                        ) : (
                          <span className="app-voyage-token">Destino a definir</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="flex items-center gap-2 self-start">
                      <Button variant="ghost" className="app-voyage-action-icon" onClick={() => setEditingVoyageId(voyage.id)}>
                        <Pencil size={15} />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        className="app-voyage-action-icon app-voyage-action-icon--danger"
                        onClick={() => setDeletingVoyageId(voyage.id)}
                      >
                        <Trash2 size={15} />
                        Excluir
                      </Button>
                    </div>
                  ) : null}
                </div>
              </section>

              <MetricSection
                title="Planejamento por POD/POL"
                description="Datas ETA, ETB, ATA e ATD, RESTOW, BLs e CEs e ESCALA sao controlados por porto de descarga ou embarque."
                actions={isAdmin ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setAddingPodVoyage({
                          voyageId: voyage.id,
                          voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                        })
                      }
                    >
                      <Plus size={15} />
                      Adicionar POD
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEditingExport({
                          voyageId: voyage.id,
                          voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                          existing: exportSchedule,
                        })
                      }
                    >
                      <Plus size={15} />
                      Adicionar POL
                    </Button>
                  </>
                ) : undefined}
              >
                <div className="app-voyage-table-frame">
                  <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[16%]" />
                      <col className="w-[9%]" />
                      <col className="w-[9%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="px-3 py-2">POD/POL</th>
                        <th scope="col" className="px-3 py-2">ETA</th>
                        <th scope="col" className="px-3 py-2">ETB</th>
                        <th scope="col" className="px-3 py-2">ATA</th>
                        <th scope="col" className="px-3 py-2">ATD</th>
                        <th scope="col" className="px-3 py-2">RESTOW</th>
                        <th scope="col" className="px-3 py-2">BLs e CEs</th>
                        <th scope="col" className="px-3 py-2">ESCALA</th>
                        <th scope="col" className="px-3 py-2">Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {podRows.length ? (
                        podRows.map((row) => (
                          <tr key={`${voyage.id}-lineup-${row.pod}`}>
                            <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.pod}</td>
                            <td className="px-3 py-2">{formatDate(row.eta)}</td>
                            <td className="px-3 py-2">{formatDate(row.etb)}</td>
                            <td className="px-3 py-2">{formatDate(row.ata)}</td>
                            <td className="px-3 py-2">{formatDate(row.atd)}</td>
                            <td className="px-3 py-2">{row.rtw === null ? '-' : formatMetric(row.rtw)}</td>
                            <td className="px-3 py-2">{renderCeStatusLabel(row.ceStatus)}</td>
                            <td className="px-3 py-2">{renderLinkedLabel(row.linked)}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  className="app-voyage-icon-btn"
                                  aria-label={`Editar planejamento do POD ${row.pod}`}
                                  onClick={() =>
                                    setEditingPod({
                                      voyageId: voyage.id,
                                      voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                                      pod: row.pod,
                                      eta: row.eta,
                                      etb: row.etb,
                                      ata: row.ata,
                                      atd: row.atd,
                                      rtw: row.rtw,
                                      ceStatus: row.ceStatus,
                                      linked: row.linked,
                                    })
                                  }
                                >
                                  <Pencil size={15} />
                                </Button>
                                {isAdmin ? (
                                  <Button
                                    variant="danger"
                                    className="app-voyage-icon-btn"
                                    aria-label={`Excluir planejamento do POD ${row.pod}`}
                                    onClick={async () => {
                                      const routeBls = (voyage.bls ?? []).filter(
                                        (bl) => normalizePortName(bl.pod) === normalizePortName(row.pod),
                                      )
                                      const hasScheduleData = Boolean(
                                        row.eta || row.etb || row.ata || row.atd || row.rtw !== null,
                                      )
                                      if (routeBls.length > 0) {
                                        showToast('Não é possível excluir este POD: existem B/Ls vinculados.', 'error')
                                        return
                                      }
                                      if (!hasScheduleData && row.linked !== true) {
                                        showToast('Este POD ja nao possui dados planejados para remover.', 'info')
                                        return
                                      }
                                      if (!user?.id) {
                                        showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
                                        return
                                      }
                                      try {
                                        await saveVoyagePodSchedule({
                                          voyageId: voyage.id,
                                          pod: row.pod,
                                          eta: null,
                                          etb: null,
                                          ata: null,
                                          atd: null,
                                          rtw: null,
                                          ceStatus: 'waiting',
                                          linked: false,
                                          changedBy: user.id,
                                        })
                                        await Promise.all([
                                          queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
                                          queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
                                          queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
                                        ])
                                        showToast('Dados do planejamento do POD limpos com sucesso.', 'success')
                                      } catch (error) {
                                        const errorText = extractErrorText(error)
                                        if (errorText.includes('42501') || errorText.includes('permission denied')) {
                                          showToast('Sem permissão para excluir planejamento do POD. Solicite acesso administrativo.', 'error')
                                          return
                                        }
                                        showToast(
                                          `Falha ao excluir planejamento do POD.${errorText ? ` Motivo: ${errorText}` : ''}`,
                                          'error',
                                        )
                                      }
                                    }}
                                  >
                                    <Trash2 size={15} />
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9} className="px-3 py-3 text-[var(--app-muted)]">
                            Nenhum POD planejado para esta viagem.
                          </td>
                        </tr>
                      )}
                      {exportSchedule ? (
                        <tr className="border-t border-amber-900/40 bg-amber-950/20">
                          <td className="px-3 py-2 font-semibold text-amber-400">
                            {exportSchedule.pol ?? 'POL'}
                            <span className="ml-1 text-xs text-amber-600">EXP</span>
                          </td>
                          <td className="px-3 py-2">{formatDate(exportSchedule.eta)}</td>
                          <td className="px-3 py-2">{formatDate(exportSchedule.etb)}</td>
                          <td colSpan={3} className="px-3 py-2 text-amber-500/80 text-xs">
                            {[
                              exportSchedule.hasGranite ? 'GRANITE' : null,
                              exportSchedule.containersQty !== null
                                ? `${exportSchedule.containersQty} CNTRS${exportSchedule.movementsQty !== null ? ` - ${exportSchedule.movementsQty} MOVES` : ''}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' | ') || '—'}
                          </td>
                          <td className="px-3 py-2">{renderCeStatusLabel(exportSchedule.ceStatus ?? 'waiting')}</td>
                          <td className="px-3 py-2">{renderLinkedLabel(exportSchedule.linked)}</td>
                          <td className="px-3 py-2">
                            {isAdmin ? (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  className="app-voyage-icon-btn"
                                  aria-label="Editar POL de exportação"
                                  onClick={() =>
                                    setEditingExport({
                                      voyageId: voyage.id,
                                      voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                                      existing: exportSchedule,
                                    })
                                  }
                                >
                                  <Pencil size={15} />
                                </Button>
                                <Button
                                  variant="danger"
                                  className="app-voyage-icon-btn"
                                  aria-label="Excluir POL de exportação"
                                  onClick={async () => {
                                    try {
                                      await deleteVoyageExportSchedule(exportSchedule.id)
                                      await Promise.all([
                                        queryClient.invalidateQueries({ queryKey: ['voyage-export-schedules'] }),
                                        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
                                        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
                                      ])
                                      showToast('Planejamento de exportação removido.', 'success')
                                    } catch {
                                      showToast('Falha ao remover planejamento de exportação.', 'error')
                                    }
                                  }}
                                >
                                  <Trash2 size={15} />
                                </Button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </MetricSection>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <NavigationCard
                  icon={Boxes}
                  title="Manifestos CNTR"
                  metrics={[`${containerManifestCount} manifestos`, `${containerBls.length} B/Ls`, `${totalContainers} containers distintos`]}
                  onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}
                  disabled={containerBls.length === 0}
                />
                <NavigationCard
                  icon={FileText}
                  title="Manifestos BB"
                  metrics={[`${breakbulkManifestCount} manifestos`, `${breakbulkBls.length} B/Ls`, `${formatMetric(totalBreakbulkWeightTon)} ton`]}
                  onClick={() => navigate(`/carga-solta?voyage=${voyage.id}`)}
                  disabled={breakbulkBls.length === 0}
                />
                <NavigationCard
                  icon={Gem}
                  title="Granito"
                  metrics={[`${graniteStats.totalManifests} manifestos`, `${formatMetric(graniteStats.totalWeightTon)} ton`, `${graniteStats.totalBls} B/Ls`]}
                  onClick={() => navigate(`/granito?voyage=${voyage.id}`)}
                  disabled={graniteStats.totalManifests === 0}
                />
                <NavigationCard
                  icon={Package}
                  title="Vazios"
                  metrics={[`${vaziosStats.totalBookings} bookings`, `${vaziosStats.distinctContainers} containers`, vaziosStats.destinations || 'Sem destinos']}
                  onClick={() => navigate(`/vazios?voyage=${voyage.id}`)}
                  disabled={vaziosStats.totalManifests === 0}
                />
              </section>

              <section className="grid gap-4">
                {VOYAGE_SECTION_ITEMS.map((section) => (
                  <AccordionSection
                    key={`${voyage.id}-${section.key}`}
                    title={section.label}
                    description={section.description}
                    open={Boolean(voyageSectionState[section.key])}
                    onToggle={() => toggleVoyageSection(voyage.id, section.key)}
                  >
                    {section.key === 'importação'
                      ? importacaoContent
                      : section.key === 'exportação'
                        ? exportacaoContent
                        : origemTrechosContent}
                  </AccordionSection>
                ))}
              </section>
            </Card>
          )
        })}
      </div>

      <VoyageCreateModal
        open={open}
        onClose={() => setOpen(false)}
      />

      <VoyageCreateModal
        open={editingVoyageId !== null}
        onClose={() => setEditingVoyageId(null)}
        voyageId={editingVoyageId ?? undefined}
        title="Editar Viagem"
        initialValues={makeVoyageInitialValues(
          data?.find((voyage) => voyage.id === editingVoyageId),
          (podSchedulesByVoyage.get(editingVoyageId ?? -1) ?? [])
            .filter((schedule) => Boolean(schedule.eta))
            .map((schedule) => ({
              pod: schedule.pod,
              eta: schedule.eta ?? '',
            })),
        )}
        onSaved={() => setEditingVoyageId(null)}
      />

      <Modal open={deletingVoyageId !== null} onClose={() => setDeletingVoyageId(null)} title="Excluir Viagem">
        <div className="grid gap-4">
          <div className="rounded-xl border border-red-400/30 bg-red-950/30 p-3 text-sm text-red-100">
            Esta exclusão é permanente. Ela só será permitida se a viagem não tiver importações nem B/Ls vinculados.
          </div>

          <div className="text-sm text-[var(--app-text)]">
            {deletingVoyage ? (
              <>
                Confirme a exclusão de <span className="font-semibold text-[var(--app-text-strong)]">{deletingVoyage.vessel?.name ?? 'Navio'} / {deletingVoyage.voyage_number}</span>.
              </>
            ) : (
              'Confirme a exclusão da viagem selecionada.'
            )}
          </div>

          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setDeletingVoyageId(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDeleteVoyage}>
              Excluir viagem
            </Button>
          </div>
        </div>
      </Modal>

      <ExportScheduleModal
        open={editingExport !== null}
        exportData={editingExport}
        onClose={() => setEditingExport(null)}
        onSaved={async ({ voyageId, pol, hasGranite, containersQty, movementsQty, eta, etb, ceStatus, linked }) => {
          try {
            await saveVoyageExportSchedule({ voyageId, pol, hasGranite, containersQty, movementsQty, eta, etb, ceStatus, linked })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-export-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
            ])
            showToast('Planejamento de exportação salvo.', 'success')
            setEditingExport(null)
          } catch {
            showToast('Falha ao salvar planejamento de exportação.', 'error')
          }
        }}
      />

      <PodScheduleModal
        open={editingPod !== null}
        podSchedule={editingPod}
        onClose={() => setEditingPod(null)}
        onSaved={async ({ voyageId, pod, eta, etb, ata, atd, rtw, ceStatus, linked }) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            await saveVoyagePodSchedule({
              voyageId,
              pod,
              eta,
              etb,
              ata,
              atd,
              rtw,
              ceStatus,
              linked,
              changedBy: user.id,
            })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
            ])
            showToast('Datas do POD atualizadas com sucesso.', 'success')
            setEditingPod(null)
          } catch {
            showToast('Falha ao salvar as datas do POD.', 'error')
          }
        }}
      />

      <PolScheduleModal
        open={editingPol !== null}
        polSchedule={editingPol}
        onClose={() => setEditingPol(null)}
        onSaved={async ({ voyageId, pol, etd }) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            await saveVoyagePolSchedule({
              voyageId,
              pol,
              etd,
              changedBy: user.id,
            })
            await queryClient.invalidateQueries({ queryKey: ['voyage-pol-schedules'] })
            showToast('ETD do POL atualizado com sucesso.', 'success')
            setEditingPol(null)
          } catch {
            showToast('Falha ao salvar o ETD do POL.', 'error')
          }
        }}
      />

      <AddPodToVoyageModal
        open={addingPodVoyage !== null}
        voyage={addingPodVoyage}
        onClose={() => setAddingPodVoyage(null)}
        onSaved={async ({ voyageId, pod, eta, etb, ata, atd, rtw, ceStatus, linked }) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            await saveVoyagePodSchedule({
              voyageId,
              pod,
              eta,
              etb,
              ata,
              atd,
              rtw,
              ceStatus,
              linked,
              changedBy: user.id,
            })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
            ])
            showToast('POD adicionado ao planejamento da viagem.', 'success')
            setAddingPodVoyage(null)
          } catch {
            showToast('Falha ao adicionar POD ao planejamento.', 'error')
          }
        }}
      />
    </>
  )
}

function renderCeStatusLabel(status: VoyagePodCeStatus | null) {
  return getVoyagePodCeStatusLabel(status)
}

function renderLinkedLabel(linked: boolean | null) {
  return linked ? 'YES' : 'NO'
}

type VoyageImportBatch = {
  id: number
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  filename: string
  uploaded_at: string | null
  status: 'processing' | 'completed' | 'partial' | 'failed' | null
  total_bls: number | null
}

function collectVoyageManifestRowsGroupedByRoute({
  voyageId,
  batches,
  bls,
  polSchedules,
}: {
  voyageId: number
  batches: VoyageImportBatch[] | null | undefined
  bls: VoyageBl[] | null | undefined
  polSchedules?: Map<string, { etd: string | null }> | undefined
}) {
  const blsByBatch = new Map<number, VoyageBl[]>()
  const routeGroups = new Map<
    string,
    {
      pol: string
      pod: string
      blCount: number
      filenames: string[]
      modeLabels: string[]
      batchIds: number[]
      sortDate: number
    }
  >()

  for (const bl of bls ?? []) {
    if (!bl.batch_id) continue
    const current = blsByBatch.get(bl.batch_id) ?? []
    current.push(bl)
    blsByBatch.set(bl.batch_id, current)
  }

  for (const batch of batches ?? []) {
    const batchBls = blsByBatch.get(batch.id) ?? []
    const pol = batchBls[0]?.pol?.trim() || '-'
    const pod = batchBls[0]?.pod?.trim() || '-'
    const routeKey = `${normalizePortName(pol)}::${normalizePortName(pod)}`
    const filename = stripFileExtension(batch.filename || `manifesto-${batch.id}`)
    const modeLabel = batch.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'
    const batchSortDate = Date.parse(batch.uploaded_at ?? '')
    const current = routeGroups.get(routeKey)

    if (current) {
      current.blCount += Number(batch.total_bls ?? batchBls.length)
      current.batchIds.push(batch.id)
      if (!current.filenames.includes(filename)) current.filenames.push(filename)
      if (!current.modeLabels.includes(modeLabel)) current.modeLabels.push(modeLabel)
      if (Number.isFinite(batchSortDate) && (!Number.isFinite(current.sortDate) || batchSortDate < current.sortDate)) {
        current.sortDate = batchSortDate
      }
      continue
    }

    routeGroups.set(routeKey, {
      pol,
      pod,
      blCount: Number(batch.total_bls ?? batchBls.length),
      filenames: [filename],
      modeLabels: [modeLabel],
      batchIds: [batch.id],
      sortDate: batchSortDate,
    })
  }

  return Array.from(routeGroups.values())
    .sort((left, right) => {
      if (Number.isFinite(left.sortDate) && Number.isFinite(right.sortDate) && left.sortDate !== right.sortDate) {
        return left.sortDate - right.sortDate
      }
      return left.pol.localeCompare(right.pol, 'pt-BR') || left.pod.localeCompare(right.pod, 'pt-BR')
    })
    .map((group) => ({
      batchId: group.batchIds.join('-'),
      pol: group.pol,
      etd: polSchedules?.get(buildVoyagePolEntityId(voyageId, group.pol))?.etd ?? null,
      blCount: group.blCount,
      routeLabel: `${formatPortDisplayName(group.pol)} -> ${formatPortDisplayName(group.pod)}`,
      filenameLabel: `${group.modeLabels.join('/')} | ${group.filenames.join(', ')}`,
    }))
}


function makeVoyageInitialValues(
  voyage:
    | {
        voyage_number: string
        status: string | null
        vessel?: {
          name: string
          imo: string | null
          carrier?: { name: string; scac: string | null } | null
        } | null
      }
    | undefined,
  dischargePortEtas: Array<{ pod: string; eta: string }> = [],
) {
  if (!voyage) return undefined

  return {
    carrierName: voyage.vessel?.carrier?.name ?? '',
    carrierScac: voyage.vessel?.carrier?.scac ?? '',
    vesselName: voyage.vessel?.name ?? '',
    vesselImo: voyage.vessel?.imo ?? '',
    voyageNumber: voyage.voyage_number,
    status: normalizeVoyageStatus(voyage.status),
    dischargePortEtas,
  }
}

function extractErrorText(error: unknown) {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const candidate = error as { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }
    return [candidate.code, candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ').trim()
  }
  return ''
}
