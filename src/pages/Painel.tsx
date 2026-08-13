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
import { LineUpFilters } from '../components/lineup/LineUpFilters'
import { countActiveLineUpFilters, emptyLineUpFilters, filterLineUpRows, type LineUpFilters as LineUpFiltersState } from '../lib/lineupFilters'
import { fetchLineUpSnapshot } from '../services/lineup'
import { exportLineUpWorkbook } from '../services/exports'
import { markStartupStage } from '../lib/telemetry'

export function Painel() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<LineUpFiltersState>(emptyLineUpFilters)
  const [isExporting, setIsExporting] = useState(false)
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
    // ponytail: o snapshot cobre só as 60 viagens mais recentes; paginar ou ampliar a query quando o painel precisar de histórico maior.
    return filterLineUpRows(lineup?.rows ?? [], filters)
  }, [lineup, filters])
  const activeFilterCount = countActiveLineUpFilters(filters)

  useEffect(() => {
    if (lineup) markStartupStage('route-data')
  }, [lineup])

  async function handleExport() {
    setIsExporting(true)
    try {
      await exportLineUpWorkbook(rows)
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
            <button type="button" onClick={() => void refetch()} className="app-btn app-btn--secondary">
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Atualizar
            </button>
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
        }
      />

      <LineUpFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(emptyLineUpFilters())}
        activeCount={activeFilterCount}
        visibleCount={rows.length}
        totalCount={lineup?.rows.length ?? 0}
        loading={isLineUpLoading}
      />

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
            emptyDescription="Ajuste os filtros ou aguarde o próximo ciclo de atualização."
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
