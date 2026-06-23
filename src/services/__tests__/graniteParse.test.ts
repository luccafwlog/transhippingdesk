import { expect, it, vi } from 'vitest'
import { jsonToBuffer } from './testWorkbook'

vi.mock('../customerReconciliation', () => ({
  loadCustomerMaps: vi.fn(() => Promise.resolve({})),
  findMatchedCustomer: vi.fn(() => null),
}))
vi.mock('../supabase', () => ({ supabase: { from: vi.fn() } }))

import { parseGraniteManifestFile } from '../graniteImport'

function cosco(rows: Array<Record<string, string | number>>) {
  return new File([jsonToBuffer(rows)], 'cosco.xlsx')
}

it('US-077: parseia a planilha COSCO mapeando colunas e reconciliando CNPJ', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([
      { '#': 1, BL: 'BL-G1', 'Navio/Viagem': 'NAVIO/14', CNPJ: '11.222.333/0001-81', Shipper: 'Granito SA', 'Real Weight': 5000 },
    ]),
  )

  expect(parsed.bls).toHaveLength(1)
  expect(parsed.bls[0]).toMatchObject({
    bl_number: 'BL-G1',
    real_weight_kg: 5000,
    vessel_voyage: 'NAVIO/14',
    shipper_name: 'Granito SA',
    reconciliationStatus: 'not_found',
  })
  expect(parsed.vesselVoyage).toBe('NAVIO/14')
})

it('US-077: registra erro de linha quando o Real Weight esta ausente ou zero', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ '#': 1, BL: 'BL-G2', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 0 }]),
  )

  expect(parsed.bls).toHaveLength(0)
  expect(parsed.rowErrors.length).toBeGreaterThan(0)
})
