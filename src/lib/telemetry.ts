// Falhas best-effort devem ser observáveis sem interromper o fluxo principal
// (alertas, trilha de auditoria, payload PIX e escritas auxiliares).

import * as Sentry from '@sentry/react'

// DSN do Sentry é público por design (vai no bundle do cliente de qualquer
// forma); não é segredo. Envio autorizado pela operação em 2026-06-10
// (auditoria T10 / Open Question 4).
const SENTRY_DSN = 'https://8fbf8837315ab9f627c2f6e1283bf8d5@o4511542052454400.ingest.us.sentry.io/4511542063464448'

const FORMATTED_CNPJ_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g
const FORMATTED_CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const BARE_CNPJ_RE = /\b\d{14}\b/g
const BARE_CPF_RE = /\b\d{11}\b/g
const MAX_SCRUB_DEPTH = 4

// Redige padroes de PII (CNPJ, CPF, email) em qualquer string do evento.
export function scrubPii(text: string): string {
  return text
    .replace(FORMATTED_CNPJ_RE, '[cnpj]')
    .replace(FORMATTED_CPF_RE, '[cpf]')
    .replace(EMAIL_RE, '[email]')
    .replace(BARE_CNPJ_RE, '[digits14]')
    .replace(BARE_CPF_RE, '[digits11]')
}

// httpContextIntegration (default do @sentry/browser) grava event.request.url
// = location.href no preprocessEvent, que roda ANTES do beforeSend. Telas do
// Portal recebem token de reset/ativacao na query string; nenhuma query do
// Portal e necessaria para diagnostico, entao a query inteira e removida em
// vez de manter uma lista de nomes sensiveis, que envelhece mal.
export function redactUrlQueryString(url: string): string {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

// browserApiErrorsIntegration/breadcrumbsIntegration (defaults do
// @sentry/browser) gravam breadcrumb.data.from/to com o href completo
// (path+query) em toda navegacao, incluindo a propria chamada de
// history.replaceState que os componentes de reset/ativacao do Portal usam
// para remover o token da URL -- entao o breadcrumb carrega o token mesmo
// depois da URL limpa. scrubPii nao pega token aleatorio (nao e CNPJ/CPF/
// email), entao a query string inteira de qualquer valor string em
// breadcrumb.data e removida, alem do scrub de PII de costume.
export function scrubBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? scrubPii(redactUrlQueryString(value)) : value,
    ]),
  )
}

export function scrubEventValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubPii(value)
  if (value == null || typeof value !== 'object') return value
  if (depth >= MAX_SCRUB_DEPTH) return value
  if (Array.isArray(value)) return value.map((item) => scrubEventValue(item, depth + 1))
  if (Object.getPrototypeOf(value) !== Object.prototype) return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubEventValue(item, depth + 1)]),
  )
}

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
    // Erros do banco podem ecoar valores de linhas; sendDefaultPii nao cobre
    // conteudo enviado manualmente em message/extra/breadcrumbs.
    beforeSend(event) {
      event.exception?.values?.forEach((value) => {
        if (value.value) value.value = scrubPii(value.value)
      })
      if (event.message) event.message = scrubPii(event.message)
      if (event.extra) event.extra = scrubEventValue(event.extra) as typeof event.extra
      event.breadcrumbs?.forEach((breadcrumb) => {
        if (breadcrumb.message) breadcrumb.message = scrubPii(breadcrumb.message)
        if (breadcrumb.data) breadcrumb.data = scrubBreadcrumbData(breadcrumb.data)
      })
      if (event.request) {
        if (event.request.url) event.request.url = redactUrlQueryString(event.request.url)
        if (event.request.headers?.Referer) event.request.headers.Referer = redactUrlQueryString(event.request.headers.Referer)
      }
      return event
    },
  })
}

export function reportCaughtException(error: unknown, context?: string, extra?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { tags: { context }, extra } : undefined)
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
