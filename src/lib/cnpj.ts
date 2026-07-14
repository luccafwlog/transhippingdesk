export function normalizeCnpj(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

export function maskCnpj(cnpj14: string): string {
  const digits = cnpj14.replace(/\D/g, '')
  if (digits.length !== 14) return cnpj14
  return `${digits.slice(0, 2)}.***.***/${digits.slice(8, 12)}-${digits.slice(12)}`
}
