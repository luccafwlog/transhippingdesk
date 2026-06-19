import { describe, expect, it } from 'vitest'
import { parseManifestParty } from '../manifestParser'

const VITORIA_BLOCK = [
  'BYD (H.K.) CO.,LIMITED',
  'UNIT 505-510, SCIENCE PARK, HONG KONG, CHINA',
  'COMPANY: COMEXPORT TRADING COMÉRCIO EXTERIOR LTDA.',
  'ADDRESS: RODOVIA GOVERNADOR MARIO COVAS, 3101',
  'CNPJ: 01.135.153/0006-13',
  'NAME: DENISE ALVES FERNANDES',
  'E-MAIL: DENISE.FERNANDES@COMEXPORT.COM.BR',
  'SAME AS CONSIGNEE',
].join('\n')

const SALVADOR_BLOCK = [
  'SNF (CHINA) FLOCCULANT CO., LTD',
  'NO.6, NORTH BINJIANG ROAD, JIANGSU PROVINCE, CHINA',
  'TEL: 0086-523-80736300',
  'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
  'CNPJ:13.661.609/0001-53',
  'VIA DO MAR S/N - BA 530',
  'CEP 42.816-280 - CAMACARI - BAHIA - BRASIL',
  'JMALULI@SNFBRASIL.COM',
  'TRADICIONAL COMERCIO EXTERIOR EIRELI',
  'CNPJ:13.932.974/0001-55',
  'ATENDIMENTOIMP3@JOSERUBEM.COM.BR',
  'VIABILIDADE SERVICOS DE COMERCIO EXTERIOR LTDA',
  'CNPJ:28.176.854/0001-42',
].join('\n')

describe('parseManifestParty notify_party', () => {
  it('Modelo 1: returns the literal SAME AS CONSIGNEE', () => {
    expect(parseManifestParty(VITORIA_BLOCK).notify_party).toBe('SAME AS CONSIGNEE')
  })

  it('Modelo 2: returns the first notify party only', () => {
    expect(parseManifestParty(SALVADOR_BLOCK).notify_party).toBe('TRADICIONAL COMERCIO EXTERIOR EIRELI')
  })

  it('returns empty string when there is no notify party', () => {
    const block = 'ACME LTD\nCOMPANY: CLIENTE LTDA\nCNPJ: 11.111.111/0001-11'
    expect(parseManifestParty(block).notify_party).toBe('')
  })
})
