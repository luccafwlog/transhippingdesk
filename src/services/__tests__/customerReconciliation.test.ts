import { describe, expect, it, vi } from 'vitest'
import { canonicalizeName, findMatchedCustomer, type CustomerMaps } from '../customerReconciliation'

vi.mock('../supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

function makeMaps(): CustomerMaps {
  return {
    customersByDocument: new Map([
      ['12345678000195', { id: 1, name: 'CLIENTE ALFA LTDA' }],
      ['98765432000110', { id: 2, name: 'CLIENTE BETA S/A' }],
    ]),
    customersByName: new Map([
      ['cliente alfa ltda', { id: 1, name: 'CLIENTE ALFA LTDA' }],
      ['cliente beta s/a', { id: 2, name: 'CLIENTE BETA S/A' }],
    ]),
    customersByCanonicalName: new Map([
      ['cliente alfa', { id: 1, name: 'CLIENTE ALFA LTDA' }],
      ['cliente beta', { id: 2, name: 'CLIENTE BETA S/A' }],
      ['allog galeria transportes internacionais', { id: 3, name: 'ALLOG GALERIA - TRANSPORTES INTERNACIONAIS LTDA' }],
    ]),
    canonicalList: [
      { canonical: 'cliente alfa', record: { id: 1, name: 'CLIENTE ALFA LTDA' } },
      { canonical: 'cliente beta', record: { id: 2, name: 'CLIENTE BETA S/A' } },
      { canonical: 'allog galeria transportes internacionais', record: { id: 3, name: 'ALLOG GALERIA - TRANSPORTES INTERNACIONAIS LTDA' } },
    ],
  }
}

describe('customerReconciliation', () => {
  it('prioriza match por documento', () => {
    const match = findMatchedCustomer(
      {
        cnpjCpf: '12.345.678/0001-95',
        consignee: 'Cliente Alfa Ltda',
      },
      makeMaps(),
    )

    expect(match).toEqual({
      customer: { id: 1, name: 'CLIENTE ALFA LTDA' },
      matchType: 'document',
    })
  })

  it('usa fallback por nome normalizado quando nao ha match por documento', () => {
    const match = findMatchedCustomer(
      {
        cnpjCpf: '00.000.000/0000-00',
        consignee: 'Cliente Beta S/A',
      },
      makeMaps(),
    )

    expect(match).toEqual({
      customer: { id: 2, name: 'CLIENTE BETA S/A' },
      matchType: 'name',
    })
  })

  it('retorna null quando nenhum criterio bate', () => {
    const match = findMatchedCustomer(
      {
        cnpjCpf: '11.111.111/1111-11',
        consignee: 'Cliente Inexistente',
      },
      makeMaps(),
    )

    expect(match).toBeNull()
  })
})

describe('canonicalizeName', () => {
  it('remove pontuacao e sufixo LTDA', () => {
    expect(canonicalizeName('CLIENTE ALFA LTDA.')).toBe('cliente alfa')
  })

  it('remove sufixo S/A com barra', () => {
    expect(canonicalizeName('CLIENTE BETA S/A')).toBe('cliente beta')
  })

  it('remove sufixo SA sem barra', () => {
    expect(canonicalizeName('EMPRESA SA')).toBe('empresa')
  })

  it('remove hifens e colapsa espacos', () => {
    expect(canonicalizeName('ALLOG GALERIA - TRANSPORTES INTERNACIONAIS LTDA')).toBe(
      'allog galeria transportes internacionais',
    )
  })

  it('remove acentos e normaliza para minusculo', () => {
    expect(canonicalizeName('COMÉRCIO EXTERIOR LTDA.')).toBe('comercio exterior')
  })

  it('colapsa multiplos espacos entre tokens', () => {
    expect(canonicalizeName('EMPRESA   DE   LOGISTICA LTDA')).toBe('empresa de logistica')
  })
})

describe('findMatchedCustomer — match por nome canonico', () => {
  it('casa consignee sem sufixo LTDA com cliente que tem LTDA no banco', () => {
    const match = findMatchedCustomer(
      { cnpjCpf: null, consignee: 'Cliente Alfa' },
      makeMaps(),
    )

    expect(match).toEqual({
      customer: { id: 1, name: 'CLIENTE ALFA LTDA' },
      matchType: 'name',
    })
  })

  it('casa consignee com hifen diferente do nome no banco', () => {
    const match = findMatchedCustomer(
      { cnpjCpf: null, consignee: 'ALLOG GALERIA TRANSPORTES INTERNACIONAIS LTDA' },
      makeMaps(),
    )

    expect(match).toEqual({
      customer: { id: 3, name: 'ALLOG GALERIA - TRANSPORTES INTERNACIONAIS LTDA' },
      matchType: 'name',
    })
  })

  it('prioriza match por documento sobre nome canonico', () => {
    const match = findMatchedCustomer(
      { cnpjCpf: '12.345.678/0001-95', consignee: 'Cliente Alfa' },
      makeMaps(),
    )

    expect(match?.matchType).toBe('document')
    expect(match?.customer.id).toBe(1)
  })
})

describe('findMatchedCustomer — guarda do fuzzy por token distintivo (R4)', () => {
  function maps(): CustomerMaps {
    const aj = { id: 10, name: 'AJ COMERCIO EXTERIOR LTDA' }
    return {
      customersByDocument: new Map(),
      customersByName: new Map(),
      customersByCanonicalName: new Map([['aj comercio exterior', aj]]),
      canonicalList: [{ canonical: 'aj comercio exterior', record: aj }],
    }
  }

  it('NAO casa nomes que so compartilham termos genericos (QA vs AJ)', () => {
    const match = findMatchedCustomer({ cnpjCpf: null, consignee: 'QA COMERCIO EXTERIOR SA' }, maps())
    expect(match).toBeNull()
  })

  it('ainda casa fuzzy quando o token distintivo coincide (typo no sufixo)', () => {
    const match = findMatchedCustomer({ cnpjCpf: null, consignee: 'AJ COMERCIO EXTERIOAR' }, maps())
    expect(match).toEqual({ customer: { id: 10, name: 'AJ COMERCIO EXTERIOR LTDA' }, matchType: 'name' })
  })
})
