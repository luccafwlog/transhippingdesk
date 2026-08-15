/**
 * Canonicalização idêntica à `normalize_cnpj` do banco (migration 293): remove
 * o que não for alfanumérico e sobe para maiúsculas, SEM truncar.
 *
 * `normalizeCnpj` corta em 14 porque também serve de máscara de digitação, e é
 * disso que a validação precisa se defender: cortar antes de validar apara um
 * documento comprido até o tamanho de um CNPJ e o oferece aos dígitos
 * verificadores, que podem fechar por acaso. O que entrou não era um CNPJ, e
 * seria gravado como se fosse.
 */
export function canonicalizeDocument(value?: string | null): string {
  return (value ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
}

export function normalizeCnpj(value?: string | null): string {
  return canonicalizeDocument(value).slice(0, 14)
}

export function formatCnpj(value?: string | null): string {
  const canonical = normalizeCnpj(value ?? '')
  if (/^\d{11}$/.test(canonical)) {
    return `${canonical.slice(0, 3)}.${canonical.slice(3, 6)}.${canonical.slice(6, 9)}-${canonical.slice(9)}`
  }
  if (canonical.length !== 14) return value || '-'
  return `${canonical.slice(0, 2)}.${canonical.slice(2, 5)}.${canonical.slice(5, 8)}/${canonical.slice(8, 12)}-${canonical.slice(12)}`
}

export function isValidCnpj(value?: string | null): boolean {
  const raw = value ?? ''
  if (!/^[0-9A-Za-z.\-/\s]{14,18}$/.test(raw)) return false

  const canonical = canonicalizeDocument(raw)
  if (!/^[0-9A-Z]{14}$/.test(canonical)) return false

  // CNPJ de caractere repetido nao existe no cadastro da Receita. O caso que
  // escapa e o zerado: com soma zero, o resto e zero e os dois DVs calculados
  // dao "00", entao 00000000000000 fecha a propria conta e passaria como
  // valido. Os demais repetidos ja reprovam no DV; a guarda cobre a familia
  // inteira de uma vez, em vez de tratar so o zero.
  if (/^(.)\1{13}$/.test(canonical)) return false

  const body = canonical.slice(0, 12)
  const expected = `${calculateDigit(body, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}${calculateDigit(`${body}${canonical[12]}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`
  return canonical.slice(12) === expected
}

/** Valida o documento bruto e só então devolve sua forma canônica completa. */
export function canonicalizeValidCnpj(value?: string | null): string | null {
  if (!isValidCnpj(value)) return null
  return canonicalizeDocument(value)
}

function calculateDigit(value: string, weights: number[]): string {
  const sum = [...value].reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index], 0)
  const remainder = sum % 11
  const digit = 11 - remainder
  return String(digit >= 10 ? 0 : digit)
}
