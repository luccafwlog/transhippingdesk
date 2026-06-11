import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Field, Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { AddPodToVoyageModal, ExportScheduleModal, PodScheduleModal, PolScheduleModal } from '../components/shared/VoyageScheduleModals'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageVehicleStats } from '../hooks/useVehicles'
import { useVaziosImportacaoStats } from '../hooks/useVaziosImportacaoStats'
import { useViagemSchedulesAndStats } from '../hooks/useViagemSchedulesAndStats'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { collectVoyagePorts, normalizeVoyageStatus } from './viagensHelpers'
import { deleteVoyage } from '../services/voyages'
import {
  buildVoyagePolEntityId,
  saveVoyagePolSchedule,
  saveVoyagePodSchedule,
} from '../services/voyageRouteSchedules'
import { saveVoyageExportSchedule } from '../services/voyageExportSchedules'
import {
  VoyageCard,
  type AddingPodPayload,
  type EditingExportPayload,
  type EditingPodPayload,
  type EditingPolPayload,
  type VoyageSectionKey,
} from '../components/voyages/VoyageCard'

export function Viagens() {
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
  const [editingPod, setEditingPod] = useState<EditingPodPayload | null>(null)
  const [editingPol, setEditingPol] = useState<EditingPolPayload | null>(null)
  const [addingPodVoyage, setAddingPodVoyage] = useState<AddingPodPayload | null>(null)
  const [editingExport, setEditingExport] = useState<EditingExportPayload | null>(null)

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
        {filteredVoyages.map((voyage) => (
          <VoyageCard
            key={voyage.id}
            voyage={voyage}
            vehicleStats={vehicleStatsByVoyage[voyage.id]}
            vaziosImpStats={vaziosImpStatsByVoyage[voyage.id]}
            voyagesWithUnpaidBls={voyagesWithUnpaidBls}
            podSchedules={podSchedules}
            polSchedules={polSchedules}
            scheduledPodRows={podSchedulesByVoyage.get(voyage.id) ?? []}
            exportSchedule={exportSchedulesData?.get(voyage.id) ?? null}
            sectionState={openVoyageSections[voyage.id] ?? {}}
            onToggleSection={(section) => toggleVoyageSection(voyage.id, section)}
            onEditVoyage={setEditingVoyageId}
            onDeleteVoyage={setDeletingVoyageId}
            onEditPod={setEditingPod}
            onEditPol={setEditingPol}
            onAddPod={setAddingPodVoyage}
            onEditExport={setEditingExport}
          />
        ))}
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
