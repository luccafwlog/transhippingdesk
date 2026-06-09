import { Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'

type BulkActionsBarProps = {
  count: number
  onClear: () => void
  onDelete: () => void
  deleting?: boolean
  /** Singular/plural do rotulo da entidade, ex: ['veiculo', 'veiculos']. */
  noun: [string, string]
}

/**
 * Barra de acoes em massa exibida quando ha linhas selecionadas. Apenas
 * apresentacao: a pagina decide o que fazer em `onDelete`/`onClear`.
 */
export function BulkActionsBar({ count, onClear, onDelete, deleting, noun }: BulkActionsBarProps) {
  if (count === 0) return null

  const label = `${count} ${count === 1 ? noun[0] : noun[1]} selecionado${count === 1 ? '' : 's'}`

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
      <span className="text-sm text-[var(--app-text)]">{label}</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClear} disabled={deleting}>
          <X size={15} />
          Limpar
        </Button>
        <Button variant="danger" onClick={onDelete} loading={deleting}>
          <Trash2 size={15} />
          Excluir selecionados
        </Button>
      </div>
    </div>
  )
}
