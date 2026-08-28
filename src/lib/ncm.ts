// Extração de NCM a partir de texto livre (descrição da carga do manifesto).
// Fonte da verdade do NCM é a descrição; este helper é reaproveitado pelo
// importador breakbulk e pela tela do B/L (evita divergência de regex).

const NCM_PATTERN = /\bNCM(?:\s*(?:NO\.?|NUMBER|CODE))?\s*[:.]?\s*([0-9][0-9.,\s/-]{2,30})/gi
const CODE_PATTERN = /\d{4}(?:[.,]?\d{2})?(?:[.,]?\d{2})?/g

// Retorna os códigos NCM (somente dígitos) encontrados no texto, em ordem.
// Exclui números UN de carga perigosa, que aparecem como "UN NCM.:3556".
export function extractNcmCodes(value: string): string[] {
  if (!value) return []
  const codes: string[] = []
  for (const match of value.matchAll(NCM_PATTERN)) {
    const start = match.index ?? 0
    const preceding = value.slice(Math.max(0, start - 4), start)
    if (/\bUN\s$/i.test(preceding)) continue // "UN NCM." → número UN, não NCM
    for (const codeMatch of match[1].matchAll(CODE_PATTERN)) {
      const digits = codeMatch[0].replace(/\D/g, '')
      if (digits.length >= 4) codes.push(digits)
    }
  }
  return codes
}

// Formata um código NCM (somente dígitos) para exibição: 8703.80.00 / 8703.80 / 2923.
// Nenhum dígito é descartado: o campo aceita de 4 a 8 dígitos (migration 358), e
// um código de 5 ou 7 formatado com perda voltava mais curto na próxima edição.
export function formatNcm(code: string): string {
  if (code.length <= 4) return code
  const groups = [code.slice(0, 4), code.slice(4, 6), code.slice(6)]
  return groups.filter(Boolean).join('.')
}

// Lista deduplicada e formatada de NCMs de uma descrição de carga (para a UI).
export function listBlNcms(cargoDescription: string | null | undefined): string[] {
  if (!cargoDescription) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const code of extractNcmCodes(cargoDescription)) {
    if (seen.has(code)) continue
    seen.add(code)
    result.push(formatNcm(code))
  }
  return result
}
