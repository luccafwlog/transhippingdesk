const LEGAL_SUFFIX = /(?:\b(?:LTDA|S\.A|S\/A|SA(?=\s*$)|EIRELI|EI|MEI|SLU|EPP|ME)\b\.?)/g

export function extractConsigneeShortName(block: string): string {
  const firstLine = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''

  let lastEnd = -1
  LEGAL_SUFFIX.lastIndex = 0

  for (let match = LEGAL_SUFFIX.exec(firstLine); match; match = LEGAL_SUFFIX.exec(firstLine)) {
    if (match.index === 0) continue

    if (lastEnd === -1 || firstLine.slice(lastEnd, match.index).trim() === '') {
      lastEnd = match.index + match[0].length
      continue
    }

    break
  }

  if (lastEnd === -1) return firstLine

  return firstLine.slice(0, lastEnd).trim()
}
