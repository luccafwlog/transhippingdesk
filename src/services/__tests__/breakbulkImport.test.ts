import { describe, expect, it, vi } from 'vitest'
import { parseBreakbulkManifestBuffer } from '../breakbulkImport'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

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
    expect(bl?.bb_machine_qty).toBe(5)
    expect(bl?.bb_packages_qty).toBe(5)
    expect(bl?.total_weight_kg).toBe(99700)
    expect(bl?.total_cbm).toBeCloseTo(393.35)
    expect(bl?.cnpj_cpf).toBe('12116971001071')
  })

  it('parseia carrier TAICANG com partes em linhas SH/CN/NP', async () => {
    const buffer = aoaToBuffer([
      ['EXPORT CARGO MANIFEST'],
      ['LOADING PORT:', 'TAICANG, CHINA', '', 'DISCH PORT:', 'VITORIA, BRAZIL'],
      ['B/L NO.', 'SHIPPER/CONSIGNEE/NOTIFY PARTY', '', '', 'MARKS', 'DESCRIPTION OF GOODS', '', '', 'NUMBER OF PIECES', '', 'GROSS WEIGHT'],
      [
        'GRI011TCVIT101',
        'SH:',
        'SANY SOUTH EAST ASIA PTE LTD\nHUP HIN BUILDING',
        '',
        'SANY DO BRASIL',
        '16 PACKAGES\n8 UNITS SANY HYDRAULIC EXCAVATOR SY215H',
        '',
        '',
        16,
        'PACKAGES',
        175440,
        'KGS',
      ],
      ['', 'CN:', 'COMEXPORT TRADING COMERCIO EXTERIOR LTDA - CNPJ: 01.135.153/0006-13', '', '', '', '', '', '', '', 794.761, 'CBMS'],
      ['', 'NP:', 'SANY IMPORTACAO E EXPORTACAO DA AMERICA DO SUL LTDA - CNPJ: 09.066.194/0002-83'],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('GRI011TCVIT101')
    expect(bl?.shipper).toContain('SANY SOUTH EAST ASIA')
    expect(bl?.consignee).toContain('COMEXPORT TRADING')
    expect(bl?.notify_party).toContain('SANY IMPORTACAO')
    expect(bl?.cnpj_cpf).toBe('01135153000613')
    expect(bl?.pol).toBe('CNTAC')
    expect(bl?.pod).toBe('BRVIX')
    expect(bl?.bb_machine_qty).toBe(8)
    expect(bl?.total_weight_kg).toBe(175440)
    expect(bl?.total_cbm).toBeCloseTo(794.761)
  })

  it('parseia carrier SYSTEM MANIFEST com partes em celula combinada', async () => {
    const buffer = aoaToBuffer([
      ['MANIFEST'],
      ['PORT OF LOADING:ZHANGJIAGANG, CN', 'PORT OF DISCHARGE:VITORIA, BR'],
      ['Shippers (SH); Consignee (CO); Notify Address (NF)', 'B/L Nr.', 'Marks and Numbers', 'Quantity', 'Description', 'Gross Weight', 'Measurement'],
      [
        'Shipper (SH)\nSANY SOUTH EAST ASIA PTE LTD\nConsignee (CO)\nTIMBRO TRADING S.A\nCNPJ: 12.116.971/0010-71\nNotify Address (NF)\nSANY IMPORTACAO E EXPORTACAO DA AMERICA DO SUL LTDA',
        'GSAL08ZJGVIT02C',
        'SANY DO BRASIL',
        '30PKGS',
        '30 packages\n10 UNIT SANY HYDRAULIC EXCAVATOR SY135C',
        '136873KGS',
        '614.313CBM',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('GSAL08ZJGVIT02C')
    expect(bl?.shipper).toBe('SANY SOUTH EAST ASIA PTE LTD')
    expect(bl?.consignee).toBe('TIMBRO TRADING S.A')
    expect(bl?.cnpj_cpf).toBe('12116971001071')
    expect(bl?.bb_machine_qty).toBe(10)
    expect(bl?.bb_packages_qty).toBe(30)
    expect(bl?.total_weight_kg).toBe(136873)
    expect(bl?.total_cbm).toBeCloseTo(614.313)
  })

  it('parseia carrier ZJG com BL numerico e colunas deslocadas', async () => {
    const buffer = aoaToBuffer([
      ['CARGO MANIFEST'],
      ['M.V. COSCO SHIPPING WISDOM', '', 'FROM: ZHANGJIAGANG'],
      ['B/L NO.', 'POD', 'DECRIPTION', '', '', '', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', '', 'CONSIGNEE', '', 'NOTIFY'],
      [
        '4514V20ZJGRIO01',
        'RIO DE JANEIRO ,BRAZIL',
        'STUDLESS ANCHOR CHAIN CABLE',
        '',
        '',
        '',
        '75BE',
        '3156820.0',
        '1063.89',
        'BESTLINK TRANSPORT LOGISTIC CO.,LTD.',
        '',
        'ALICAM SERVICOS ADUARNEIROS',
        '',
        'SAME AS CONSIGNEE',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)
    const bl = manifest.bls[0]

    expect(manifest.layout).toBe('carrier')
    expect(manifest.rowErrors).toHaveLength(0)
    expect(bl?.bl_id).toBe('4514V20ZJGRIO01')
    expect(bl?.consignee).toBe('ALICAM SERVICOS ADUARNEIROS')
    expect(bl?.bb_machine_qty).toBeNull()
    expect(bl?.bb_packages_qty).toBe(75)
    expect(bl?.total_weight_kg).toBe(3156820)
    expect(bl?.total_cbm).toBeCloseTo(1063.89)
  })

  it('quantifica maquinas por nomenclatura de equipamento na descricao', async () => {
    const buffer = aoaToBuffer([
      ['CARGO MANIFEST'],
      ['M.V. EQUIPMENT TEST', '', 'FROM: ZHANGJIAGANG'],
      ['B/L NO.', 'POD', 'DECRIPTION', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'],
      [
        'ZJGBUSCRANE01',
        'VITORIA,BRAZIL',
        '3 UNITS ELECTRIC BUS\n1 UNIT XCMG MOBILE CRANE',
        4,
        100000,
        300,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls[0]?.bb_machine_qty).toBe(4)
  })

  it('usa identificadores tecnicos para quantificar maquinas em descricoes variaveis', async () => {
    const buffer = aoaToBuffer([
      ['CARGO MANIFEST'],
      ['M.V. EQUIPMENT TEST', '', 'FROM: ZHANGJIAGANG'],
      ['B/L NO.', 'POD', 'DECRIPTION', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'],
      [
        'ZJGCRUSHER01',
        'VITORIA,BRAZIL',
        '1 UNIT MOBILE JAW CRUSHER\nCHASSIS NUMBER/VIN NUMBER/ENGINE NUMBER:\nXUGCRUSHER001/ENG001',
        1,
        52000,
        120,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
      [
        'ZJGTRUCK01',
        'VITORIA,BRAZIL',
        '3 UNITS OFF-ROAD TRUCK\nFRAME NO./ENGINE NO.:\nTRUCK001/ENG001',
        3,
        150000,
        450,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
      [
        'ZJGUNITONLY01',
        'VITORIA,BRAZIL',
        '2 UNITS\nCHASSIS NUMBER/VIN NUMBER/ENGINE NUMBER:\nUNIT001/ENG001\nUNIT002/ENG002',
        2,
        80000,
        250,
        'SHIPPER TEST LTDA',
        'CONSIGNEE TEST LTDA\nCNPJ: 12.345.678/0001-95',
        'SAME AS CONSIGNEE',
      ],
    ])

    const manifest = await parseBreakbulkManifestBuffer(buffer)

    expect(manifest.rowErrors).toHaveLength(0)
    expect(manifest.bls.find((bl) => bl.bl_id === 'ZJGCRUSHER01')?.bb_machine_qty).toBe(1)
    expect(manifest.bls.find((bl) => bl.bl_id === 'ZJGTRUCK01')?.bb_machine_qty).toBe(3)
    expect(manifest.bls.find((bl) => bl.bl_id === 'ZJGUNITONLY01')?.bb_machine_qty).toBe(2)
  })
})
