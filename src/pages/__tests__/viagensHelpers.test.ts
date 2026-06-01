import { describe, expect, it } from 'vitest'
import {
  countDistinctBatchIds,
  getGraniteModuleStats,
  getVaziosModuleStats,
  splitVoyageBls,
  summarizeModuleAvailability,
  formatMetric,
  formatPortDisplayName,
  normalizePortName,
  normalizeVoyageStatus,
  stripFileExtension,
  summarizeContainerTypes,
  summarizeOccurrences,
  summarizeUniqueValues,
  tokenizeInfoValue,
} from '../viagensHelpers'

describe('normalizePortName', () => {
  it('faz trim, uppercase e usa "-" como fallback', () => {
    expect(normalizePortName('  ssz  ')).toBe('SSZ')
    expect(normalizePortName(null)).toBe('-')
    expect(normalizePortName('')).toBe('-')
  })
})

describe('formatPortDisplayName', () => {
  it('mapeia códigos conhecidos para nomes', () => {
    expect(formatPortDisplayName('CNNBO')).toBe('NINGBO')
    expect(formatPortDisplayName('vix')).toBe('VITORIA')
  })

  it('usa o valor original (trim) para códigos desconhecidos', () => {
    expect(formatPortDisplayName('  Santos  ')).toBe('Santos')
    expect(formatPortDisplayName(null)).toBe('-')
  })
})

describe('summarizeContainerTypes', () => {
  it('agrupa por tipo, conta containers distintos e ordena por contagem', () => {
    const containers = [
      { container_number: 'AAAA1', type: '40HC' },
      { container_number: 'AAAA1', type: '40HC' }, // duplicado → conta 1
      { container_number: 'BBBB2', type: '40HC' },
      { container_number: 'CCCC3', type: '20GP' },
    ]
    expect(summarizeContainerTypes(containers)).toBe('40HC: 2 | 20GP: 1')
  })

  it('usa "Não informado" quando o tipo está ausente', () => {
    expect(summarizeContainerTypes([{ container_number: 'X1', type: null }])).toBe('Não informado: 1')
    expect(summarizeContainerTypes(null)).toBe('')
  })
})

describe('summarizeUniqueValues', () => {
  it('deduplica, ignora vazios e ordena alfabeticamente', () => {
    expect(summarizeUniqueValues(['SSZ', 'rio', 'SSZ', '', null, '  '])).toBe('rio | SSZ')
  })
})

describe('summarizeOccurrences', () => {
  it('conta ocorrências por rótulo, ordena por contagem desc', () => {
    const items = [{ k: 'a' }, { k: 'a' }, { k: 'b' }, { k: null }]
    expect(summarizeOccurrences(items, (i) => i.k, 'N/D')).toBe('a: 2 | b: 1 | N/D: 1')
  })
})

describe('normalizeVoyageStatus', () => {
  it('aceita completed/cancelled e default active', () => {
    expect(normalizeVoyageStatus('completed')).toBe('completed')
    expect(normalizeVoyageStatus('cancelled')).toBe('cancelled')
    expect(normalizeVoyageStatus('qualquer')).toBe('active')
    expect(normalizeVoyageStatus(null)).toBe('active')
  })
})

describe('formatMetric', () => {
  it('formata número pt-BR e trata inválidos', () => {
    expect(formatMetric(1500)).toBe((1500).toLocaleString('pt-BR'))
    expect(formatMetric(null)).toBe('0')
    expect(formatMetric(Number.NaN)).toBe('0')
  })
})

describe('tokenizeInfoValue', () => {
  it('divide por "|" apenas quando há mais de um token', () => {
    expect(tokenizeInfoValue('a | b | c')).toEqual(['a', 'b', 'c'])
    expect(tokenizeInfoValue('único')).toEqual([])
    expect(tokenizeInfoValue('-')).toEqual([])
    expect(tokenizeInfoValue('')).toEqual([])
  })
})

