import { describe, expect, it } from 'vitest'
import {
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
