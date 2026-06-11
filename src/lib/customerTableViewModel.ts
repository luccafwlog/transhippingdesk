export function buildCustomerBillingUrl(customer: { id: number; name: string }) {
  return `/faturamento?tab=invoices&customer=${customer.id}&customerName=${encodeURIComponent(customer.name)}`
}

export function getPrimaryContactEmail(
  contacts: Array<{ id?: number; email?: string | null; is_primary?: boolean | null; purpose?: string | null }> | null | undefined,
) {
  const withEmail = (contacts ?? []).filter((contact) => String(contact.email ?? '').trim().length > 0)
  return withEmail.find((contact) => contact.is_primary)?.email ?? withEmail[0]?.email ?? null
}

const contactPurposeLabels: Record<string, string> = {
  geral: 'Geral',
  operacional: 'Operacional',
  faturamento: 'Faturamento',
  financeiro: 'Financeiro',
}

export function summarizeContactsForDisplay(
  contacts: Array<{ id?: number; email?: string | null; is_primary?: boolean | null; purpose?: string | null }> | null | undefined,
) {
  const count = contacts?.length ?? 0
  const primary = (contacts ?? []).find((contact) => contact.is_primary && String(contact.email ?? '').trim())
    ?? (contacts ?? []).find((contact) => String(contact.email ?? '').trim())

  return {
    count,
    primaryEmail: primary?.email ?? null,
    purposeLabel: primary?.purpose ? contactPurposeLabels[primary.purpose] ?? primary.purpose : null,
    empty: !primary?.email,
  }
}

export function getCustomerNextAction(input: {
  hasEmail: boolean
  readyCount: number
  pendingCount: number
  pendingBalance: number
}): { label: string; tone: 'green' | 'yellow' | 'red' | 'slate' } {
  if (!input.hasEmail) return { label: 'Cadastrar e-mail', tone: 'red' }
  if (input.readyCount > 0) return { label: 'Pronto para faturar', tone: 'green' }
  if (input.pendingCount > 0) return { label: 'Revisar taxas', tone: 'yellow' }
  if (input.pendingBalance > 0) return { label: 'Saldo em aberto', tone: 'yellow' }
  return { label: 'Em dia', tone: 'slate' }
}

type CustomerFilterChipInput = {
  search: string
  contactEmail: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
}

export function getCustomerFilterChips(filters: CustomerFilterChipInput) {
  const chips: Array<{ key: keyof CustomerFilterChipInput; label: string }> = []
  if (filters.search.trim()) chips.push({ key: 'search', label: `Cliente: ${filters.search.trim()}` })
  if (filters.contactEmail.trim()) chips.push({ key: 'contactEmail', label: `E-mail: ${filters.contactEmail.trim()}` })
  if (filters.emailStatus === 'with') chips.push({ key: 'emailStatus', label: 'Com e-mails' })
  if (filters.emailStatus === 'without') chips.push({ key: 'emailStatus', label: 'Sem e-mails' })
  if (filters.blStatus === 'with') chips.push({ key: 'blStatus', label: 'Com B/Ls' })
  if (filters.blStatus === 'without') chips.push({ key: 'blStatus', label: 'Sem B/Ls' })
  if (filters.pendingStatus === 'with') chips.push({ key: 'pendingStatus', label: 'Com saldo pendente' })
  if (filters.pendingStatus === 'without') chips.push({ key: 'pendingStatus', label: 'Sem saldo pendente' })
  return chips
}

export type CustomerSortKey = 'name' | 'bls' | 'pendingBalance'
export type SortDirection = 'asc' | 'desc'

export function sortCustomerRows<T extends { name: string; pending_balance?: number | null; bls?: unknown[] | null }>(
  rows: T[],
  key: CustomerSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    if (key === 'name') return left.name.localeCompare(right.name) * multiplier
    if (key === 'bls') return ((left.bls?.length ?? 0) - (right.bls?.length ?? 0)) * multiplier
    return (Number(left.pending_balance ?? 0) - Number(right.pending_balance ?? 0)) * multiplier
  })
}
