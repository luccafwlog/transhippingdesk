import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../components/ui/Button'
import { EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { AddPodToVoyageModal, ExportScheduleModal, PodScheduleModal, PolScheduleModal } from '../components/shared/VoyageScheduleModals'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageVehicleStats } from '../hooks/useVehicles'
import { useVaziosImportacaoStats } from '../hooks/useVaziosImportacaoStats'
import { useViagemSchedulesAndStats } from '../hooks/useViagemSchedulesAndStats'
import { buildVoyageRailItems, collectVoyagePorts, normalizeVoyageStatus } from '../services/voyageSummaries'
import { deleteVoyage } from '../services/voyages'
import { setImportBatchCeMaster } from '../services/manifestImport'
import {
  buildVoyagePolEntityId,
  saveVoyagePolSchedule,
  saveVoyagePodSchedule,
  setVoyageRouteCeMaster,
} from '../services/voyageRouteSchedules'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import { saveVoyageExportSchedule } from '../services/voyageExportSchedules'
import {
  VoyageCard,
  type AddingPodPayload,
  type EditingExportPayload,
  type EditingPodPayload,
  type EditingPolPayload,
} from '../components/voyages/VoyageCard'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { VoyageFilters } from '../components/voyages/VoyageFilters'
import { SkeletonCard } from '../components/ui/Skeleton'
import {
  countActiveFilters,
  emptyFilters,
  filterVoyageRailItems,
  type VoyageFilters as VoyageFiltersState,
} from '../lib/viagensFilters'

