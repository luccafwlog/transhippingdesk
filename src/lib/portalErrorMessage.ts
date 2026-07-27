import { classifyDbError } from './errors'

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error ? String((error as { message?: unknown }).message ?? '') : ''
}

export function portalErrorMessage(error: unknown, fallback: string): string {
  const classified = classifyDbError(error)
  if (classified.kind !== 'desconhecido') return classified.message

  const message = errorMessage(error).toLowerCase()
  if ((message.includes('new password') && message.includes('different')) || message.includes('same password')) {
    return 'A nova senha deve ser diferente da senha atual.'
  }

  return fallback
}
