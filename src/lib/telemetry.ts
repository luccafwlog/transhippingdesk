// Falhas best-effort devem ser observáveis sem interromper o fluxo principal
// (alertas, trilha de auditoria, payload PIX e escritas auxiliares).

import * as Sentry from '@sentry/react'

// DSN do Sentry é público por design (vai no bundle do cliente de qualquer
// forma); não é segredo. Envio autorizado pela operação em 2026-06-10
// (auditoria T10 / Open Question 4).
const SENTRY_DSN = 'https://8fbf8837315ab9f627c2f6e1283bf8d5@o4511542052454400.ingest.us.sentry.io/4511542063464448'

// Inicializa o relatório de erros em produção. Os default integrations do
// @sentry/react já capturam window.onerror e onunhandledrejection; o release
// usa o commit injetado no build (VITE_APP_COMMIT_SHA) para rastrear regressões.
export function initTelemetry(): void {
  if (!import.meta.env.PROD) return
  Sentry.init({
    dsn: SENTRY_DSN,
    release: (import.meta.env.VITE_APP_COMMIT_SHA as string | undefined) || undefined,
    // Sem replay/tracing: só captura de erros, mantendo payloads mínimos.
    sendDefaultPii: false,
  })
}

export function reportCaughtException(error: unknown, context?: string): void {
  Sentry.captureException(error, context ? { tags: { context } } : undefined)
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; code?: unknown }
    if (maybe.message != null || maybe.code != null) {
      return { message: maybe.message, code: maybe.code }
    }
  }
  return error
}

export function reportBestEffortFailure(
  context: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  console.warn(`[best-effort] ${context}`, { ...meta, error: normalizeError(error) })
  Sentry.captureException(error, {
    tags: { context, kind: 'best-effort' },
    extra: meta,
  })
}
