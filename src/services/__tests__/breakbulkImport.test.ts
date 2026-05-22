import { describe, expect, it, vi } from 'vitest'
import { parseBreakbulkManifestBuffer } from '../breakbulkImport'
import { jsonToBuffer } from './testWorkbook'

// breakbulkImport importa customerReconciliation que importa supabase — mock necessário para
// testes de parser que não usam o banco.
vi.mock('../supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

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

  it('parseia layout carrier com cabecalho B/L NO.', async () => {
    const buffer = jsonToBuffer([
      { A: 'CARGO MANIFEST' },
      { A: 'B/L NO.', B: 'POD', C: 'DECRIPTION', D: 'Pkg', E: 'G.W(KGS)', F: 'CBM', G: 'SHIPPER', H: 'CONSIGNEE', I: 'NOTIFY' },
      {
        A: 'JQV37ZJGPAR001',
        B: 'VITORIA,BRAZIL',
        C: '5 PACKAGES\n5 UNITS OF XCMG BULLDOZER',
        D: 5,
        E: 99700,
        F: 393.35,
        G: 'XCMG CONSTRUCTION MACHINERY GROUP HK LIMITED',
        H: 'TIMBRO TRADING S.A\nCNPJ: 12.116.971/0010-71',
        I: 'SAME AS CONSIGNEE',
      },
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('JQV37ZJGPAR001')
    expect(bl?.pod).toBe('BRVIX')
    expect(bl?.bb_packages_qty).toBe(5)
    expect(bl?.total_weight_kg).toBe(99700)
    expect(bl?.total_cbm).toBeCloseTo(393.35)
    expect(bl?.cnpj_cpf).toBe('12116971001071')
  })
})
