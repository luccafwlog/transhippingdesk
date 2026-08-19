import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
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
import {
  buildVoyageRailItems,
  collectVoyagePorts,
  normalizeVoyageStatus,
  type VoyageRailModuleStats,
} from '../services/voyageSummaries'
import { cancelVoyage, deleteVoyage } from '../services/voyages'
import { setImportBatchCeMaster } from '../services/manifestImport'
import {
  buildVoyagePolEntityId,
  saveVoyageEscalaSchedule,
  saveVoyagePolSchedule,
  setVoyageRouteCeMaster,
} from '../services/voyageRouteSchedules'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import {
  saveVoyageExportScheduleTransactional,
  VoyageExportScheduleBlockedError,
} from '../services/voyageExportSchedules'
import {
  EscalaTerminalBlockedError,
  fetchEscalaTerminalState,
  saveEscalaTerminalState,
} from '../services/escalaTerminalAllocation'
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

function makeTerminalScaleLoadingState(voyageId: number, port: string): NonNullable<EscalaModalData['terminalScale']> {
  return {
    voyageId,
    port,
    portId: null,
    revision: 0,
    fronts: [],
    tbcFronts: [],
    terminals: [],
    activeTerminals: [],
    historicalTerminals: [],
    agencyReports: [],
    loading: true,
  }
}

