import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useImportEffects } from '../../hooks/useImportEffects'
import { sanitizeIssueMessage } from '../../services/importValidation'
import type { ImportEffect, ImportEffectKind, ImportEffectState } from '../../services/importEffects'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/ConfirmDialog'

const KIND_LABELS: Record<ImportEffectKind, string> = {
  physical_flags: 'Flags físicas do Baplie',
  provisional_charges: 'Cálculo provisório de taxas locais',
  local_billing: 'Cálculo de taxas locais',
  granite_billing: 'Cálculo de taxas de Granito',
  demurrage_billing: 'Emissão de Demurrage',
  vehicle_followup: 'Isenção após importação de veículos',
}

const STATUS_LABELS: Record<ImportEffectState, string> = {
  pending: 'Pendente',
  running: 'Em processamento',
  retry_wait: 'Aguardando nova tentativa',
  blocked: 'Bloqueado',
  succeeded: 'Concluído',
  superseded: 'Substituído por uma versão mais nova',
}

function importEffectKindLabel(kind: ImportEffectKind): string {
  return KIND_LABELS[kind] ?? kind
}

function importEffectStatusLabel(status: ImportEffectState): string {
  return STATUS_LABELS[status] ?? status
}

function statusClass(status: ImportEffectState) {
  if (status === 'succeeded') return 'text-green-300'
  if (status === 'blocked') return 'text-red-300'
  if (status === 'superseded') return 'text-slate-400'
  return 'text-amber-300'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function effectError(effect: ImportEffect) {
  const message = effect.last_error_message?.trim()
  return message ? sanitizeIssueMessage(message) : null
}

export function ImportResultPanel({
  entityId,
  title = 'Processamento pós-importação',
  alwaysVisible = false,
}: {
  entityId?: string | null
  title?: string
  alwaysVisible?: boolean
}) {
  const normalizedEntityId = entityId?.trim() ?? ''
  const { data: effects, isPending, error, retryMutation } = useImportEffects(normalizedEntityId)
  const confirm = useConfirm()
  const [retryError, setRetryError] = useState<string | null>(null)

  if (!normalizedEntityId) return null

  if (isPending) {
    return (
      <section className="app-panel app-panel--padded text-sm" aria-label={title} data-testid="import-result-panel-loading">
        <strong>{title}</strong>
        <p className="mt-1 text-[var(--app-muted)]">Consultando o resultado persistido...</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="app-panel app-panel--padded text-sm" role="alert" aria-label={title}>
        <strong>{title}</strong>
        <p className="mt-1 text-amber-300">Não foi possível consultar o resultado persistido.</p>
      </section>
    )
  }

  if (!effects?.length) {
    return alwaysVisible ? (
      <section className="app-panel app-panel--padded text-sm" aria-label={title} data-testid="import-result-panel-empty">
        <strong>{title}</strong>
        <p className="mt-1 text-[var(--app-muted)]">Nenhum efeito persistido para esta unidade.</p>
      </section>
    ) : null
  }

  const activeCount = effects.filter((effect) => effect.status === 'pending' || effect.status === 'running' || effect.status === 'retry_wait').length
  const blockedCount = effects.filter((effect) => effect.status === 'blocked').length

  const requestRetry = (effect: ImportEffect) => {
    void (async () => {
      const confirmed = await confirm({
        title: 'Reprocessar efeito bloqueado',
        message: `Confirma o reprocessamento de “${importEffectKindLabel(effect.effect_kind)}”? A tentativa será registrada na auditoria.`,
        confirmLabel: 'Reprocessar',
      })
      if (!confirmed) return

      setRetryError(null)
      try {
        await retryMutation.mutateAsync({
          effectId: effect.id,
          justification: 'Reprocessamento solicitado pelo painel de resultado da importação.',
        })
      } catch (retryFailure) {
        setRetryError(retryFailure instanceof Error ? retryFailure.message : 'Falha ao reabrir o efeito.')
      }
    })()
  }

  return (
    <section className="app-panel app-panel--padded grid gap-3 text-sm" aria-label={title} data-testid="import-result-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-[var(--app-muted)]">
            Resultado recuperado do servidor para esta unidade. {activeCount ? `${activeCount} efeito(s) ainda em andamento.` : ''}
            {blockedCount ? ` ${blockedCount} efeito(s) bloqueado(s) exigem atenção.` : ''}
          </p>
        </div>
        <span className="text-xs text-[var(--app-muted)]">Atualizado em {formatDate(effects[0]?.updated_at)}</span>
      </div>

      <ul className="grid gap-2" aria-label="Efeitos da importação">
        {effects.map((effect) => {
          const errorMessage = effectError(effect)
          return (
            <li key={effect.id} className="rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{importEffectKindLabel(effect.effect_kind)}</span>
                <span className={`text-xs font-semibold ${statusClass(effect.status)}`}>
                  {importEffectStatusLabel(effect.status)}
                </span>
              </div>
              <div className="mt-1 text-xs text-[var(--app-muted)]">
                Tentativas: {effect.attempts} · Atualizado em {formatDate(effect.updated_at)}
              </div>
              {errorMessage ? <p className="mt-1 text-xs text-red-300">{errorMessage}</p> : null}
              {effect.status === 'blocked' ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2"
                  loading={retryMutation.isPending}
                  onClick={() => requestRetry(effect)}
                >
                  <RotateCcw size={14} />
                  Reprocessar efeito
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {retryError ? <p className="text-xs text-red-300" role="alert">{sanitizeIssueMessage(retryError)}</p> : null}
    </section>
  )
}
