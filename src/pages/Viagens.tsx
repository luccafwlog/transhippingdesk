import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { AddPodToVoyageModal, ExportScheduleModal, PodScheduleModal, PolScheduleModal } from '../components/shared/VoyageScheduleModals'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageVehicleStats } from '../hooks/useVehicles'
import { useVaziosImportacaoStats } from '../hooks/useVaziosImportacaoStats'
import { useViagemSchedulesAndStats } from '../hooks/useViagemSchedulesAndStats'
import { buildVoyageRailItems, collectVoyagePorts, normalizeVoyageStatus } from './viagensHelpers'
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
} from '../components/voyages/VoyageCard'
import { VoyageRail } from '../components/voyages/VoyageRail'

export function Viagens() {
  const [searchParams] = useSearchParams()
  const { voyageId } = useParams()
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
  const [railCollapsed, setRailCollapsed] = useState(false)

  const selectedVoyageId = voyageId ? Number(voyageId) : null

  const voyages = useMemo(() => data ?? [], [data])

  const polEntityIds = useMemo(
    () =>
      Array.from(
        new Set(
          voyages.flatMap((voyage) =>
            collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null).map((pol) => buildVoyagePolEntityId(voyage.id, pol)),
          ),
        ),
      ),
    [voyages],
  )

  const voyageIds = useMemo(() => voyages.map((voyage) => voyage.id), [voyages])
  const { data: vehicleStatsData } = useVoyageVehicleStats(voyageIds)
  const { data: vaziosImpStatsData } = useVaziosImportacaoStats(voyageIds)
  const { voyagesWithUnpaidBls, polSchedules, podSchedules, podSchedulesByVoyage, exportSchedulesData } =
    useViagemSchedulesAndStats(voyageIds, polEntityIds)
  const vehicleStatsByVoyage = useMemo(() => vehicleStatsData?.byVoyageId ?? {}, [vehicleStatsData])
  const vaziosImpStatsByVoyage = useMemo(() => vaziosImpStatsData?.byVoyageId ?? {}, [vaziosImpStatsData])

  const railItems = useMemo(
    () => buildVoyageRailItems(voyages, podSchedulesByVoyage),
    [voyages, podSchedulesByVoyage],
  )

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

      <div className={`viagens-grid lg:grid lg:gap-4 ${railCollapsed ? 'lg:grid-cols-[64px_1fr]' : 'lg:grid-cols-[400px_1fr]'}`}>
        <div className={`relative ${selectedVoyageId ? 'hidden lg:block' : 'block'}`}>
          <button
            type="button"
            onClick={() => setRailCollapsed((prev) => !prev)}
            className="absolute -right-3 top-4 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] shadow-sm transition-colors hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)] lg:flex"
            aria-label={railCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          >
            {railCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          {isLoading ? (
            <Card>Carregando viagens...</Card>
          ) : (
            <VoyageRail
              items={railItems}
              selectedId={selectedVoyageId}
              onSelect={(id) => navigate(`/viagens/${id}`)}
              initialSearch={searchParams.get('vessel') ?? ''}
              collapsed={railCollapsed}
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
            <Card>Carregando viagem...</Card>
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
        onSaved={async ({ voyageId, pol, etd, escalaNumber }) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            await saveVoyagePolSchedule({
              voyageId,
              pol,
              etd,
              escalaNumber,
              changedBy: user.id,
            })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyage-pol-schedules'] }),
              queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
            ])
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
