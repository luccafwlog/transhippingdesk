import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  Monitor,
  RefreshCw,
  Ship,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { SkeletonTable } from '../components/ui/Skeleton'
import { LineUpTable } from '../components/lineup/LineUpTable'
import { fetchLineUpSnapshot, type LineUpRow } from '../services/lineup'

type FilterStatus = 'all' | 'active' | 'completed'

async function exportLineUpToExcel(rows: LineUpRow[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Navio: row.vesselName,
    Viagem: row.voyageNumber,
    POD: row.pod,
    Status: row.voyageStatus === 'completed' ? 'Concluída' : row.voyageStatus === 'active' ? 'Ativa' : row.voyageStatus ?? '',
    ETA: row.eta ?? '',
    ETB: row.etb ?? '',
    VIN: row.vin,
    'VIN CNTR': row.car,
    CG: row.cg,
    Total: row.total,
    MTY: row.mty,
    RTW: row.rtw ?? '',
    'BB Máquinas': row.bbMachines,
    'BB Pacotes': row.bbPackages,
    'BB Total': row.bbTotal,
    CEs: row.ceStatus,
    Linked: row.linked ? 'Sim' : 'Não',
  }))
  const ws = XLSX.utils.json_to_sheet(exportRows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Line Up')
  XLSX.writeFile(wb, `painel-lineup-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export function Painel() {
  const { showToast } = useToast()
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('active')
  const [isExporting, setIsExporting] = useState(false)
  // Relógio para destacar quando o quadro está sem atualização há muito tempo.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const {
    data: lineup,
    isLoading: isLineUpLoading,
    error: lineUpError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['lineup-tv-v3'],
    queryFn: fetchLineUpSnapshot,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const rows = useMemo(() => {
    const current = lineup?.rows ?? []
    if (statusFilter === 'all') return current
    return current.filter((row) => row.voyageStatus === statusFilter)
  }, [lineup, statusFilter])

  const lastUpdate = lineup?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(lineup.lastChangedAt),
      )
    : '-'
  const staleMinutes = lineup?.lastChangedAt
    ? Math.floor((now - new Date(lineup.lastChangedAt).getTime()) / 60000)
    : null
  const isStale = staleMinutes !== null && staleMinutes >= 10

  async function handleExport() {
    setIsExporting(true)
    try {
      await exportLineUpToExcel(rows)
    } catch {
      showToast('Falha ao exportar o Line Up.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Painel"
        description="Quadro Line Up consolidado com navegação direta aos dados operacionais."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/chegadas-saidas" className="app-btn app-btn--secondary">
              <Ship size={14} />
              Chegadas e Saídas
            </Link>
            <Link to="/line-up-tv/display" target="_blank" rel="noreferrer" className="app-btn app-btn--secondary">
              <Monitor size={14} />
              Abrir tela TV
            </Link>
            <span className={isStale ? 'text-xs font-semibold text-amber-500' : 'text-xs text-slate-500'}>
              Atualizado: {lastUpdate}
              {isStale ? ` (há ${staleMinutes} min)` : ''}
            </span>
            <button type="button" onClick={() => void refetch()} className="app-btn app-btn--secondary">
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        }
      />

      <Card className="mb-5 mt-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['active', 'completed', 'all'] as FilterStatus[]).map((filter) => (
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
          <button
            type="button"
            onClick={() => void handleExport()}
            className="app-btn app-btn--secondary"
            disabled={rows.length === 0 || isExporting}
          >
            <Download size={14} />
            Exportar Excel
          </button>
        </div>
      </Card>

      {lineUpError ? <InlineError message="Erro ao carregar o Line Up TV." /> : null}

      {isLineUpLoading ? (
        <Card className="p-0 overflow-hidden">
          <SkeletonTable rows={6} cols={8} />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <LineUpTable
            rows={rows}
            emptyTitle="Nenhuma escala encontrada."
            emptyDescription="Ajuste o filtro de status ou aguarde o proximo ciclo de atualizacao."
          />
          <p className="border-t border-[var(--app-border)] px-4 py-2 text-[11px] text-[var(--app-muted)]">
            VIN = veículos · VIN CNTR = containers com veículos · CG = carga geral · MTY = vazios · RTW = restow ·
            BB = break-bulk (máquinas/pacotes) · CEs = status dos CEs Mercante · Linked = manifesto vinculado
          </p>
        </Card>
      )}

    </>
  )
}
