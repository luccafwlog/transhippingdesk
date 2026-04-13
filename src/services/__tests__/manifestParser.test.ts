import { describe, expect, it } from 'vitest'
import { countDistinctManifestContainers, parseManifestBuffer } from '../manifestParser'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

describe('manifestParser', () => {
  it('parseia manifesto carrier-style e deduplica containers entre BLs', async () => {
    const buffer = aoaToBuffer([
      ['EXPORT MANIFEST'],
      ['VESSEL GREEN SHANGHAI', 'VOYAGE 2', 'POL CNTAC', 'POD BRVIT', 'SAILED 2026-02-19'],
      ['BL NO.'],
      [
        'CSC4538060A001',
        '',
        '',
        'AUTO PARTS',
        '',
        '',
        'SHIPPER: SENDER ALFA | COMPANY: IMPORTADOR ALFA LTDA | CNPJ: 12.345.678/0001-95 | EMAIL: alfa@example.com',
      ],
      ['CAXU1234567/40FM/SEAL001/FCL/COC/10 PKG/1000/20'],
      ['TGHU7654321/48FR/SEAL002/FCL/COC/20 PKG/2000/30'],
      [
        'CSC4538060A002',
        '',
        '',
        'AUTO PARTS',
        '',
        '',
        'SHIPPER: SENDER BETA | COMPANY: IMPORTADOR BETA LTDA | CNPJ: 98.765.432/0001-10 | EMAIL: beta@example.com',
      ],
      ['CAXU1234567/40FM/SEAL009/FCL/COC/15 PKG/1500/25'],
    ])

    const manifest = await parseManifestBuffer(buffer)

    expect(manifest.bls).toHaveLength(2)
    expect(manifest.manifest_etd).toBe('2026-02-19')
    expect(manifest.suggestedVoyage?.vesselName).toBe('GREEN SHANGHAI')
    expect(manifest.suggestedVoyage?.voyageNumber).toBe('2')
    expect(manifest.bls[0]?.consignee).toBe('IMPORTADOR ALFA LTDA')
    expect(manifest.bls[1]?.shipper).toBe('SENDER BETA')
    expect(countDistinctManifestContainers(manifest)).toBe(2)
    expect(manifest.rowErrors).toHaveLength(0)
  })

  it('mantem revisao pendente quando ha container duplicado no mesmo BL', async () => {
    const buffer = jsonToBuffer([
      {
        'B/L': 'BL001',
        Consignatario: 'Cliente Um',
        CNPJ: '12.345.678/0001-95',
        POL: 'CNTAC',
        POD: 'BRVIT',
        Container: 'CAXU1234567',
        Type: '40FM',
        'Peso bruto': '1.000,50',
        CBM: '10,5',
      },
      {
        'B/L': 'BL001',
        Consignatario: 'Cliente Um',
        CNPJ: '12.345.678/0001-95',
        POL: 'CNTAC',
        POD: 'BRVIT',
        Container: 'CAXU1234567',
        Type: '40FM',
        'Peso bruto': '1.200,00',
        CBM: '11,0',
      },
      {
        'B/L': 'BL002',
        Consignatario: 'Cliente Dois',
        CNPJ: '98.765.432/0001-10',
        POL: 'CNTAC',
        POD: 'BRSSA',
        Container: 'TGHU7654321',
        Type: '48FR',
        'Peso bruto': '2.000,00',
        CBM: '22,0',
      },
    ])

    const manifest = await parseManifestBuffer(buffer)
    const duplicatedBl = manifest.bls.find((bl) => bl.id === 'BL001')

    expect(manifest.bls).toHaveLength(2)
    expect(duplicatedBl?.review_status).toBe('pending_review')
    expect(duplicatedBl?.review_reasons).toContain('Container duplicado no mesmo B/L')
    expect(countDistinctManifestContainers(manifest)).toBe(2)
  })
})
