import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { supabase } from '../services/supabase'
import { buildVoyagePodEntityId, listVoyagePodSchedules } from '../services/voyageRouteSchedules'

type VoyageStatus = 'active' | 'completed' | 'cancelled' | null
type FilterStatus = 'all' | 'active' | 'completed'

type RouteContainer = {
  id: number
  container_number: string | null
  tare_weight_kg: number | null
  gross_weight_kg: number | null
}

type RouteBl = {
  id: string
  pod: string | null
  cargo_mode: 'container' | 'carga_solta' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bl_containers: RouteContainer[] | null
}

type RouteVehicle = {
  voyage_id: number
  container_id: number
}

type RawVoyage = {
  id: number
  voyage_number: string
  status: VoyageStatus
  vessel: { name: string; carrier: { name: string; scac: string | null } | null } | null
  bls: RouteBl[] | null
}

type RouteRow = {
  id: string
  voyageId: number
  voyageNumber: string
  voyageStatus: VoyageStatus
  vesselName: string
  pod: string
  eta: string | null
  etb: string | null
  vin: number
  car: number
  cg: number
  total: number
  mty: number
  rtw: number | null
  bbMachines: number
  bbPackages: number
  bbTotal: number
  ceStatus: 'approved' | 'partial' | 'missing'
  linked: boolean
}

async function fetchLineUpRows(): Promise<RouteRow[]> {
  const { data, error } = await supabase
    .from('voyages')
    .select(
      `
      id,
      voyage_number,
      status,
      vessel:vessels(name, carrier:carriers(name, scac)),
      bls(
        id,
        pod,
        cargo_mode,
        ce_mercante,
        bb_machine_qty,
        bb_packages_qty,
        bl_containers(id, container_number, tare_weight_kg, gross_weight_kg)
      )
    `,
    )
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) throw error

  const voyages = (data ?? []) as unknown as RawVoyage[]
  const voyageIds = voyages.map((voyage) => voyage.id)

  const [{ data: vehicles, error: vehiclesError }, podSchedules] = await Promise.all([
    voyageIds.length
      ? supabase.from('vehicles').select('voyage_id, container_id').in('voyage_id', voyageIds).limit(20_000)
      : Promise.resolve({ data: [], error: null }),
    listVoyagePodSchedules(
      voyages.flatMap((voyage) =>
        Array.from(new Set((voyage.bls ?? []).map((bl) => buildVoyagePodEntityId(voyage.id, bl.pod)))),
      ),
    ),
  ])

  if (vehiclesError) throw vehiclesError

  const vehiclesByVoyage = new Map<number, RouteVehicle[]>()
  for (const vehicle of ((vehicles ?? []) as RouteVehicle[])) {
    const current = vehiclesByVoyage.get(vehicle.voyage_id) ?? []
    current.push(vehicle)
    vehiclesByVoyage.set(vehicle.voyage_id, current)
  }

  const rows: RouteRow[] = []

  for (const voyage of voyages) {
    const bls = voyage.bls ?? []
    const voyageVehicles = vehiclesByVoyage.get(voyage.id) ?? []
    const routeKeys = Array.from(new Set(bls.map((bl) => normalizePort(bl.pod))))

    for (const pod of routeKeys) {
      const routeBls = bls.filter((bl) => normalizePort(bl.pod) === pod)
      const scheduleKey = buildVoyagePodEntityId(voyage.id, pod)
      const schedule = podSchedules.get(scheduleKey)
      if (schedule?.atd) continue

      const distinctContainers = new Map<
        string,
        {
          id: number
          gross: number
          tare: number
        }
      >()

      for (const bl of routeBls) {
        for (const container of bl.bl_containers ?? []) {
          const key = normalizeContainerKey(container.container_number, container.id)
          if (!key || distinctContainers.has(key)) continue
          distinctContainers.set(key, {
            id: container.id,
            gross: Number(container.gross_weight_kg ?? 0),
            tare: Number(container.tare_weight_kg ?? 0),
          })
        }
      }

      const routeContainerIds = new Set(Array.from(distinctContainers.values()).map((container) => container.id))
      const vehicleContainerKeys = new Set<string>()
      const routeVehicles = voyageVehicles.filter((vehicle) => routeContainerIds.has(vehicle.container_id))
      for (const vehicle of routeVehicles) {
        for (const [containerKey, container] of distinctContainers.entries()) {
          if (container.id === vehicle.container_id) {
            vehicleContainerKeys.add(containerKey)
            break
          }
        }
      }

      const totalContainers = distinctContainers.size
      const carContainers = vehicleContainerKeys.size
      const bbMachines = routeBls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)
      const bbPackages = routeBls.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0)
      const ceFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
      const autoCeStatus =
        ceFilledCount === routeBls.length && routeBls.length > 0
          ? 'approved'
          : ceFilledCount > 0
            ? 'partial'
            : 'missing'

      rows.push({
        id: `${voyage.id}::${pod}`,
        voyageId: voyage.id,
        voyageNumber: voyage.voyage_number,
        voyageStatus: voyage.status,
        vesselName: voyage.vessel?.name ?? '-',
        pod,
        eta: schedule?.eta ?? null,
        etb: schedule?.etb ?? null,
        vin: routeVehicles.length,
        car: carContainers,
        cg: Math.max(totalContainers - carContainers, 0),
        total: totalContainers,
        mty: Array.from(distinctContainers.values()).filter(isEmptyLikeContainer).length,
        rtw: schedule?.rtw ?? null,
        bbMachines,
        bbPackages,
        bbTotal: bbMachines + bbPackages,
        ceStatus: schedule?.ceStatus ?? autoCeStatus,
        linked: schedule?.linked ?? Boolean(schedule?.eta || schedule?.etb || schedule?.ata || schedule?.atd),
      })
    }
  }

  return rows.sort((left, right) => {
    if (left.vesselName !== right.vesselName) return left.vesselName.localeCompare(right.vesselName, 'pt-BR')
    if (left.voyageNumber !== right.voyageNumber) return left.voyageNumber.localeCompare(right.voyageNumber, 'pt-BR')
    return left.pod.localeCompare(right.pod, 'pt-BR')
  })
}

