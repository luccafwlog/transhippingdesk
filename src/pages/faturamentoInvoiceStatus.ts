export function invoiceStatusLabel(status: string | null) {
  if (status === 'partially_paid') return 'Parcial'
  if (status === 'overdue') return 'Vencida'
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'paid') return 'Paga'
  if (status === 'covered') return 'Coberta'
  if (status === 'obsolete') return 'Obsoleta'
  if (status === 'draft') return 'Draft'
  return 'Emitida'
}

export function invoiceStatusTone(status: string | null) {
  if (status === 'paid') return 'green'
  if (status === 'partially_paid') return 'blue'
  if (status === 'overdue') return 'yellow'
  if (status === 'cancelled') return 'slate'
  if (status === 'covered') return 'green'
  if (status === 'obsolete') return 'slate'
  if (status === 'draft') return 'yellow'
  return 'blue'
}
