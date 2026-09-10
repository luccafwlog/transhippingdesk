import { expect, it, vi } from 'vitest'
import { jsonToBuffer } from './testWorkbook'

vi.mock('../customerReconciliation', () => ({
  loadCustomerMaps: vi.fn(() => Promise.resolve({})),
  findMatchedCustomer: vi.fn(() => null),
  resolveCustomerLink: vi.fn(() => ({ customerId: null, suggestedCustomerId: null, status: 'missing_customer', notes: 'Cliente nao encontrado na base cadastral.' })),
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

it('S03: rejeita coerção silenciosa de expoente e letras em pesos', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([
      { BL: 'BL-G7', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': '1e3' },
      { BL: 'BL-G8', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': '12abc' },
    ]),
  )

  expect(parsed.bls).toHaveLength(0)
  expect(parsed.rowErrors).toHaveLength(4)
})

it('ADR 2026-07-31 (Task 6): normaliza L/PORT para LOCODE, aceitando codigo ja limpo e texto livre', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([
      { '#': 1, BL: 'BL-G3', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'L/PORT': 'BRVIX' },
      { '#': 2, BL: 'BL-G4', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'L/PORT': 'VITORIA' },
      { '#': 3, BL: 'BL-G5', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'L/PORT': 'Vitoria, Brazil' },
    ]),
  )

  expect(parsed.bls).toHaveLength(3)
  expect(parsed.bls.map((bl) => bl.loading_port)).toEqual(['BRVIX', 'BRVIX', 'BRVIX'])
})

it('ADR 2026-07-31 (Task 6): sem L/PORT na planilha, loading_port fica null (fallback do manifesto e' +
  ' resolvido na derivacao do ADR, nao aqui)', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ '#': 1, BL: 'BL-G6', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000 }]),
  )

  expect(parsed.bls).toHaveLength(1)
  expect(parsed.bls[0].loading_port).toBeNull()
})

it('S03: rejeita data de prontidao com calendario impossivel, sem descartar o B/L', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ BL: 'BL-G9', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'Prontidao de Carga': '31/02/2026' }]),
  )

  expect(parsed.bls).toHaveLength(1)
  expect(parsed.bls[0]?.cargo_readiness_date).toBeNull()
  expect(parsed.rowErrors).toEqual([
    expect.objectContaining({ row: 2, message: expect.stringContaining('Cargo Readiness') }),
  ])
})

it('S03: normaliza data valida e bloqueia porto fora do contrato', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ BL: 'BL-G10', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'Prontidao de Carga': '29/02/2024', 'D/PORT': 'porto inexistente' }]),
  )

  expect(parsed.bls[0]?.cargo_readiness_date).toBe('2024-02-29')
  expect(parsed.bls[0]?.discharge_port).toBe('PORTO INEXISTENTE')
  expect(parsed.rowErrors).toEqual([
    expect.objectContaining({ row: 2, message: expect.stringContaining('D/PORT') }),
  ])
})
