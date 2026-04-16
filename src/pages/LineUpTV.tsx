import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { PageHeader } from '../components/ui/Card'
import { supabase } from '../services/supabase'

type VoyageTV = {
  id: number
  voyage_number: string
  etd: string | null
  eta: string | null
  ata: string | null
  status: string | null
  vessel: { name: string; carrier: { name: string; scac: string | null } | null } | null
  pol: { locode: string | null; name: string } | null
  pod: { locode: string | null; name: string } | null
  blCount: number
  containerCount: number
  bbCount: number
}

async function fetchVoyagesForTV(): Promise<VoyageTV[]> {
  const { data, error } = await supabase
    .from('voyages')
    .select(
      `
      id, voyage_number, etd, eta, ata, status,
      vessel:vessels(name, carrier:carriers(name, scac)),
      pol:ports!voyages_pol_id_fkey(locode, name),
      pod:ports!voyages_pod_id_fkey(locode, name),
      bls(id, cargo_mode, bl_containers(container_number))
    `,
    )
    .in('status', ['active', 'completed'])
    .order('etd', { ascending: false, nullsFirst: false })
    .limit(60)

  if (error) throw error

  type RawBl = {
    id: string
    cargo_mode: string | null
    bl_containers: { container_number: string | null }[]
  }

  return ((data ?? []) as unknown as Array<{
    id: number
    voyage_number: string
    etd: string | null
    eta: string | null
    ata: string | null
    status: string | null
    vessel: { name: string; carrier: { name: string; scac: string | null } | null } | null
    pol: { locode: string | null; name: string } | null
    pod: { locode: string | null; name: string } | null
    bls: RawBl[]
  }>).map((row) => {
    const bls = row.bls ?? []
    const distinctContainers = new Set<string>()
    let bbCount = 0
    for (const bl of bls) {
      if (bl.cargo_mode === 'carga_solta') {
        bbCount++
      } else {
        for (const c of bl.bl_containers ?? []) {
          if (c.container_number) distinctContainers.add(c.container_number)
        }
      }
    }
    return {
      id: row.id,
      voyage_number: row.voyage_number,
      etd: row.etd,
      eta: row.eta,
      ata: row.ata,
      status: row.status,
      vessel: row.vessel,
      pol: row.pol,
      pod: row.pod,
      blCount: bls.length,
      containerCount: distinctContainers.size,
      bbCount,
    }
  })
}

const STATUS_LABEL: Record<string, { label: string; tone: 'green' | 'blue' | 'slate' | 'red' }> = {
  active: { label: 'Ativa', tone: 'green' },
  completed: { label: 'Concluida', tone: 'slate' },
  cancelled: { label: 'Cancelada', tone: 'red' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(iso))
}

type FilterStatus = 'all' | 'active' | 'completed'

export function LineUpTV() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['lineup-tv'],
    queryFn: fetchVoyagesForTV,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const voyages = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'all') return data
    return data.filter((v) => v.status === statusFilter)
  }, [data, statusFilter])

  const lastUpdate = dataUpdatedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(dataUpdatedAt),
      )
    : '-'

  return (
    <>
      <PageHeader
        title="Line up TV"
        description="Visao consolidada de viagens ativas e concluidas. Atualiza automaticamente a cada 90 segundos."
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Atualizado: {lastUpdate}</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-[#21262d] transition-colors"
            >
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        {(['all', 'active', 'completed'] as FilterStatus[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f ? 'bg-[#30363d] text-white' : 'text-slate-400 hover:bg-[#21262d] hover:text-slate-200'
            }`}
          >
            {f === 'all' ? 'Todas' : f === 'active' ? 'Ativas' : 'Concluidas'}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">{voyages.length} viagem{voyages.length !== 1 ? 's' : ''}</span>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-900/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
          Erro ao carregar viagens.
        </div>
      ) : null}

      {isLoading ? (
        <div className="py-16 text-center text-slate-400">Carregando line up...</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#30363d]">
          <table className="app-table min-w-[1080px] w-full text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Armador / Navio</th>
                <th className="px-4 py-3">Viagem</th>
                <th className="px-4 py-3">Rota</th>
                <th className="px-4 py-3">ETD</th>
                <th className="px-4 py-3">ETA</th>
                <th className="px-4 py-3">ATA</th>
                <th className="px-4 py-3 text-right">B/Ls</th>
                <th className="px-4 py-3 text-right">Containers</th>
                <th className="px-4 py-3 text-right">BB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {voyages.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    Nenhuma viagem encontrada.
                  </td>
                </tr>
              ) : null}
              {voyages.map((v) => {
                const statusMeta = STATUS_LABEL[v.status ?? ''] ?? { label: v.status ?? '-', tone: 'slate' as const }
                return (
                  <tr
                    key={v.id}
                    className={`hover:bg-[#21262d]/60 ${v.status === 'completed' ? 'opacity-70' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{v.vessel?.name ?? '-'}</div>
                      <div className="text-xs text-slate-400">
                        {v.vessel?.carrier?.name ?? '-'}
                        {v.vessel?.carrier?.scac ? ` (${v.vessel.carrier.scac})` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-200">{v.voyage_number}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-300">
                        {v.pol?.locode ?? v.pol?.name ?? '-'}
                      </span>
                      <span className="mx-1 text-slate-600">→</span>
                      <span className="font-mono text-xs text-slate-300">
                        {v.pod?.locode ?? v.pod?.name ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-200">{fmtDate(v.etd)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">{fmtDate(v.eta)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{fmtDate(v.ata)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{v.blCount}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{v.containerCount}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{v.bbCount || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
