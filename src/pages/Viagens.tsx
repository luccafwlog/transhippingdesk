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
        description="Cards por navio/viagem com criação de nova viagem e redirecionamento para os manifestos."
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
                    {voyage.vessel?.carrier?.name ?? 'Armador não informado'}
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
                <Info label="POL" value={voyage.pol?.name ?? '-'} />
                <Info label="POD" value={voyage.pod?.name ?? '-'} />
                <Info label="ETD" value={formatDate(voyage.etd)} />
                <Info label="ETA" value={formatDate(voyage.eta)} />
                <Info label="ATA" value={formatDate(voyage.ata)} />
                <Info label="B/Ls" value={String(totalBls)} />
                <Info label="Containers" value={String(totalContainers)} />
              </dl>

              <div>
                <Button variant="secondary" onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}>
                  Ver manifestos desta viagem
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <VoyageCreateModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(voyageId) => navigate(`/manifestos?voyage=${voyageId}`)}
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
