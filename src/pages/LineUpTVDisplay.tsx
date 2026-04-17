import { useQuery } from '@tanstack/react-query'
import { fetchLineUpRows } from '../services/lineup'
import { LineUpTable } from '../components/lineup/LineUpTable'

export function LineUpTVDisplay() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['lineup-tv-display'],
    queryFn: fetchLineUpRows,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const lastUpdate = dataUpdatedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(dataUpdatedAt),
      )
    : '-'

  return (
    <main className="min-h-screen bg-[#07111f] px-4 py-4 text-white">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-sm uppercase tracking-[0.28em] text-[#8ca2c0]">Line Up TV</div>
        <div className="text-sm text-[#8ca2c0]">Atualizado: {lastUpdate}</div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          Falha ao carregar o quadro da TV.
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid min-h-[70vh] place-items-center text-lg text-[#8ca2c0]">Carregando line up...</div>
      ) : (
        <div className="overflow-hidden rounded-[28px] border border-[#22324a] bg-[#0d1628] shadow-[0_28px_80px_rgba(3,10,24,0.48)]">
          <LineUpTable
            rows={data ?? []}
            emptyTitle="Nenhuma escala disponivel."
            emptyDescription="Aguarde o proximo ciclo de atualizacao."
          />
        </div>
      )}
    </main>
  )
}