describe('stripFileExtension', () => {
  it('remove a última extensão', () => {
    expect(stripFileExtension('manifesto.xlsx')).toBe('manifesto')
    expect(stripFileExtension('base.clientes.csv')).toBe('base.clientes')
    expect(stripFileExtension('semext')).toBe('semext')
  })
})

describe('splitVoyageBls', () => {
  it('separa B/Ls de container e carga solta', () => {
    const bls = [
      { id: 'A', cargo_mode: 'container' },
      { id: 'B', cargo_mode: 'carga_solta' },
      { id: 'C', cargo_mode: null }, // default → container
    ] as never
    const { containerBls, breakbulkBls } = splitVoyageBls(bls)
    expect(containerBls.map((b) => b.id)).toEqual(['A', 'C'])
    expect(breakbulkBls.map((b) => b.id)).toEqual(['B'])
  })

  it('lida com null/undefined', () => {
    expect(splitVoyageBls(null)).toEqual({ containerBls: [], breakbulkBls: [] })
  })
})

describe('countDistinctBatchIds', () => {
  it('conta lotes distintos ignorando nulos/duplicados', () => {
    const bls = [{ batch_id: 1 }, { batch_id: 1 }, { batch_id: 2 }, { batch_id: null }] as never
    expect(countDistinctBatchIds(bls)).toBe(2)
  })
})

describe('getGraniteModuleStats', () => {
  it('agrega manifestos, peso (ton) e contagens por status', () => {
    const manifests = [
      {
        total_bls: 2,
        total_weight_kg: 2000,
        discharge_port: 'SSZ',
        granite_bls: [
          { id: '1', charge_status: 'ready_for_billing' },
          { id: '2', charge_status: 'invoiced' },
        ],
      },
    ] as never
    const s = getGraniteModuleStats(manifests)
    expect(s.totalManifests).toBe(1)
    expect(s.totalBls).toBe(2)
    expect(s.totalWeightTon).toBe(2)
    expect(s.readyForBillingCount).toBe(1)
    expect(s.invoicedCount).toBe(1)
    expect(s.dischargePorts).toBe('SSZ')
  })

  it('usa o tamanho de granite_bls quando total_bls é nulo', () => {
    const manifests = [{ total_bls: null, granite_bls: [{ id: '1', charge_status: null }] }] as never
    expect(getGraniteModuleStats(manifests).totalBls).toBe(1)
  })
})

describe('getVaziosModuleStats', () => {
  it('agrega bookings, containers distintos, tipos e destinos', () => {
    const manifests = [
      {
        total_bookings: 3,
        vazios_bookings: [
          { id: '1', container_number: 'AAA1', container_type: '40HC', destination: 'RIO', origin_terminal: 'T1' },
          { id: '2', container_number: 'AAA1', container_type: '40HC', destination: 'RIO', origin_terminal: 'T1' },
          { id: '3', container_number: 'BBB2', container_type: '20GP', destination: 'SSA', origin_terminal: 'T2' },
        ],
      },
    ] as never
    const s = getVaziosModuleStats(manifests)
    expect(s.totalBookings).toBe(3)
    expect(s.distinctContainers).toBe(2)
    expect(s.containerTypes).toBe('40HC: 2 | 20GP: 1')
    expect(s.destinations).toBe('RIO | SSA')
  })
})

describe('summarizeModuleAvailability', () => {
  it('lista apenas os módulos presentes', () => {
    expect(
      summarizeModuleAvailability({ hasCntrs: true, hasBreakbulk: false, hasVehicles: true, hasGranite: false, hasVazios: true }),
    ).toBe('CNTRS/VEICULOS/VAZIOS')
  })
  it('retorna "-" quando nenhum módulo está presente', () => {
    expect(
      summarizeModuleAvailability({ hasCntrs: false, hasBreakbulk: false, hasVehicles: false, hasGranite: false, hasVazios: false }),
    ).toBe('-')
  })
})
