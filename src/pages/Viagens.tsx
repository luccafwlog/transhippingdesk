import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../components/ui/Button'
import { EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { EscalaModal, PolScheduleModal, type EscalaModalData } from '../components/shared/VoyageScheduleModals'
import { Modal } from '../components/ui/Modal'
import { Field, Input } from '../components/ui/Input'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageVehicleStats } from '../hooks/useVehicles'
import { useVaziosImportacaoStats } from '../hooks/useVaziosImportacaoStats'
import { useViagemSchedulesAndStats } from '../hooks/useViagemSchedulesAndStats'
import { buildVoyageRailItems, collectVoyagePorts, normalizeVoyageStatus } from '../services/voyageSummaries'
import { cancelVoyage, deleteVoyage } from '../services/voyages'
import { setImportBatchCeMaster } from '../services/manifestImport'
import {
  buildVoyagePolEntityId,
  saveVoyageEscalaSchedule,
  saveVoyagePolSchedule,
  setVoyageRouteCeMaster,
} from '../services/voyageRouteSchedules'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import { saveVoyageExportSchedule } from '../services/voyageExportSchedules'
import { afterEscalaAlterada, afterRotaAlterada, afterViagemAlterada } from '../services/cacheEffects'
import {
  VoyageCard,
  type EditingPolPayload,
  type VoyageTabKey,
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
  const confirm = useConfirm()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [editingVoyageId, setEditingVoyageId] = useState<number | null>(null)
  const [deletingVoyageId, setDeletingVoyageId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [cancellingVoyageId, setCancellingVoyageId] = useState<number | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [editingEscala, setEditingEscala] = useState<EscalaModalData | null>(null)
  const [editingPol, setEditingPol] = useState<EditingPolPayload | null>(null)
  const initialVessel = searchParams.get('vessel') ?? ''
  const tabParam = searchParams.get('tab')
  const initialTab: VoyageTabKey | undefined = tabParam === 'visao' || tabParam === 'importacao' || tabParam === 'exportacao' || tabParam === 'manifestos' || tabParam === 'adr'
    ? tabParam
    : undefined
  const initialEscala = searchParams.get('escala') ?? undefined
  const [filters, setFilters] = useState<VoyageFiltersState>({
    ...emptyFilters(),
    search: initialVessel,
  })
  // Rail fica recolhido por padrão no desktop e expande em overlay ao passar o
  // mouse (sem clique). No mobile permanece sempre expandido — não há hover.
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const [railHovered, setRailHovered] = useState(false)
  const railCollapsed = isDesktop && !railHovered

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
  const { voyagesWithUnpaidBls, polSchedules, podSchedulesByVoyage, escalaSchedulesByVoyage: escalaSchedulesByVoyageData, exportSchedulesData, routeCeMasters } =
    useViagemSchedulesAndStats(voyageIds, polEntityIds)
  const escalaSchedulesByVoyage = useMemo(() => escalaSchedulesByVoyageData ?? new Map(), [escalaSchedulesByVoyageData])
  const vehicleStatsByVoyage = useMemo(() => vehicleStatsData?.byVoyageId ?? {}, [vehicleStatsData])
  const vaziosImpStatsByVoyage = useMemo(() => vaziosImpStatsData?.byVoyageId ?? {}, [vaziosImpStatsData])

  const railItems = useMemo(
    () => buildVoyageRailItems(voyages, escalaSchedulesByVoyage),
    [voyages, escalaSchedulesByVoyage],
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
      await afterViagemAlterada(queryClient, { voyageId: deletingVoyageId })

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

  async function handleCancelVoyage() {
    if (!cancellingVoyageId || !user?.id || !cancellationReason.trim()) return
    const accepted = await confirm({
      title: 'Confirmar cancelamento',
      message: 'A viagem será mantida para rastreabilidade e ficará com status Cancelada.',
      confirmLabel: 'Cancelar viagem',
      tone: 'danger',
    })
    if (!accepted) return

    setCancelling(true)
    try {
      await cancelVoyage({ voyageId: cancellingVoyageId, reason: cancellationReason, changedBy: user.id })
      await afterViagemAlterada(queryClient, { voyageId: cancellingVoyageId })
      showToast('Viagem cancelada com sucesso.', 'success')
      setCancellingVoyageId(null)
      setCancellationReason('')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao cancelar viagem.', 'error')
    } finally {
      setCancelling(false)
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

      <div className="viagens-grid lg:grid lg:gap-4 lg:grid-cols-[64px_1fr]">
        <div
          className={`relative ${selectedVoyageId ? 'hidden lg:block' : 'block'}`}
          onMouseEnter={() => setRailHovered(true)}
          onMouseLeave={() => setRailHovered(false)}
        >
          {isLoading ? (
            <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
              <SkeletonList />
            </div>
          ) : (
            <div className={railCollapsed ? '' : 'lg:absolute lg:left-0 lg:top-0 lg:z-30 lg:w-[300px] lg:shadow-2xl'}>
              <VoyageRail
                items={visibleRailItems}
                selectedId={selectedVoyageId}
                onSelect={(id) => navigate(`/viagens/${id}`)}
                onEdit={setEditingVoyageId}
                collapsed={railCollapsed}
              />
            </div>
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
              polSchedules={polSchedules}
              routeCeMasters={routeCeMasters}
              scheduledEscalaRows={escalaSchedulesByVoyage.get(selectedVoyage.id) ?? []}
              exportSchedules={Array.from(exportSchedulesData?.get(selectedVoyage.id)?.values() ?? [])}
              onEditVoyage={setEditingVoyageId}
              onDeleteVoyage={setDeletingVoyageId}
              onCancelVoyage={setCancellingVoyageId}
              onEditEscala={setEditingEscala}
              onEditPol={setEditingPol}
              initialTab={initialTab}
              initialEscala={initialEscala}
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

      <Modal
        open={cancellingVoyageId !== null}
        onClose={() => {
          setCancellingVoyageId(null)
          setCancellationReason('')
        }}
        title="Cancelar viagem"
      >
        <div className="grid gap-4">
          <p className="text-sm text-[var(--app-text)]">
            O cancelamento preserva a viagem e seus vínculos para rastreabilidade.
          </p>
          <Field label="Motivo do cancelamento">
            <Input value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} />
          </Field>
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setCancellingVoyageId(null)}>Voltar</Button>
            <Button variant="danger" loading={cancelling} disabled={!cancellationReason.trim()} onClick={handleCancelVoyage}>
              Continuar
            </Button>
          </div>
        </div>
      </Modal>

      <EscalaModal
        open={editingEscala !== null}
        escala={editingEscala}
        onClose={() => setEditingEscala(null)}
        onSaved={async (payload) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            await saveVoyageEscalaSchedule({
              voyageId: payload.voyageId,
              port: payload.port,
              eta: payload.eta,
              etb: payload.etb,
              ata: payload.ata,
              atb: payload.atb,
              etd: payload.etd,
              atd: payload.atd,
              rtw: payload.rtw,
              ceStatus: payload.ceStatus,
              linked: payload.linked,
              escalaNumber: payload.escalaNumber,
              temImportacao: payload.temImportacao,
              changedBy: user.id,
            })
            // Sem exportação declarada e sem linha anterior, não há o que gravar.
            if (payload.exportacao.temExportacao || payload.exportExistingId) {
              await saveVoyageExportSchedule({
                existingId: payload.exportExistingId,
                voyageId: payload.voyageId,
                pol: payload.port,
                temExportacao: payload.exportacao.temExportacao,
                hasGranite: payload.exportacao.hasGranite,
                containersQty: payload.exportacao.containersQty,
                movementsQty: payload.exportacao.movementsQty,
                ceStatus: payload.ceStatus,
                linked: payload.linked,
              })
            }
            await afterEscalaAlterada(queryClient, { voyageId: payload.voyageId })
            showToast('Escala salva com sucesso.', 'success')
            setEditingEscala(null)
          } catch {
            showToast('Falha ao salvar a escala.', 'error')
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
            await afterRotaAlterada(queryClient, { voyageId })
            showToast('Manifesto atualizado com sucesso.', 'success')
            setEditingPol(null)
          } catch {
            showToast('Falha ao salvar o manifesto.', 'error')
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
