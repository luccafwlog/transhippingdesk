import { describe, expect, it } from 'vitest'
import {
  describeActiveFilters,
  describeEmptyState,
  formatResultCount,
  summarizeReconciliation,
} from '../operationalState'

describe('operationalState', () => {
  it('formats visible result counts in Portuguese', () => {
    expect(formatResultCount(0, 'fatura', 'faturas')).toBe('0 faturas')
    expect(formatResultCount(1, 'fatura', 'faturas')).toBe('1 fatura')
    expect(formatResultCount(12, 'fatura', 'faturas')).toBe('12 faturas')
  })

  it('describes only active filters', () => {
    expect(describeActiveFilters([
      { label: 'Status', value: 'Pendentes' },
      { label: 'Cliente', value: '' },
      { label: 'Periodo', value: null },
    ])).toBe('Filtros ativos: Status Pendentes')
  })

  it('uses a stable fallback when there are no active filters', () => {
    expect(describeActiveFilters([{ label: 'Status', value: '' }])).toBe('Sem filtros ativos')
  })

  it('differentiates empty states with and without filters', () => {
    expect(describeEmptyState({
      entityPlural: 'faturas',
      hasActiveFilters: false,
      emptyWithoutFilters: 'Nenhuma fatura emitida ainda.',
    })).toEqual({
      title: 'Nenhuma fatura emitida ainda.',
      description: 'Quando houver dados para este modulo, eles aparecerao aqui.',
    })

    expect(describeEmptyState({
      entityPlural: 'faturas',
      hasActiveFilters: true,
      emptyWithoutFilters: 'Nenhuma fatura emitida ainda.',
    })).toEqual({
      title: 'Nenhuma fatura encontrada.',
      description: 'Os filtros atuais nao retornaram faturas. Ajuste ou limpe os filtros para ampliar a busca.',
    })
  })

  it('summarizes reconciliation review risk without approving ambiguous items', () => {
    expect(summarizeReconciliation({ safe: 2, ambiguous: 1, total: 3 })).toEqual({
      status: '1 pendencia exige revisao humana',
      risk: 'Itens ambiguos nao serao conciliados automaticamente.',
    })
  })
})
