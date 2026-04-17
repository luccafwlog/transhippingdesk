import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Field, Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageVehicleStats } from '../hooks/useVehicles'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy, countDistinctContainersAcrossGroups } from '../lib/containerCounts'
import { formatDate } from '../lib/utils'
import { deleteVoyage } from '../services/voyages'
import {
  buildVoyagePodEntityId,
  buildVoyagePolEntityId,
  listVoyagePodSchedules,
  listVoyagePolSchedules,
  saveVoyagePolSchedule,
  saveVoyagePodSchedule,
} from '../services/voyageRouteSchedules'

export function Viagens() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { isAdmin, user } = useAuth()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [editingVoyageId, setEditingVoyageId] = useState<number | null>(null)
  const [deletingVoyageId, setDeletingVoyageId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [vesselFilter, setVesselFilter] = useState('')
  const [voyageFilter, setVoyageFilter] = useState('')
  const [editingPod, setEditingPod] = useState<{
    voyageId: number
    voyageLabel: string
    pod: string
    eta: string | null
    ata: string | null
  } | null>(null)
  const [editingPol, setEditingPol] = useState<{
    voyageId: number
    voyageLabel: string
    pol: string
    etd: string | null
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

  const polEntityIds = useMemo(
    () =>
      Array.from(
        new Set(
          filteredVoyages.flatMap((voyage) =>
            collectVoyageRoutes(voyage.bls).map((route) => buildVoyagePolEntityId(voyage.id, route.pol)),
          ),
        ),
      ),
    [filteredVoyages],
  )

  const podEntityIds = useMemo(
    () =>
      Array.from(
        new Set(
          filteredVoyages.flatMap((voyage) =>
            collectVoyageRoutes(voyage.bls).map((route) => buildVoyagePodEntityId(voyage.id, route.pod)),
          ),
        ),
      ),
    [filteredVoyages],
  )
  const filteredVoyageIds = useMemo(() => filteredVoyages.map((voyage) => voyage.id), [filteredVoyages])
  const { data: vehicleStatsData } = useVoyageVehicleStats(filteredVoyageIds)
  const vehicleStatsByVoyage = useMemo(() => vehicleStatsData?.byVoyageId ?? {}, [vehicleStatsData])

  const { data: polSchedules } = useQuery({
    queryKey: ['voyage-pol-schedules', polEntityIds],
    enabled: polEntityIds.length > 0,
    queryFn: () => listVoyagePolSchedules(polEntityIds),
  })

  const { data: podSchedules } = useQuery({
    queryKey: ['voyage-pod-schedules', podEntityIds],
    enabled: podEntityIds.length > 0,
    queryFn: () => listVoyagePodSchedules(podEntityIds),
  })

  const summary = useMemo(
    () => ({
      active: filteredVoyages.filter((voyage) => voyage.status === 'active').length,
      totalContainerBls: filteredVoyages.reduce(
        (sum, voyage) => sum + splitVoyageBls(voyage.bls).containerBls.length,
        0,
      ),
      totalBreakbulkBls: filteredVoyages.reduce(
        (sum, voyage) => sum + splitVoyageBls(voyage.bls).breakbulkBls.length,
        0,
      ),
      totalContainers: countDistinctContainersAcrossGroups(
        filteredVoyages,
        (voyage) => splitVoyageBls(voyage.bls).containerBls.flatMap((bl) => bl.bl_containers ?? []),
      ),
      totalBreakbulkMachines: filteredVoyages.reduce(
        (sum, voyage) =>
          sum + splitVoyageBls(voyage.bls).breakbulkBls.reduce((itemSum, bl) => itemSum + Number(bl.bb_machine_qty ?? 0), 0),
        0,
      ),
      totalBreakbulkPackages: filteredVoyages.reduce(
        (sum, voyage) =>
          sum + splitVoyageBls(voyage.bls).breakbulkBls.reduce((itemSum, bl) => itemSum + Number(bl.bb_packages_qty ?? 0), 0),
        0,
      ),
      totalBreakbulkPackagesTotal: filteredVoyages.reduce(
        (sum, voyage) =>
          sum +
          splitVoyageBls(voyage.bls).breakbulkBls.reduce(
            (itemSum, bl) => itemSum + Number(bl.bb_packages_total ?? bl.bb_packages_qty ?? bl.bl_breakbulk_items?.length ?? 0),
            0,
          ),
        0,
      ),
      totalBreakbulkWeightTon: filteredVoyages.reduce(
        (sum, voyage) =>
          sum +
          splitVoyageBls(voyage.bls).breakbulkBls.reduce(
            (itemSum, bl) =>
              itemSum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
            0,
          ),
        0,
      ),
      totalVehicles: filteredVoyages.reduce(
        (sum, voyage) => sum + (vehicleStatsByVoyage[voyage.id]?.totalVehicles ?? 0),
        0,
      ),
    }),
    [filteredVoyages, vehicleStatsByVoyage],
  )
  const deletingVoyage = data?.find((voyage) => voyage.id === deletingVoyageId)

  async function handleDeleteVoyage() {
    if (!deletingVoyageId) return

    setDeleting(true)
    try {
      await deleteVoyage(deletingVoyageId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
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
        description="Cadastro de navio/viagem com metricas separadas para container e carga solta. Cada manifesto define seu proprio trecho POL/POD dentro da viagem."
        action={
          isAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Nova Viagem
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Viagens ativas" value={summary.active} />
        <MetricCard label="B/Ls CNTR" value={summary.totalContainerBls} />
        <MetricCard label="CNTRS distintos" value={summary.totalContainers} />
        <MetricCard label="B/Ls carga solta" value={summary.totalBreakbulkBls} />
        <MetricCard label="Maquinas BB" value={summary.totalBreakbulkMachines} />
        <MetricCard label="Packages BB" value={summary.totalBreakbulkPackages} />
        <MetricCard label="Packages Total BB" value={summary.totalBreakbulkPackagesTotal} />
        <MetricCard label="Weight BB (Ton)" value={Number(summary.totalBreakbulkWeightTon.toFixed(3))} />
        <MetricCard label="Veiculos vinculados" value={summary.totalVehicles} />
      </div>

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2">
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
      </Card>

      {error ? <InlineError message="Erro ao carregar viagens." /> : null}

      <div className="grid gap-4">
        {isLoading ? <Card>Carregando viagens...</Card> : null}
        {!isLoading && filteredVoyages.length === 0 ? (
          <EmptyState title="Nenhuma viagem encontrada." description="Ajuste os filtros ou crie uma nova viagem." />
        ) : null}
        {filteredVoyages.map((voyage) => {
          const vehicleStats = vehicleStatsByVoyage[voyage.id] ?? {
            totalVehicles: 0,
            distinctContainerCount: 0,
            containerNumbers: [],
            brandSummary: '-',
            vehicleByContainerTypeSummary: '-',
          }
          const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
          const totalBls = (voyage.bls ?? []).length
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
          const originPorts = collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null)
          const destinationPorts = collectVoyagePorts(voyage.bls, 'pod', voyage.pod?.name ?? null)
          const containerTypes = summarizeContainerTypes(flatContainers)
          const generalCargoContainerTypes = summarizeContainerTypes(generalCargoContainers)
          const polRows = originPorts.map((pol) => {
            const schedule = polSchedules?.get(buildVoyagePolEntityId(voyage.id, pol))
            return {
              pol,
              etd: schedule?.etd ?? null,
            }
          })
          const podRows = destinationPorts.map((pod) => {
            const schedule = podSchedules?.get(buildVoyagePodEntityId(voyage.id, pod))
            return {
              pod,
              eta: schedule?.eta ?? null,
              ata: schedule?.ata ?? null,
            }
          })
          const routeRows = collectVoyageRoutes(voyage.bls).map((route) => {
            const polEntityId = buildVoyagePolEntityId(voyage.id, route.pol)
            const podEntityId = buildVoyagePodEntityId(voyage.id, route.pod)
            const polSchedule = polSchedules?.get(polEntityId)
            const podSchedule = podSchedules?.get(podEntityId)

            return {
              ...route,
              etd: polSchedule?.etd ?? null,
              eta: podSchedule?.eta ?? null,
              ata: podSchedule?.ata ?? null,
            }
          })

          return (
            <Card key={voyage.id} className="grid gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    {voyage.vessel?.carrier?.name ?? 'Armador nao informado'}
                  </div>
                  <h2 className="text-xl font-bold text-white">
                    {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                  </h2>
                </div>
                <span className="rounded-full border border-[#1f6feb]/30 bg-[#1f6feb]/10 px-3 py-1 text-xs font-semibold text-[#8cc8ff]">
                  {voyage.status ?? 'active'}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-1">
                <dl className="grid gap-3 text-sm text-slate-300">
                  <Info label="Portos de Origem" value={originPorts.join(' | ') || 'Definidos por manifesto'} />
                  <Info label="Portos de Destino" value={destinationPorts.join(' | ') || 'Definidos por manifesto'} />
                  <Info label="B/Ls totais" value={String(totalBls)} />
                  <Info label="Trechos consolidados" value={String(routeRows.length)} />
                </dl>
              </div>

              <div className="grid gap-4 xl:grid-cols-4">
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

                <MetricPanel title="Carga solta">
                  <Info label="B/Ls carga solta" value={String(breakbulkBls.length)} />
                  <Info label="Maquinas" value={formatMetric(totalBreakbulkMachines)} />
                  <Info label="Packages" value={formatMetric(totalBreakbulkPackages)} />
                  <Info label="Packages total" value={formatMetric(totalBreakbulkPackagesTotal)} />
                  <Info label="Weight total" value={`${formatMetric(totalBreakbulkWeightTon)} ton`} />
                  <Info label="CBM total" value={formatMetric(totalBreakbulkCbm)} />
                </MetricPanel>

                <MetricPanel title="Veiculos">
                  <Info label="Veiculos vinculados" value={String(vehicleStats.totalVehicles)} />
                  <Info label="Containers com veiculos" value={String(vehicleStats.distinctContainerCount)} />
                  <Info label="Marcas de veiculos" value={vehicleStats.brandSummary} />
                  <Info label="Veiculos por tipo CNTR" value={vehicleStats.vehicleByContainerTypeSummary} />
                  <Info label="Tipos de Container" value={containerTypes || '-'} />
                </MetricPanel>
              </div>

              <div className="grid gap-4 2xl:grid-cols-12">
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 2xl:col-span-5">
                  <div className="mb-3">
                    <div className="font-semibold text-white">Datas dos Portos de Origem</div>
                    <div className="text-sm text-slate-400">
                      O ETD e identificado automaticamente pelo manifesto e pode ser ajustado manualmente por POL.
                    </div>
                  </div>

                  <div className="app-voyage-table-frame">
                    <div className="app-table-scroll">
                      <table className="app-table app-table--compact w-full table-fixed text-left text-sm whitespace-nowrap">
                        <colgroup>
                          <col className="w-[42%]" />
                          <col className="w-[38%]" />
                          <col className="w-[20%]" />
                        </colgroup>
                        <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="px-3 py-2">POL</th>
                            <th className="px-3 py-2">ETD</th>
                            <th className="px-3 py-2">Acoes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#30363d]">
                          {polRows.map((row) => (
                            <tr key={`${voyage.id}-pol-${row.pol}`}>
                              <td className="px-3 py-2 font-semibold text-white">{row.pol}</td>
                              <td className="px-3 py-2">{formatDate(row.etd)}</td>
                              <td className="px-3 py-2">
                                <Button
                                  variant="secondary"
                                  className="app-voyage-icon-btn"
                                  aria-label={`Editar ETD do POL ${row.pol}`}
                                  onClick={() =>
                                    setEditingPol({
                                      voyageId: voyage.id,
                                      voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                                      pol: row.pol,
                                      etd: row.etd,
                                    })
                                  }
                                >
                                  <Pencil size={15} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 2xl:col-span-7">
                  <div className="mb-3">
                    <div className="font-semibold text-white">Datas dos Portos de Destino</div>
                    <div className="text-sm text-slate-400">
                      ETA e ATA devem ser informados manualmente uma unica vez por POD.
                    </div>
                  </div>

                  <div className="app-voyage-table-frame">
                    <div className="app-table-scroll">
                      <table className="app-table app-table--compact w-full table-fixed text-left text-sm whitespace-nowrap">
                        <colgroup>
                          <col className="w-[28%]" />
                          <col className="w-[24%]" />
                          <col className="w-[24%]" />
                          <col className="w-[24%]" />
                        </colgroup>
                        <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="px-3 py-2">POD</th>
                            <th className="px-3 py-2">ETA</th>
                            <th className="px-3 py-2">ATA</th>
                            <th className="px-3 py-2">Acoes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#30363d]">
                          {podRows.map((row) => (
                            <tr key={`${voyage.id}-pod-${row.pod}`}>
                              <td className="px-3 py-2 font-semibold text-white">{row.pod}</td>
                              <td className="px-3 py-2">{formatDate(row.eta)}</td>
                              <td className="px-3 py-2">{formatDate(row.ata)}</td>
                              <td className="px-3 py-2">
                                <Button
                                  variant="secondary"
                                  className="app-voyage-icon-btn"
                                  aria-label={`Editar datas do POD ${row.pod}`}
                                  onClick={() =>
                                    setEditingPod({
                                      voyageId: voyage.id,
                                      voyageLabel: `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`,
                                      pod: row.pod,
                                      eta: row.eta,
                                      ata: row.ata,
                                    })
                                  }
                                >
                                  <Pencil size={15} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">Trechos consolidados</div>
                    <div className="text-sm text-slate-400">
                      Os trechos consolidados abaixo apenas exibem as datas herdadas dos cadastros de POL e POD.
                    </div>
                  </div>
                </div>

                <div className="app-voyage-table-frame">
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact min-w-[640px] text-left text-sm">
                      <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2">POL</th>
                          <th className="px-3 py-2">POD</th>
                          <th className="px-3 py-2">ETD</th>
                          <th className="px-3 py-2">ETA</th>
                          <th className="px-3 py-2">ATA</th>
                          <th className="px-3 py-2">B/Ls</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#30363d]">
                        {routeRows.length ? (
                          routeRows.map((route) => (
                            <tr key={`${voyage.id}-${route.pol}-${route.pod}`}>
                              <td className="px-3 py-2 font-semibold text-white">{route.pol}</td>
                              <td className="px-3 py-2 font-semibold text-white">{route.pod}</td>
                              <td className="px-3 py-2">{formatDate(route.etd)}</td>
                              <td className="px-3 py-2">{formatDate(route.eta)}</td>
                              <td className="px-3 py-2">{formatDate(route.ata)}</td>
                              <td className="px-3 py-2">{route.blCount}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-3 py-3 text-slate-400">
                              Nenhum trecho identificado nos manifestos desta viagem.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div>
                <div className="app-voyage-actions">
                  <Button
                    variant="secondary"
                    className="min-w-[170px]"
                    disabled={containerBls.length === 0}
                    onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}
                  >
                    Ver manifestos CNTR
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-w-[170px]"
                    disabled={breakbulkBls.length === 0}
                    onClick={() => navigate(`/carga-solta?voyage=${voyage.id}`)}
                  >
                    Ver manifestos BB
                  </Button>
                  {isAdmin ? (
                    <>
                      <Button variant="secondary" className="min-w-[150px]" onClick={() => setEditingVoyageId(voyage.id)}>
                        <Pencil size={16} />
                        Editar viagem
                      </Button>
                      <Button variant="danger" className="min-w-[150px]" onClick={() => setDeletingVoyageId(voyage.id)}>
                        <Trash2 size={16} />
                        Excluir viagem
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <VoyageCreateModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(voyageId) => navigate(`/manifestos?voyage=${voyageId}`)}
      />

      <VoyageCreateModal
        open={editingVoyageId !== null}
        onClose={() => setEditingVoyageId(null)}
        voyageId={editingVoyageId ?? undefined}
        title="Editar Viagem"
        initialValues={makeVoyageInitialValues(data?.find((voyage) => voyage.id === editingVoyageId))}
        onSaved={() => setEditingVoyageId(null)}
      />

      <Modal open={deletingVoyageId !== null} onClose={() => setDeletingVoyageId(null)} title="Excluir Viagem">
        <div className="grid gap-4">
          <div className="rounded-xl border border-red-400/30 bg-red-950/30 p-3 text-sm text-red-100">
            Esta exclusao e permanente. Ela so sera permitida se a viagem nao tiver importacoes nem B/Ls vinculados.
          </div>

          <div className="text-sm text-slate-300">
            {deletingVoyage ? (
              <>
                Confirme a exclusao de <span className="font-semibold text-white">{deletingVoyage.vessel?.name ?? 'Navio'} / {deletingVoyage.voyage_number}</span>.
              </>
            ) : (
              'Confirme a exclusao da viagem selecionada.'
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeletingVoyageId(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDeleteVoyage}>
              Excluir viagem
            </Button>
          </div>
        </div>
      </Modal>

      <PodScheduleModal
        open={editingPod !== null}
        podSchedule={editingPod}
        onClose={() => setEditingPod(null)}
        onSaved={async ({ voyageId, pod, eta, ata }) => {
          if (!user?.id) {
            showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
            return
          }
          try {
            await saveVoyagePodSchedule({
              voyageId,
              pod,
              eta,
              ata,
              changedBy: user.id,
            })
            await queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] })
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
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  const tone =
    label.includes('Veiculos')
      ? 'green'
      : label.includes('Weight')
        ? 'gold'
        : label.includes('CNTRS')
          ? 'blue'
          : 'navy'

  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  const tokens = tokenizeInfoValue(value)

  return (
    <div className="app-voyage-info">
      <span className="app-voyage-info__label">{label}</span>
      <div className="min-w-0">
        {tokens.length ? (
          <div className="app-voyage-token-list">
            {tokens.map((token) => (
              <span key={`${label}-${token}`} className="app-voyage-token">
                {token}
              </span>
            ))}
          </div>
        ) : (
          <span className="app-voyage-info__value">{value}</span>
        )}
      </div>
    </div>
  )
}

function MetricPanel({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="app-voyage-metric-panel">
      <div className="app-voyage-metric-panel__title">{title}</div>
      <dl className="grid gap-3 text-sm text-slate-300">{children}</dl>
    </div>
  )
}

function tokenizeInfoValue(value: string) {
  if (!value || value === '-') return []

  const tokens = value
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens.length > 1 ? tokens : []
}

type VoyageBl = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  pol: string | null
  pod: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  bl_containers?: Array<{
    id: number
    container_number: string
    type?: string | null
    is_oog?: boolean | null
    is_imo?: boolean | null
  }> | null
  bl_breakbulk_items?: Array<{
    id: number
    gross_weight_kg?: number | null
    cbm?: number | null
  }> | null
}

function splitVoyageBls(bls: VoyageBl[] | null | undefined) {
  const containerBls: VoyageBl[] = []
  const breakbulkBls: VoyageBl[] = []

  for (const bl of bls ?? []) {
    if (bl.cargo_mode === 'carga_solta') {
      breakbulkBls.push(bl)
    } else {
      containerBls.push(bl)
    }
  }

  return { containerBls, breakbulkBls }
}

function formatMetric(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

function collectVoyagePorts(
  bls: Array<{ pol: string | null; pod: string | null }> | null | undefined,
  field: 'pol' | 'pod',
  fallback: string | null,
) {
  const ports = Array.from(
    new Set(
      (bls ?? [])
        .map((bl) => bl[field]?.trim() ?? '')
        .filter(Boolean),
    ),
  )

  if (!ports.length && fallback) {
    return [fallback]
  }

  return ports
}

function collectVoyageRoutes(bls: Array<{ pol: string | null; pod: string | null }> | null | undefined) {
  const routes = new Map<string, { pol: string; pod: string; blCount: number }>()

  for (const bl of bls ?? []) {
    const pol = bl.pol?.trim() || '-'
    const pod = bl.pod?.trim() || '-'
    const key = `${pol}::${pod}`
    const current = routes.get(key)

    routes.set(
      key,
      current
        ? { ...current, blCount: current.blCount + 1 }
        : {
            pol,
            pod,
            blCount: 1,
          },
    )
  }

  return Array.from(routes.values())
}

function summarizeContainerTypes(
  containers:
    | Array<{
        container_number?: string | null
        type?: string | null
      }>
    | null
    | undefined,
) {
  const groups = new Map<string, Array<{ container_number?: string | null }>>()

  for (const container of containers ?? []) {
    const type = String(container.type ?? '').trim() || 'Nao informado'
    const current = groups.get(type)

    if (current) {
      current.push(container)
    } else {
      groups.set(type, [container])
    }
  }

  return Array.from(groups.entries())
    .map(([type, items]) => ({ type, count: countDistinctContainerNumbers(items) }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type, 'pt-BR'))
    .map(({ type, count }) => `${type}: ${count}`)
    .join(' | ')
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
) {
  if (!voyage) return undefined

  return {
    carrierName: voyage.vessel?.carrier?.name ?? '',
    carrierScac: voyage.vessel?.carrier?.scac ?? '',
    vesselName: voyage.vessel?.name ?? '',
    vesselImo: voyage.vessel?.imo ?? '',
    voyageNumber: voyage.voyage_number,
    status: normalizeVoyageStatus(voyage.status),
  }
}

function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

function PolScheduleModal({
  open,
  polSchedule,
  onClose,
  onSaved,
}: {
  open: boolean
  polSchedule: {
    voyageId: number
    voyageLabel: string
    pol: string
    etd: string | null
  } | null
  onClose: () => void
  onSaved: (payload: { voyageId: number; pol: string; etd: string | null }) => Promise<void>
}) {
  const [etd, setEtd] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!polSchedule || !open) return
    setEtd(polSchedule.etd ?? '')
  }, [open, polSchedule])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!polSchedule) return

    setSaving(true)
    try {
      await onSaved({
        voyageId: polSchedule.voyageId,
        pol: polSchedule.pol,
        etd: etd || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar ETD do POL">
      {polSchedule ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
            <div className="font-semibold text-white">{polSchedule.voyageLabel}</div>
            <div className="mt-1">POL: {polSchedule.pol}</div>
          </div>

          <Field label="ETD">
            <Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              Salvar ETD
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

function PodScheduleModal({
  open,
  podSchedule,
  onClose,
  onSaved,
}: {
  open: boolean
  podSchedule: {
    voyageId: number
    voyageLabel: string
    pod: string
    eta: string | null
    ata: string | null
  } | null
  onClose: () => void
  onSaved: (payload: { voyageId: number; pod: string; eta: string | null; ata: string | null }) => Promise<void>
}) {
  const [eta, setEta] = useState('')
  const [ata, setAta] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!podSchedule || !open) return
    setEta(podSchedule.eta ?? '')
    setAta(podSchedule.ata ?? '')
  }, [open, podSchedule])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!podSchedule) return

    setSaving(true)
    try {
      await onSaved({
        voyageId: podSchedule.voyageId,
        pod: podSchedule.pod,
        eta: eta || null,
        ata: ata || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar datas do POD">
      {podSchedule ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
            <div className="font-semibold text-white">{podSchedule.voyageLabel}</div>
            <div className="mt-1">POD: {podSchedule.pod}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ETA">
              <Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
            </Field>
            <Field label="ATA">
              <Input type="date" value={ata} onChange={(event) => setAta(event.target.value)} />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              Salvar datas
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}
