function errorCode(error: unknown): string {
  return typeof error === 'object' && error ? String((error as { code?: unknown }).code ?? '') : ''
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error ? String((error as { message?: unknown }).message ?? '') : ''
}

export function portalErrorMessage(error: unknown, fallback: string): string {
  const code = errorCode(error)
  if (code === 'P0429') return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  if (code === '28000') return 'Sua sessao expirou. Entre novamente para continuar.'

  const message = errorMessage(error).toLowerCase()
  if ((message.includes('new password') && message.includes('different')) || message.includes('same password')) {
    return 'A nova senha deve ser diferente da senha atual.'
  }

  return fallback
}
