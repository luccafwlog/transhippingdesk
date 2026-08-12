export function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14)
}
