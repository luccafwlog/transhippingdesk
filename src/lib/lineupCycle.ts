export function isCycleStartRow(renderedRowId: string, firstRowId: string | null | undefined) {
  return Boolean(firstRowId && (renderedRowId === firstRowId || renderedRowId.startsWith(`${firstRowId}::display-track-`)))
}
