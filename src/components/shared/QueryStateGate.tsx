import type { ReactNode } from 'react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

type QueryStateGateProps = {
  /** `query.isLoading` (sem nenhum dado ainda). */
  isLoading: boolean
  /** `query.isError`. */
  isError: boolean
  /** `query.fetchStatus === 'paused'` — o TanStack pausa sem rede. */
  isPaused?: boolean
  /** Há dados em cache para exibir (`data !== undefined`), mesmo que stale. */
  hasData: boolean
  errorMessage?: string
  onRetry?: () => void
  loadingLabel?: string
  children: ReactNode
}

/**
 * Porta única de estado de leitura para listas e painéis.
 *
 * - Offline sem cache: mostra indisponibilidade — nunca "nenhum registro".
 * - Offline com cache: conserva os dados com indicação de desatualização.
 * - Reconnect retoma sozinho (a query volta a `fetchStatus === 'fetching'`).
 * - Escrita offline nunca é anunciada aqui: este gate só cobre leitura.
 */
export function QueryStateGate({
  isLoading,
  isError,
  isPaused = false,
  hasData,
  errorMessage = 'Falha ao carregar os dados.',
  onRetry,
  loadingLabel = 'Carregando…',
  children,
}: QueryStateGateProps) {
  const online = useOnlineStatus()
  const offline = !online || isPaused

  if (hasData) {
    return (
      <>
        {offline ? (
          <div role="status" className="app-offline-banner">
            Você está offline. Exibindo dados salvos — a leitura retoma ao reconectar.
          </div>
        ) : isError ? (
          <div role="alert" className="app-panel app-panel--padded">
            <p className="text-sm font-semibold text-[var(--app-text-strong)]">{errorMessage}</p>
            {onRetry ? (
              <button type="button" className="app-btn app-btn--secondary app-btn--sm mt-3" onClick={onRetry}>
                Tentar novamente
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </>
    )
  }

  if (offline) {
    return (
      <div role="status" className="app-panel app-panel--padded">
        <p className="text-sm font-semibold text-[var(--app-text-strong)]">Sem conexão no momento.</p>
        <p className="mt-1 text-sm text-[var(--app-muted)]">
          Não foi possível carregar os dados e não há cópia salva. Verifique a rede e tente de novo —
          isto não significa que a lista esteja vazia.
        </p>
        {onRetry ? (
          <button type="button" className="app-btn app-btn--secondary app-btn--sm mt-3" onClick={onRetry}>
            Tentar novamente
          </button>
        ) : null}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div role="status" className="app-panel__meta">
        {loadingLabel}
      </div>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="app-panel app-panel--padded">
        <p className="text-sm font-semibold text-[var(--app-text-strong)]">{errorMessage}</p>
        {onRetry ? (
          <button type="button" className="app-btn app-btn--secondary app-btn--sm mt-3" onClick={onRetry}>
            Tentar novamente
          </button>
        ) : null}
      </div>
    )
  }

  return <>{children}</>
}
