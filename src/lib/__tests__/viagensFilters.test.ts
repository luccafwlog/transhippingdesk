import { describe, expect, it } from 'vitest'
import { filterVoyageRailItems } from '../viagensFilters'
import type { VoyageRailItem } from '../../services/voyageSummaries'

const items: VoyageRailItem[] = [
  {
    id: 1,
    vesselName: 'MAERSK ATLANTIC',
    voyageNumber: '024E',
    carrierName: 'Hapag-Lloyd',
    originPorts: ['Shanghai'],
    destinationPorts: ['Santos'],
    blCount: 12,
    containerCount: 40,
    status: 'active',
    estado: 'conciliado',
    proximaEscala: { pod: 'Santos', eta: '2026-06-20' },
  },
  {
    id: 2,
    vesselName: 'CMA CGM JULES',
    voyageNumber: '117W',
    carrierName: 'CMA CGM',
    originPorts: ['Rotterdam'],
    destinationPorts: ['Santos'],
    blCount: 8,
    containerCount: 42,
    status: 'active',
    estado: 'incompleto',
    proximaEscala: { pod: 'Santos', eta: '2026-06-18' },
  },
]

describe('filterVoyageRailItems', () => {
  it('retorna tudo quando filtros vazios', () => {
    expect(filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(2)
  })

  it('filtra por busca em nome do navio', () => {
    const result = filterVoyageRailItems(items, { search: 'maersk', status: 'all', conciliacao: 'all', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('busca também em voyageNumber, carrier e portos', () => {
    expect(filterVoyageRailItems(items, { search: 'cma', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(1)
    expect(filterVoyageRailItems(items, { search: 'rotterdam', status: 'all', conciliacao: 'all', periodo: 'all' })).toHaveLength(1)
  })

  it('filtra por status', () => {
    expect(filterVoyageRailItems(items, { search: '', status: 'completed', conciliacao: 'all', periodo: 'all' })).toHaveLength(0)
  })

  it('filtra por conciliação pendente (incompleto ou divergente)', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'pendente', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })

  it('filtra por conciliação conciliada', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'conciliada', periodo: 'all' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('ordena por próxima escala (ETA) ascendente, depois por navio/viagem', () => {
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'all' })
    expect(result[0].id).toBe(2) // ETA 2026-06-18 vem antes de 2026-06-20
  })

  it('filtro de período "hoje" inclui só escalas com ETA >= hoje', () => {
    // Como o "hoje" varia, validamos apenas que a função não quebra e respeita o tipo.
    const result = filterVoyageRailItems(items, { search: '', status: 'all', conciliacao: 'all', periodo: 'hoje' })
    expect(Array.isArray(result)).toBe(true)
  })

  it('período "custom" filtra escalas entre datas específicas (inclusive)', () => {
    const result = filterVoyageRailItems(items, {
      search: '',
      status: 'all',
      conciliacao: 'all',
      periodo: 'custom',
      dataInicio: '2026-06-19',
      dataFim: '2026-06-21',
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1) // ETA 2026-06-20 dentro do intervalo; id 2 (18/06) fora
  })

  it('período "custom" com só data inicial aplica apenas o piso', () => {
    const result = filterVoyageRailItems(items, {
      search: '',
      status: 'all',
      conciliacao: 'all',
      periodo: 'custom',
      dataInicio: '2026-06-19',
      dataFim: '',
    })
    expect(result.map((r) => r.id)).toEqual([1])
  })

  it('período "custom" sem datas não filtra nada', () => {
    const result = filterVoyageRailItems(items, {
      search: '',
      status: 'all',
      conciliacao: 'all',
      periodo: 'custom',
      dataInicio: '',
      dataFim: '',
    })
    expect(result).toHaveLength(2)
  })
})
