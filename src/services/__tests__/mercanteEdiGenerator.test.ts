import { describe, expect, it } from 'vitest'
import {
  generateM5Record,
  generateC5Record,
  generateI5Record,
  generateEdiMercante,
  type MercanteManifestData,
} from '../mercanteEdiGenerator'

const SAMPLE_MANIFEST: MercanteManifestData = {
  shippingCompanyCode: 'CN01321',
  agencyCnpj: '06352972000121',
  voyageNumber: '39',
  vesselImo: '9846495',
  polLocode: 'CNNGB',
  podLocode: 'BRVIX',
  terminalCode: 'BRVIX004',
  operationDate: '04072026',
  closingDate: '18052026',
  bls: [
    {
      blNumber: 'CSC4537060EC00',
      consigneeCnpjCpf: '20185717000162',
      consigneeName: 'NEXT SHIPPING LOGISTICA INTERNACIONAL LTDA',
      consigneeAddress: 'RUA JORGE TZASCHEL, NO 350 SALA 5 CEP: 88301600 ITAJAI SC BRASIL',
      shipperName: 'LONGSAIL SUPPLY CHAIN CO.,LTD.',
      shipperAddress: '01A, 6TH FLOOR, T2, RUNHONG BUILDING, NO. 2000, DONGGUANG SOUTH ROAD, WAIGAOQIAO FREE TRADE ZONE, SHANGHAI, CHINA',
      cargoDescription: 'E-BIKE ELECTRIC BIKE',
      totalPackages: 560,
      totalWeightKg: 13600,
      totalCbm: 0,
      containers: [
        {
          containerNumber: 'CSGU6470070',
          sealNumber: '03800000',
          containerType: '45G1',
          tareWeightKg: 3800,
          grossWeightKg: 6800,
          ncmCodes: ['8711'],
          isImo: true,
          imoClass: '9',
          unNumber: '3556',
        },
      ],
    },
  ],
}

describe('generateM5Record', () => {
  it('generates M5 record with correct field positions', () => {
    const m5 = generateM5Record(SAMPLE_MANIFEST)

    expect(m5.substring(0, 2)).toBe('M5')
    expect(m5.substring(2, 6)).toBe('0001')
    expect(m5.substring(6, 10)).toBe('    ')
    expect(m5.substring(10, 24)).toBe('CN01321       ')
    expect(m5.substring(24, 38)).toBe('06352972000121')
    expect(m5.substring(38, 46)).toBe('18052026')
    expect(m5.substring(46, 54)).toBe('04072026')
    expect(m5.substring(54, 59)).toBe('CNNGB')
    expect(m5.substring(59, 64)).toBe('BRVIX')
    expect(m5.substring(64, 74)).toBe('39        ')
    expect(m5.substring(74, 84)).toBe('9846495   ')
    expect(m5.substring(84, 92)).toBe('BRVIX004')
  })
})

describe('generateC5Record', () => {
  it('generates C5 record with fields separated by 4 spaces', () => {
    const bl = SAMPLE_MANIFEST.bls[0]
    const c5 = generateC5Record(bl)

    expect(c5.substring(0, 2)).toBe('C5')
    expect(c5.substring(2, 6)).toBe('0560')
    const tokens = c5.split('    ')
    expect(tokens.length).toBeGreaterThanOrEqual(10)
    expect(tokens[1]).toBe('20185717000162')
    expect(tokens[2]).toBe('NEXT SHIPPING LOGISTICA INTERNACIONAL LTDA')
    expect(tokens[7]).toBe('560')
    expect(tokens[8]).toBe('13600')
  })
})

describe('generateI5Record', () => {
  it('generates I5 record with correct container data', () => {
    const ctr = SAMPLE_MANIFEST.bls[0].containers[0]
    const i5 = generateI5Record(ctr, 1)

    expect(i5.startsWith('I50001')).toBe(true)
    const tokens = i5.split('    ')
    expect(tokens[1]).toBe('CSGU6470070')
    expect(tokens[2]).toBe('03800000')
    expect(tokens[3]).toBe('45G1')
  })
})

describe('generateEdiMercante', () => {
  it('generates complete EDI with M5, C5 and I5 records', () => {
    const edi = generateEdiMercante(SAMPLE_MANIFEST)
    const lines = edi.split('\r\n')

    expect(lines.length).toBe(3)
    expect(lines[0].startsWith('M5')).toBe(true)
    expect(lines[1].startsWith('C5')).toBe(true)
    expect(lines[2].startsWith('I5')).toBe(true)
  })

  it('generates multiple I5 records for multiple containers', () => {
    const edi = generateEdiMercante({
      ...SAMPLE_MANIFEST,
      bls: [
        {
          ...SAMPLE_MANIFEST.bls[0],
          containers: [
            SAMPLE_MANIFEST.bls[0].containers[0],
            { ...SAMPLE_MANIFEST.bls[0].containers[0], containerNumber: 'CSGU6470337' },
          ],
        },
      ],
    })
    const lines = edi.split('\r\n')

    expect(lines.length).toBe(4)
    expect(lines[2].includes('CSGU6470070')).toBe(true)
    expect(lines[3].includes('CSGU6470337')).toBe(true)
  })
})
