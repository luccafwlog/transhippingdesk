import type { FileReadProgress } from '../../hooks/useCancellableFileRead'

export function ImportReadProgress({ progress }: { progress: FileReadProgress }) {
  if (!progress.total) return null
  const current = Math.min(progress.completed + 1, progress.total)
  const percent = progress.total ? (progress.completed / progress.total) * 100 : 0

  return (
    <div className="app-panel app-panel--padded grid gap-2 text-sm" role="status" aria-live="polite">
      <div>
        Processando arquivo {current} de {progress.total}
        {progress.currentFile ? `: ${progress.currentFile}` : ''}...
      </div>
      <div
        role="progressbar"
        aria-label="Progresso da leitura"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
        className="h-2 overflow-hidden rounded bg-[var(--app-border)]"
      >
        <div
          className="h-full bg-[var(--app-blue-btn)] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
