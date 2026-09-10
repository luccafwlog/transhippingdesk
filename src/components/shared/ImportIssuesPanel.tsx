import { Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { hasBlockingIssues, downloadIssuesCsv, sanitizeIssueMessage, type ImportIssue } from '../../services/importValidation'

export function ImportIssuesPanel({
  issues,
  filename = 'import-issues.csv',
}: {
  issues: readonly ImportIssue[]
  filename?: string
}) {
  if (!issues.length) return null
  const blocking = hasBlockingIssues(issues)
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors

  return (
    <div
      role={blocking ? 'alert' : 'status'}
      className="app-panel app-panel--padded grid gap-2 border border-[var(--app-gold)] bg-[var(--app-gold-soft)] text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong>{blocking ? 'Corrija os problemas antes de importar.' : 'Revise os avisos da prévia.'}</strong>
        <Button variant="secondary" onClick={() => downloadIssuesCsv(filename, issues)}>
          <Download size={15} />
          Baixar relatório completo
        </Button>
      </div>
      <div className="text-xs text-[var(--app-muted)]">{errors} erro(s), {warnings} aviso(s)</div>
      <ol aria-label="Relatório completo da importação" className="grid max-h-64 gap-1 overflow-auto pl-5 text-xs">
        {issues.map((issue, index) => (
          <li key={`${issue.row}-${issue.field}-${issue.code}-${index}`}>
            <span className="font-semibold">Linha {issue.row} · {issue.field}:</span>{' '}
            {sanitizeIssueMessage(issue.message)}
          </li>
        ))}
      </ol>
    </div>
  )
}
