export type OperationalFilter = {
  label: string
  value: string | number | boolean | null | undefined
}

export function formatResultCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function describeActiveFilters(filters: OperationalFilter[]) {
  const active = filters
    .filter((filter) => filter.value !== null && filter.value !== undefined && String(filter.value).trim() !== '')
    .map((filter) => `${filter.label} ${String(filter.value).trim()}`)

  return active.length ? `Filtros ativos: ${active.join(', ')}` : 'Sem filtros ativos'
}

export function describeEmptyState({
  entitySingular,
  entityPlural,
  hasActiveFilters: filtered,
  emptyWithoutFilters,
  emptyWithFilters,
}: {
  entitySingular?: string
  entityPlural: string
  hasActiveFilters: boolean
  emptyWithoutFilters: string
  emptyWithFilters?: string
}) {
  if (filtered) {
    const singular = entitySingular ?? entityPlural.replace(/s$/, '')
    return {
      title: emptyWithFilters ?? `Nenhuma ${singular} encontrada.`,
      description: `Os filtros atuais nao retornaram ${entityPlural}. Ajuste ou limpe os filtros para ampliar a busca.`,
    }
  }

  return {
    title: emptyWithoutFilters,
    description: 'Quando houver dados para este módulo, eles aparecerão aqui.',
  }
}

export function summarizeReconciliation({
  safe,
  ambiguous,
  total,
}: {
  safe: number
  ambiguous: number
  total: number
}) {
  if (ambiguous > 0) {
    return {
      status: `${ambiguous} ${ambiguous === 1 ? 'pendencia exige' : 'pendencias exigem'} revisao humana`,
      risk: 'Itens ambiguos nao serao conciliados automaticamente.',
    }
  }

  if (safe > 0) {
    return {
      status: `${safe} ${safe === 1 ? 'pagamento seguro' : 'pagamentos seguros'} para conciliacao`,
      risk: 'Confirmar apenas itens com correspondencia unica por TXID.',
    }
  }

  return {
    status: total === 0 ? 'Nenhuma correspondencia encontrada' : 'Nenhum pagamento seguro para conciliacao',
    risk: 'Revise o extrato e as invoices abertas antes de tentar novamente.',
  }
}