export function LineUpTV() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['lineup-tv-v2'],
    queryFn: fetchLineUpRows,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const rows = useMemo(() => {
    const current = data ?? []
    if (statusFilter === 'all') return current
    return current.filter((row) => row.voyageStatus === statusFilter)
  }, [data, statusFilter])

  const summary = useMemo(() => {
    return {
      routes: rows.length,
      totalContainers: rows.reduce((sum, row) => sum + row.total, 0),
      vehicles: rows.reduce((sum, row) => sum + row.vin, 0),
      approvedCe: rows.filter((row) => row.ceStatus === 'approved').length,
    }
  }, [rows])

  const lastUpdate = dataUpdatedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(dataUpdatedAt),
      )
    : '-'

  return (
    <>
      <PageHeader
        title="Line up TV"
        description="Quadro consolidado por viagem e POD com foco na operacao atual do porto de descarga."
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Atualizado: {lastUpdate}</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="app-btn app-btn--secondary"
            >
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <LineUpMetricCard label="Rotas exibidas" value={String(summary.routes)} tone="navy" />
        <LineUpMetricCard label="CNTRs no quadro" value={String(summary.totalContainers)} tone="blue" />
        <LineUpMetricCard label="Veiculos" value={String(summary.vehicles)} tone="green" />
        <LineUpMetricCard label="CEs approved" value={String(summary.approvedCe)} tone="gold" />
      </div>

      <Card className="mb-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'completed'] as FilterStatus[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`app-tab ${statusFilter === filter ? 'app-tab--active' : ''}`}
              >
                {filter === 'all' ? 'Todas as escalas' : filter === 'active' ? 'Escalas ativas' : 'Escalas concluidas'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">ETB vinculado ao cadastro manual do POD</Badge>
            <Badge tone="green">ATD remove a rota do quadro</Badge>
            <Badge tone="slate">RTW sem origem dedicada ainda</Badge>
          </div>
        </div>
      </Card>

      {error ? <InlineError message="Erro ao carregar o Line Up TV." /> : null}

      {isLoading ? (
        <div className="py-16 text-center text-slate-400">Carregando line up...</div>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="app-table-scroll">
            <table className="app-table app-table--dense app-table--lineup min-w-[1180px] table-fixed text-left text-[12px]">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[5%]" />
                <col className="w-[7%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[5%]" />
                <col className="w-[5%]" />
                <col className="w-[5%]" />
                <col className="w-[6%]" />
                <col className="w-[5%]" />
                <col className="w-[5%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-3">Vessel</th>
                  <th className="px-3 py-3 text-center">Voy</th>
                  <th className="px-3 py-3 text-center">POD</th>
                  <th className="px-3 py-3 text-center">ETA</th>
                  <th className="px-3 py-3 text-center">ETB</th>
                  <th className="px-3 py-3 text-center">VIN</th>
                  <th className="px-3 py-3 text-center">CAR</th>
                  <th className="px-3 py-3 text-center">CG</th>
                  <th className="px-3 py-3 text-center">Total</th>
                  <th className="px-3 py-3 text-center">MTY</th>
                  <th className="px-3 py-3 text-center">RTW</th>
                  <th className="px-3 py-3">BB</th>
                  <th className="px-3 py-3 text-center">CEs</th>
                  <th className="px-3 py-3 text-center">Linked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="p-0">
                      <EmptyState
                        title="Nenhuma escala encontrada."
                        description="Ajuste o filtro de status ou aguarde o proximo ciclo de atualizacao."
                      />
                    </td>
                  </tr>
                ) : null}

                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2 py-2 font-semibold text-white">{row.vesselName}</td>
                    <td className="px-3 py-3 text-center font-semibold text-white">{row.voyageNumber}</td>
                    <td className="px-3 py-3 text-center font-semibold text-white">{row.pod}</td>
                    <td className="px-3 py-3 text-center">{formatShortDate(row.eta)}</td>
                    <td className="px-3 py-3 text-center">{formatShortDate(row.etb)}</td>
                    <td className="px-3 py-3 text-center font-semibold text-white">{formatInteger(row.vin)}</td>
                    <td className="px-3 py-3 text-center">{formatInteger(row.car)}</td>
                    <td className="px-3 py-3 text-center">{formatInteger(row.cg)}</td>
                    <td className="px-3 py-3 text-center font-semibold text-[#58a6ff]">{formatInteger(row.total)}</td>
                    <td className="px-3 py-3 text-center">{formatInteger(row.mty)}</td>
                    <td className="px-3 py-3 text-center">{row.rtw === null ? '-' : formatInteger(row.rtw)}</td>
                    <td className="px-3 py-3">
                      <div className="app-lineup-bb">
                        <span>{formatInteger(row.bbMachines)} MAQ</span>
                        <span>{formatInteger(row.bbPackages)} PACK</span>
                        <span>{formatInteger(row.bbTotal)} TOTAL</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">{renderCeStatus(row.ceStatus)}</td>
                    <td className="px-3 py-3 text-center">
                      <Badge tone={row.linked ? 'green' : 'yellow'}>{row.linked ? 'YES' : 'NO'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

function LineUpMetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'navy' | 'blue' | 'green' | 'gold'
}) {
  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
    </Card>
  )
}

function renderCeStatus(status: RouteRow['ceStatus']) {
  if (status === 'approved') return <Badge tone="green">Approved</Badge>
  if (status === 'partial') return <Badge tone="yellow">Partial</Badge>
  return <Badge tone="red">Missing</Badge>
}

function formatShortDate(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(value))
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value ?? 0))
}

function normalizePort(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

function normalizeContainerKey(containerNumber: string | null | undefined, containerId: number) {
  const number = String(containerNumber ?? '').trim().toUpperCase()
  if (number) return number
  return Number.isInteger(containerId) ? `ID-${containerId}` : ''
}

function isEmptyLikeContainer(container: { gross: number; tare: number }) {
  if (container.gross <= 0) return true
  if (container.tare > 0 && container.gross <= container.tare) return true
  return false
}