export function Viagens() {
  const { voyageId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { user, profile } = useAuth()
  const canEditVoyages = Boolean(profile || user)
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
  const initialReportId = searchParams.get('report') ?? searchParams.get('reportId') ?? undefined
  const initialTerminalCode = searchParams.get('terminal') ?? searchParams.get('terminalCode') ?? undefined
  const [filters, setFilters] = useState<VoyageFiltersState>({
    ...emptyFilters(),
    search: initialVessel,
  })

  useEffect(() => {
    const current = editingEscala
    if (!current?.port || !current.terminalScale?.loading) return
    let mounted = true
    const loadingState = current.terminalScale
    void fetchEscalaTerminalState(current.voyageId, current.port)
      .then((state) => {
        if (!mounted) return
        setEditingEscala((previous) => previous?.voyageId === current.voyageId && previous.port === current.port
          ? { ...previous, terminalScale: state }
          : previous)
      })
      .catch((error: unknown) => {
        if (!mounted) return
        setEditingEscala((previous) => previous?.voyageId === current.voyageId && previous.port === current.port
          ? { ...previous, terminalScale: { ...loadingState, loading: false, error: error instanceof Error ? error.message : 'Falha ao carregar frentes e terminais.' } }
          : previous)
      })
    return () => { mounted = false }
  }, [editingEscala])
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

  const moduleStatsByVoyageId = useMemo(() => {
    const map = new Map<number, VoyageRailModuleStats>()
    for (const voyage of voyages) {
      map.set(voyage.id, {
        hasVehicles: (vehicleStatsByVoyage[voyage.id]?.totalVehicles ?? 0) > 0,
        vehicleContainerNumbers: vehicleStatsByVoyage[voyage.id]?.containerNumbers ?? [],
        hasVaziosImportacao: (vaziosImpStatsByVoyage[voyage.id]?.totalManifests ?? 0) > 0,
        hasGranite: Array.from(exportSchedulesData?.get(voyage.id)?.values() ?? []).some(
          (schedule) => schedule.hasGranite,
        ),
        hasVaziosExportacao: Array.from(exportSchedulesData?.get(voyage.id)?.values() ?? []).some(
          (schedule) => schedule.hasEmpty,
        ),
      })
    }
    return map
  }, [voyages, vehicleStatsByVoyage, vaziosImpStatsByVoyage, exportSchedulesData])

  const railItems = useMemo(
    () => buildVoyageRailItems(voyages, escalaSchedulesByVoyage, moduleStatsByVoyageId),
    [voyages, escalaSchedulesByVoyage, moduleStatsByVoyageId],
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
          canEditVoyages ? (
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

      <div className="grid gap-4">
        {isLoading ? (
          <SkeletonCard lines={3} />
        ) : (
          <VoyageRail
            items={visibleRailItems}
            selectedId={selectedVoyageId}
            onSelect={(id) => navigate(`/viagens/${id}`)}
            onEdit={canEditVoyages ? setEditingVoyageId : undefined}
          />
        )}

        {!selectedVoyageId ? (
          <EmptyState
            title="Selecione uma viagem"
            description="Escolha uma viagem na faixa acima para ver o detalhe, planejamento de escalas e os fluxos de importação e exportação."
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
            onEditEscala={(payload) => setEditingEscala(
              payload.port ? { ...payload, terminalScale: makeTerminalScaleLoadingState(payload.voyageId, payload.port) } : payload,
            )}
            onEditPol={setEditingPol}
            initialTab={initialTab}
            initialEscala={initialEscala}
            initialReportId={initialReportId}
            initialTerminalCode={initialTerminalCode}
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
        onReopenAdr={(blocker) => {
          const port = editingEscala?.port
          if (!port) return
          const target = editingEscala
          setEditingEscala(null)
          const params = new URLSearchParams({ tab: 'adr', escala: port })
          if (blocker.reportId) params.set('report', blocker.reportId)
          if (blocker.terminalCode) params.set('terminal', blocker.terminalCode)
          navigate(`/viagens/${target.voyageId}?${params.toString()}`)
        }}
        onSaved={async (payload) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            if (payload.terminalState) {
              await saveEscalaTerminalState({
                voyageId: payload.voyageId,
                port: payload.port,
                expectedRevision: payload.terminalState.expectedRevision,
                fronts: payload.terminalState.fronts,
                terminals: payload.terminalState.terminals,
                exportExpectation: {
                  ...payload.terminalState.exportExpectation,
                  // A escala terminalizada e o POD pertencem à mesma
                  // transação: a RPC registra estes campos junto das frentes.
                  schedule: {
                    eta: payload.eta,
                    etb: payload.etb,
                    ata: payload.ata,
                    atb: payload.atb,
                    etd: payload.etd,
                    atd: payload.atd,
                    rtw: payload.rtw,
                    ce_status: payload.ceStatus,
                    linked: payload.linked,
                    escala_number: payload.escalaNumber,
                    tem_importacao: payload.temImportacao,
                    changed_by: user.id,
                  },
                },
                justification: payload.terminalState.justification,
                queryClient,
              })
            } else if (payload.exportacao.temExportacao || payload.exportExistingId) {
              // Escalas legadas continuam no fluxo exportacional existente até
              // que o estado terminalizado seja carregado para o modal.
              await saveVoyageExportScheduleTransactional({
                existingId: payload.exportExistingId,
                voyageId: payload.voyageId,
                pol: payload.port,
                temExportacao: payload.exportacao.temExportacao,
                hasGranite: payload.exportacao.hasGranite,
                hasEmpty: payload.exportacao.hasEmpty,
                containersQty: payload.exportacao.containersQty,
                movementsQty: payload.exportacao.movementsQty,
                dischargePorts: payload.exportacao.dischargePorts,
                ceStatus: payload.ceStatus,
                linked: payload.linked,
                // O modal legado não edita estado terminalizado; a revisão
                // inicial da escala ainda sem state é zero. A RPC não relê a
                // revisão, preservando a semântica de compare-and-swap.
                expectedRevision: 0,
              })
            }
            if (!payload.terminalState) await saveVoyageEscalaSchedule({
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
            await afterEscalaAlterada(queryClient, { voyageId: payload.voyageId })
            showToast('Escala salva com sucesso.', 'success')
            setEditingEscala(null)
          } catch (error) {
            if (error instanceof EscalaTerminalBlockedError) {
              const blockers = error.blockers
                .map((blocker) => [blocker.terminalCode, blocker.reportId].filter(Boolean).join(' / '))
                .filter(Boolean)
                .join(', ')
              showToast(`Alteração bloqueada por ADR fechado${blockers ? ` (${blockers})` : ''}. Reabra o ADR antes de continuar.`, 'error')
              throw error
            }
            if (error instanceof VoyageExportScheduleBlockedError) {
              const blockers = error.result.closed_blockers
                .map((blocker) => [blocker.terminal_code, blocker.report_id].filter(Boolean).join(' / '))
                .filter(Boolean)
                .join(', ')
              showToast(`Exportação bloqueada por ADR fechado${blockers ? ` (${blockers})` : ''}. Reabra o ADR antes de alterar a escala.`, 'error')
              throw error
            }
            if (error instanceof Error && /REVISAO_OBSOLETA|revis[aã]o.*(obsoleta|atualizada)/i.test(error.message)) {
              showToast('A escala foi atualizada por outra pessoa. Recarregue antes de salvar novamente.', 'error')
              throw error
            }
            showToast('Falha ao salvar a escala.', 'error')
            throw error
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