export function Viagens() {
  const { voyageId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { isAdmin, user } = useAuth()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [editingVoyageId, setEditingVoyageId] = useState<number | null>(null)
  const [deletingVoyageId, setDeletingVoyageId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingPod, setEditingPod] = useState<EditingPodPayload | null>(null)
  const [editingPol, setEditingPol] = useState<EditingPolPayload | null>(null)
  const [addingPodVoyage, setAddingPodVoyage] = useState<AddingPodPayload | null>(null)
  const [editingExport, setEditingExport] = useState<EditingExportPayload | null>(null)
  const initialVessel = searchParams.get('vessel') ?? ''
  const [filters, setFilters] = useState<VoyageFiltersState>({
    ...emptyFilters(),
    search: initialVessel,
  })
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('viagens:rail-collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('viagens:rail-collapsed', next ? '1' : '0')
      } catch {
        /* storage indisponível — ignora */
      }
      return next
    })
  }, [])

  const selectedVoyageId = voyageId ? Number(voyageId) : null

  const voyages = useMemo(() => data ?? [], [data])

  const polEntityIds = useMemo(
    () =>
      Array.from(
        new Set(
          voyages.flatMap((voyage) =>
            [
              ...collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null),
              ...PORTAL_SCHEDULE_LANES.filter((lane) => lane.kind === 'pol').map(portalLaneCode),
            ].map((pol) => buildVoyagePolEntityId(voyage.id, pol)),
          ),
        ),
      ),
    [voyages],
  )

  const voyageIds = useMemo(() => voyages.map((voyage) => voyage.id), [voyages])
  const { data: vehicleStatsData } = useVoyageVehicleStats(voyageIds)
  const { data: vaziosImpStatsData } = useVaziosImportacaoStats(voyageIds)
  const { voyagesWithUnpaidBls, polSchedules, podSchedules, podSchedulesByVoyage, exportSchedulesData, routeCeMasters } =
    useViagemSchedulesAndStats(voyageIds, polEntityIds)
  const vehicleStatsByVoyage = useMemo(() => vehicleStatsData?.byVoyageId ?? {}, [vehicleStatsData])
  const vaziosImpStatsByVoyage = useMemo(() => vaziosImpStatsData?.byVoyageId ?? {}, [vaziosImpStatsData])

  const polPortsByVoyageId = useMemo(() => {
    const map = new Map<number, string[]>()
    if (!polSchedules) return map
    for (const key of polSchedules.keys()) {
      const [voyageIdStr, pol] = key.split('::')
      const voyageId = Number(voyageIdStr)
      if (!voyageId || !pol) continue
      const existing = map.get(voyageId)
      if (existing) {
        existing.push(pol)
      } else {
        map.set(voyageId, [pol])
      }
    }
    return map
  }, [polSchedules])

  const railItems = useMemo(
    () => buildVoyageRailItems(voyages, podSchedulesByVoyage, polPortsByVoyageId),
    [voyages, podSchedulesByVoyage, polPortsByVoyageId],
  )

  const visibleRailItems = useMemo(
    () => filterVoyageRailItems(railItems, filters),
    [railItems, filters],
  )
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId)
  const deletingVoyage = voyages.find((voyage) => voyage.id === deletingVoyageId)

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
      if (selectedVoyageId === deletingVoyageId) navigate('/viagens')
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

      {error ? <InlineError message="Erro ao carregar viagens." /> : null}

      <VoyageFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(emptyFilters())}
        activeCount={activeFilterCount}
        visibleCount={visibleRailItems.length}
        totalCount={railItems.length}
        loading={isLoading}
      />

      <div className={`viagens-grid lg:grid lg:gap-4 ${railCollapsed ? 'lg:grid-cols-[64px_1fr]' : 'lg:grid-cols-[300px_1fr]'}`}>
        <div className={selectedVoyageId ? 'hidden lg:block' : 'block'}>
          {isLoading ? (
            <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
              <SkeletonList />
            </div>
          ) : (
            <VoyageRail
              items={visibleRailItems}
              selectedId={selectedVoyageId}
              onSelect={(id) => navigate(`/viagens/${id}`)}
              onEdit={setEditingVoyageId}
              collapsed={railCollapsed}
              onToggleCollapse={toggleRail}
            />
          )}
        </div>

        <div className={`mt-4 lg:mt-0 ${selectedVoyageId ? 'block' : 'hidden lg:block'}`}>
          {selectedVoyageId ? (
            <Button variant="ghost" className="mb-3 lg:hidden" onClick={() => navigate('/viagens')}>
              <ArrowLeft size={15} />
              Voltar para a lista
            </Button>
          ) : null}

          {!selectedVoyageId ? (
            <EmptyState
              title="Selecione uma viagem"
              description="Escolha uma viagem na lista ao lado para ver o detalhe, planejamento de escalas e os fluxos de importação e exportação."
            />
          ) : selectedVoyage ? (
            <VoyageCard
              key={selectedVoyage.id}
              voyage={selectedVoyage}
              vehicleStats={vehicleStatsByVoyage[selectedVoyage.id]}
              vaziosImpStats={vaziosImpStatsByVoyage[selectedVoyage.id]}
              voyagesWithUnpaidBls={voyagesWithUnpaidBls}
              podSchedules={podSchedules}
              polSchedules={polSchedules}
              routeCeMasters={routeCeMasters}
              scheduledPodRows={podSchedulesByVoyage.get(selectedVoyage.id) ?? []}
              exportSchedule={exportSchedulesData?.get(selectedVoyage.id) ?? null}
              onEditVoyage={setEditingVoyageId}
              onDeleteVoyage={setDeletingVoyageId}
              onEditPod={setEditingPod}
              onEditPol={setEditingPol}
              onAddPod={setAddingPodVoyage}
              onEditExport={setEditingExport}
            />
          ) : isLoading ? (
            <SkeletonCard lines={4} />
          ) : (
            <EmptyState
              title="Viagem não encontrada"
              description="A viagem selecionada não existe mais ou foi removida."
            />
          )}
        </div>
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
          voyages.find((voyage) => voyage.id === editingVoyageId),
          Array.from((polSchedules ?? new Map()).values())
            .filter((schedule) => schedule.voyageId === editingVoyageId && Boolean(schedule.etd))
            .map((schedule) => ({
              pol: schedule.pol,
              etd: schedule.etd ?? '',
            })),
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
        onSaved={async ({ voyageId, pod, eta, etb, ata, atd, rtw, ceStatus, linked, escalaNumber }) => {
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
              escalaNumber,
              changedBy: user.id,
            })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
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
        onSaved={async ({ voyageId, pol, pod, etd, atd, ceMaster, batchIds }) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            // escalaNumber omitido: o Nº de Escala é editado na Visão geral (POD).
            await saveVoyagePolSchedule({
              voyageId,
              pol,
              etd,
              atd,
              changedBy: user.id,
            })
            if (batchIds?.length) {
              // Arquivos do mesmo manifesto compartilham o CE Master.
              await Promise.all(batchIds.map((id) => setImportBatchCeMaster(id, ceMaster, user.id)))
            } else {
              // Viagem só-B/L: sem batch onde guardar; CE Master fica por rota (#322).
              await setVoyageRouteCeMaster({ voyageId, pol, pod, ceMaster, changedBy: user.id })
            }
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pol-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-route-ce-masters'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
            ])
            showToast('Manifesto atualizado com sucesso.', 'success')
            setEditingPol(null)
          } catch {
            showToast('Falha ao salvar o manifesto.', 'error')
          }
        }}
      />

      <AddPodToVoyageModal
        open={addingPodVoyage !== null}
        voyage={addingPodVoyage}
        onClose={() => setAddingPodVoyage(null)}
        onSaved={async ({ voyageId, pod, eta, etb, ata, atd, rtw, ceStatus, linked, escalaNumber }) => {
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
              escalaNumber,
              changedBy: user.id,
            })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
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

function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-[var(--app-border)] px-3 py-3">
          <SkeletonCard lines={3} />
        </div>
      ))}
    </div>
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
  loadPortEtds: Array<{ pol: string; etd: string }> = [],
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
    loadPortEtds,
    dischargePortEtas,
  }
}
