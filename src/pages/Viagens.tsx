import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { formatDate } from '../lib/utils'

export function Viagens() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [editingVoyageId, setEditingVoyageId] = useState<number | null>(null)

  const summary = useMemo(
    () => ({
      active: data?.filter((voyage) => voyage.status === 'active').length ?? 0,
      totalBls: data?.reduce((sum, voyage) => sum + (voyage.bls?.length ?? 0), 0) ?? 0,
      totalContainers:
        data?.reduce(
          (sum, voyage) =>
            sum +
            (voyage.bls?.reduce((blSum, bl) => blSum + (bl.bl_containers?.length ?? 0), 0) ?? 0),
          0,
        ) ?? 0,
    }),
    [data],
  )

  return (
    <>
      <PageHeader
        title="Viagens"
        description="Cadastro de navio/viagem. Cada manifesto importado define seu proprio trecho POL/POD dentro da viagem."
        action={
          isAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Nova Viagem
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Viagens ativas" value={summary.active} />
        <MetricCard label="B/Ls vinculados" value={summary.totalBls} />
        <MetricCard label="Containers vinculados" value={summary.totalContainers} />
      </div>

      {error ? <Card className="mb-5 text-red-200">Erro ao carregar viagens.</Card> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {isLoading ? <Card>Carregando viagens...</Card> : null}
        {data?.map((voyage) => {
          const totalBls = voyage.bls?.length ?? 0
          const totalContainers = voyage.bls?.reduce((sum, bl) => sum + (bl.bl_containers?.length ?? 0), 0) ?? 0

          return (
            <Card key={voyage.id} className="grid gap-4">
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

              <dl className="grid gap-2 text-sm text-slate-300">
                <Info label="Trechos" value={summarizeVoyageRoutes(voyage)} />
                <Info label="ETD" value={formatDate(voyage.etd)} />
                <Info label="ETA" value={formatDate(voyage.eta)} />
                <Info label="ATA" value={formatDate(voyage.ata)} />
                <Info label="B/Ls" value={String(totalBls)} />
                <Info label="Containers" value={String(totalContainers)} />
              </dl>

              <div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}>
                    Ver manifestos desta viagem
                  </Button>
                  {isAdmin ? (
                    <Button variant="secondary" onClick={() => setEditingVoyageId(voyage.id)}>
                      Editar viagem
                    </Button>
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
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-white">{value}</span>
    </div>
  )
}

function summarizeVoyageRoutes(voyage: {
  pol?: { name: string | null } | null
  pod?: { name: string | null } | null
  bls?: Array<{ pol: string | null; pod: string | null }> | null
}) {
  const routeLabels = Array.from(
    new Set(
      (voyage.bls ?? [])
        .map((bl) => formatRoute(bl.pol, bl.pod))
        .filter((route): route is string => Boolean(route)),
    ),
  )

  if (routeLabels.length === 0) {
    const legacyRoute = formatRoute(voyage.pol?.name ?? null, voyage.pod?.name ?? null)
    return legacyRoute ?? 'Definidos por manifesto'
  }

  if (routeLabels.length === 1) return routeLabels[0]
  if (routeLabels.length === 2) return routeLabels.join(' | ')
  return `${routeLabels.slice(0, 2).join(' | ')} +${routeLabels.length - 2}`
}

function formatRoute(pol: string | null, pod: string | null) {
  if (!pol && !pod) return null
  return `${pol ?? '-'} -> ${pod ?? '-'}`
}

function makeVoyageInitialValues(
  voyage:
    | {
        voyage_number: string
        etd: string | null
        eta: string | null
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
    etd: voyage.etd ? toLocalDatetimeInput(voyage.etd) : '',
    eta: voyage.eta ? toLocalDatetimeInput(voyage.eta) : '',
    status: normalizeVoyageStatus(voyage.status),
  }
}

function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

function toLocalDatetimeInput(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60_000)
  return localDate.toISOString().slice(0, 16)
}
