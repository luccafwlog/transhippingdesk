// Logging consistente para falhas de operações "best-effort": escritas
// auxiliares (alertas, trilha de auditoria, payload PIX) que NÃO devem abortar
// o fluxo principal quando falham. Centralizar o formato dá observabilidade a
// essas falhas hoje silenciosas/ad-hoc e cria um ponto único para, no futuro,
// encaminhá-las a um coletor externo. NÃO altera o controle de fluxo.

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
