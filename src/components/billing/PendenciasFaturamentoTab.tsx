import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { useToast } from '../ui/Toast'
import { PendenciasTable } from './PendenciasTable'
import {
  useBatchCalculateLocalCharges,
  useLocalChargeOperations,
} from '../../hooks/useLocalCharges'

export function PendenciasFaturamentoTab({ userId }: { userId: string | null }) {
  const { showToast } = useToast()
  const {
    data: pendingRows,
    isLoading,
    error,
  } = useLocalChargeOperations({
    chargeStatus: 'review_required',
    limit: 1200,
  })
  const recalculateMutation = useBatchCalculateLocalCharges()
  const rows = pendingRows ?? []

  async function handleRecalculatePending() {
    const pendingIds = rows.map((row) => row.id)
    if (pendingIds.length === 0) {
      showToast('Nao ha pendencias para recalcular.', 'info')
      return
    }

    try {
      const result = await recalculateMutation.mutateAsync({
        blIds: pendingIds,
        actorId: userId,
        recalculate: true,
      })
      if (result.errorCount > 0) {
        const firstError = result.errors[0]
        showToast(
          `Recalculo parcial: ${result.successCount}/${result.total}. Primeiro erro em ${firstError?.blId ?? '-'}: ${firstError?.message ?? 'erro inesperado'}`,
          'info',
        )
      } else {
        showToast(`Recalculo concluido para ${result.successCount} B/L(s).`, 'success')
      }
    } catch {
      showToast('Falha ao recalcular pendencias.', 'error')
    }
  }

  return (
    <Card className="mb-5">
      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="app-table__cell-stack">
          <div className="app-panel__title">Pendencias de calculo</div>
          <div className="app-table__cell-meta">
            Estes B/Ls estao em revisao nas taxas locais e precisam ser recalculados ou tratados antes de seguir para invoice.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rows.length > 0 ? 'yellow' : 'green'}>
            {isLoading ? 'Carregando...' : `${rows.length} B/L em revisao`}
          </Badge>
          {rows.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleRecalculatePending()}
              loading={recalculateMutation.isPending}
            >
              Recalcular pendencias
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <InlineError message="Falha ao consultar pendencias de calculo." /> : null}
      {!isLoading && !error && rows.length === 0 ? (
        <EmptyState title="Nenhuma pendencia de calculo encontrada." />
      ) : null}
      {rows.length > 0 ? <PendenciasTable rows={rows} /> : null}
    </Card>
  )
}
