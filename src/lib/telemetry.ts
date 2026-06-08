// Falhas best-effort devem ser observáveis sem interromper o fluxo principal
// (alertas, trilha de auditoria, payload PIX e escritas auxiliares).

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
}
