import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { countDistinctManifestContainers, parseManifestBuffer } from '../manifestParser'

const fixturesPath = new URL('./fixtures/', import.meta.url)
const fixtureParseTimeoutMs = 15_000

async function readFixtureBuffer(filename: string) {
  const file = await readFile(new URL(filename, fixturesPath))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

describe('manifestParser with real fixtures', () => {
  it('valida o manifesto Vitoria TAX com contagem global distinta', async () => {
    const manifest = await parseManifestBuffer(await readFixtureBuffer('manifest-vitoria-tax.xlsx'))

    expect(manifest.bls).toHaveLength(13)
    expect(countDistinctManifestContainers(manifest)).toBe(748)
    // Containers compartilhados entre B/Ls sao tratados como Part Lot, sem pendencia automatica.
    expect(manifest.bls.filter((bl) => bl.review_status === 'pending_review')).toHaveLength(0)
    expect(manifest.manifest_etd).toBe('2026-02-10')
    expect(manifest.suggestedVoyage).toMatchObject({
      carrierName: 'Cosco Shipping Specialized Carriers',
      carrierScac: 'CSSC',
      vesselName: 'GREEN RIZHAO',
      voyageNumber: '6',
      status: 'active',
    })

    const topBl = manifest.bls.find((bl) => bl.id === 'CSC4538060DZ07')
    expect(topBl).toBeDefined()
    expect(topBl?.consignee).toBe('COMEXPORT TRADING COMÉRCIO EXTERIOR LTDA.')
    expect(topBl?.cnpj_cpf).toBe('01135153000613')
    expect(topBl?.pol).toBe('CNTAC')
    expect(topBl?.pod).toBe('BRVIT')
    expect(topBl?.containers).toHaveLength(106)
  }, fixtureParseTimeoutMs)

  it('valida o manifesto BRVIT com um BL pendente de revisao', async () => {
    const manifest = await parseManifestBuffer(await readFixtureBuffer('manifest-brvit.xlsx'))

    expect(manifest.bls).toHaveLength(64)
    expect(countDistinctManifestContainers(manifest)).toBe(70)
    expect(manifest.bls.filter((bl) => bl.review_status === 'pending_review')).toHaveLength(1)
    expect(manifest.manifest_etd).toBe('2026-02-12')

    const sampleBl = manifest.bls.find((bl) => bl.id === 'CSC45380602A00')
    expect(sampleBl).toBeDefined()
    expect(sampleBl?.consignee).toBe('SINCERELY LOGISTIC LTDA')
    expect(sampleBl?.cnpj_cpf).toBe('60114713000108')
    expect(sampleBl?.pol).toBe('CNNBO')
    expect(sampleBl?.pod).toBe('BRVIT')
    expect(sampleBl?.containers).toHaveLength(1)
  }, fixtureParseTimeoutMs)

  it('valida o manifesto BRSSA com POD e contagem corretos', async () => {
    const manifest = await parseManifestBuffer(await readFixtureBuffer('manifest-brssa.xlsx'))

    expect(manifest.bls).toHaveLength(19)
    expect(countDistinctManifestContainers(manifest)).toBe(54)
    expect(manifest.bls.filter((bl) => bl.review_status === 'pending_review')).toHaveLength(0)
    expect(manifest.manifest_etd).toBe('2026-02-12')

    const sampleBl = manifest.bls.find((bl) => bl.id === 'CSC45380604Y00')
    expect(sampleBl).toBeDefined()
    expect(sampleBl?.consignee).toBe('ALLOG GALERIA - TRANSPORTES INTERNACIONAIS LTDA')
    expect(sampleBl?.cnpj_cpf).toBe('64063925000164')
    expect(sampleBl?.pol).toBe('CNNBO')
    expect(sampleBl?.pod).toBe('BRSSA')
    expect(sampleBl?.containers).toHaveLength(20)
  }, fixtureParseTimeoutMs)
})
