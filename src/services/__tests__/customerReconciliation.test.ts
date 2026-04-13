import { describe, expect, it } from 'vitest'
import { findMatchedCustomer, type CustomerMaps } from '../customerReconciliation'

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
