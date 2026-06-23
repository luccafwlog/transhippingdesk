/**
 * Footer note for preview tables/lists that render only the first `shown` of
 * `total` parsed rows. Renders nothing when nothing is hidden (`total <= shown`),
 * so callers can drop it in unconditionally.
 *
 * Mirrors the existing "de N no arquivo" hint already used in Baplie.
 */
export function TruncationNote({
  shown,
  total,
  noun = 'linha',
  nounPlural,
}: {
  shown: number
  total: number
  noun?: string
  nounPlural?: string
}) {
  if (total <= shown) return null
  const plural = nounPlural ?? `${noun}s`
  return (
    <div className="px-1 py-2 text-xs text-[var(--app-muted)]">
      Mostrando {shown} de {total} {total === 1 ? noun : plural}. As demais foram omitidas da prévia.
    </div>
  )
}
