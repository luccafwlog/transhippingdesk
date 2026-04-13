import { describe, expect, it } from 'vitest'
import { parseBreakbulkManifestBuffer } from '../breakbulkImport'
import { jsonToBuffer } from './testWorkbook'

describe('breakbulkImport', () => {
  it('parseia o layout BB resumido', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'CCSV22001',
        CE: '122605051526081',
        MAQUINAS: 8,
        PACKAGES: 24,
        'PACKAGES TOTAL': 32,
        'WEIGHT (TON)': '259,312',
        'CBM (M3)': '1217,109',
        SHIPPER: 'SANY INTERNATIONAL',
        CONSIGNEE: 'TIMBRO TRADING S.A.',
        NOTIFY: 'SANY IMPORTACAO',
      },
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.layout).toBe('summary')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls).toHaveLength(1)
    expect(manifest.bls[0]?.bb_machine_qty).toBe(8)
    expect(manifest.bls[0]?.bb_packages_total).toBe(32)
    expect(manifest.bls[0]?.bb_weight_ton).toBeCloseTo(259.312)
    expect(manifest.bls[0]?.total_weight_kg).toBeCloseTo(259312)
  })

  it('agrega linhas do layout BB legado por BL', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'BBL001',
        CONSIGNATARIO: 'IMPORTADOR ALFA',
        CNPJ: '12.345.678/0001-95',
        POL: 'CNTAC',
        POD: 'BRSSA',
        DESCRICAO: 'MOTOR',
        VOLUMES: 2,
        PESO_KG: 1000,
        CBM: '10,5',
      },
      {
        BL: 'BBL001',
        CONSIGNATARIO: 'IMPORTADOR ALFA',
        CNPJ: '12.345.678/0001-95',
        POL: 'CNTAC',
        POD: 'BRSSA',
        DESCRICAO: 'CHASSI',
        VOLUMES: 3,
        PESO_KG: 500,
        CBM: '4,5',
      },
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('legacy')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls).toHaveLength(1)
    expect(bl?.bb_packages_total).toBe(5)
    expect(bl?.total_weight_kg).toBe(1500)
    expect(bl?.total_cbm).toBeCloseTo(15)
    expect(bl?.items).toHaveLength(2)
  })
})
