import { describe, expect, it } from 'vitest'
import { extractMercanteBlocks } from '../manifestParser'
import { generateC5Record, type MercanteBlData } from '../mercanteEdiGenerator'

// Real SHIPPER/CONSIGNEE/NOTIFY/NOTIFY2 cell from the GREEN SANTOS 14 manifest
// (CSC45250E00N00 / FLOPAM), as stored in the carrier xlsx party column.
const PARTY_CELL = [
  'SNF (CHINA) FLOCCULANT CO., LTD ',
  'NO.6, NORTH BINJIANG ROAD, ',
  'TAIXING ECONOMIC DEVELOPMENT ZONE, ',
  'TAIXING, 225442, JIANGSU PROVINCE, CHINA ',
  'TEL: 0086-523-80736300 ',
  'FAX: 0086-523-80735423',
  'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
  'CNPJ:13.661.609/0001-53',
  'VIA DO MAR S/N - BA 530',
  'POLO PETROQUIMICO',
  'CEP 42.816-280 - CAMACARI - BAHIA - BRASIL',
  'JULIAN ',
  'JMALULI@SNFBRASIL.COM',
  'PHONE: 71-35997719',
  'TRADICIONAL COMERCIO EXTERIOR EIRELI',
  'VIA CENTRO, 1O PAVIMENTO , CIA, 3644, CIA SUL, ',
  'SIMOES FILHO, BAHIA, BRASIL, CEP: 43.700-000',
  'CNPJ:13.932.974/0001-55',
  'ATENDIMENTOIMP3@JOSERUBEM.COM.BR',
  'VIABILIDADE SERVICOS DE COMERCIO EXTERIOR LTDA ',
  'CNPJ: 28.176.854/0001-42 ',
  'RUA JOSE ROBERTO OTTONI, 864. VALERIA, SALVADOR-BA, ',
  'CEP: 41.301.325 ',
  'MARISA REIS-MARISA@VBLD.COM.BR-(+55)7198679-9400',
].join('\n')

const DESC_CELL = [
  '3 FLEXITANK',
  'FCL/FCL',
  'FLOCRYL DADMAC 64 HST',
  'NET WEIGHT:71780KGS',
].join('\n')

describe('extractMercanteBlocks', () => {
  const blocks = extractMercanteBlocks(PARTY_CELL, DESC_CELL)

  it('isolates the four party blocks', () => {
    expect(blocks.shipper_block?.startsWith('SNF (CHINA) FLOCCULANT')).toBe(true)
    expect(blocks.consignee_block?.startsWith('FLOPAM DO BRASIL')).toBe(true)
    expect(blocks.notify_block?.startsWith('TRADICIONAL COMERCIO')).toBe(true)
    expect(blocks.notify2_block?.startsWith('VIABILIDADE SERVICOS')).toBe(true)
  })

  it('pulls the consignee phone out of the consignee block', () => {
    expect(blocks.consignee_phone).toBe('PHONE: 71-35997719')
    expect(blocks.consignee_block?.includes('PHONE')).toBe(false)
  })

  it('keeps shipper TEL/FAX inside the shipper block', () => {
    expect(blocks.shipper_block?.includes('TEL: 0086-523-80736300')).toBe(true)
    expect(blocks.shipper_block?.includes('FAX: 0086-523-80735423')).toBe(true)
  })

  it('captures notify CNPJ and packages', () => {
    expect(blocks.notify_cnpj_cpf).toBe('13932974000155')
    expect(blocks.total_packages).toBe(3)
    expect(blocks.packages_unit).toBe('FLEXITANK')
  })

  it('feeds the generator to reproduce the FWL consignee + notify fields', () => {
    const bl: MercanteBlData = {
      blNumber: 'CSC45250E00N00',
      consigneeCnpjCpf: '13.661.609/0001-53',
      consigneeName: 'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
      consigneeBlock: blocks.consignee_block ?? '',
      consigneeAddress: '',
      consigneePhone: blocks.consignee_phone ?? '',
      shipperName: 'SNF',
      shipperBlock: blocks.shipper_block ?? '',
      notifyCnpjCpf: blocks.notify_cnpj_cpf ?? '',
      notifyBlock: blocks.notify_block ?? '',
      notify2Block: blocks.notify2_block ?? '',
      cargoDescription: 'FLOCRYL DADMAC 64 HST',
      totalPackages: blocks.total_packages ?? 0,
      packagesUnit: blocks.packages_unit ?? '',
      totalWeightKg: 72110,
      totalCbm: 78,
      polLocode: 'CNTAC',
      podLocode: 'BRSSA',
      countryOfOrigin: 'CN',
      destinationUf: 'BA',
      terminalCode: 'BRSSA002',
      paymentType: '',
      freightLines: [],
      containers: [],
    }
    const c5 = generateC5Record(bl, '2026-04-25')
    expect(c5.substring(29, 196)).toBe(
      'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA CNPJ:13.661.609000153 VIA DO MAR SN BA 530 POLO PETROQUIMICO CEP 42.816280 CAMACARI BAHIA BRASIL JULIAN JMALULI@SNFBRASIL.COM**',
    )
    expect(c5.substring(1424, 1438)).toBe('13932974000155')
    expect(c5.substring(1438, 1620)).toBe(
      'TRADICIONAL COMERCIO EXTERIOR EIRELI VIA CENTRO, 1O PAVIMENTO , CIA, 3644, CIA SUL, SIMOES FILHO, BAHIA, BRASIL, CEP: 43.700000 CNPJ:13.932.974000155 ATENDIMENTOIMP3@JOSERUBEM.COM.BR',
    )
    // Description trailer: ** phone + ALSO NOTIFY + TOTAL.
    expect(c5.substring(642, 992)).toContain('**PHONE: 71-35997719 ALSO NOTIFY:VIABILIDADE')
    expect(c5).toContain('TOTAL: 3 FLEXITANKS')
  })
})
