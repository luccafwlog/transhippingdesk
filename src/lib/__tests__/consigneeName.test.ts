import { describe, expect, it } from 'vitest'
import { extractConsigneeShortName } from '../consigneeName'

describe('extractConsigneeShortName', () => {
  it('termina inclusivamente na natureza juridica', () => {
    expect(extractConsigneeShortName('QA IMPORTADORA LTDA\nRUA X, 100\nVITORIA ES')).toBe('QA IMPORTADORA LTDA')
    expect(extractConsigneeShortName('ACME COMERCIO EXTERIOR S.A. AV BRASIL 1')).toBe('ACME COMERCIO EXTERIOR S.A.')
  })

  it('reconhece combinacoes como LTDA EPP', () => {
    expect(extractConsigneeShortName('FOO BAR LTDA EPP\nCEP 29000-000')).toBe('FOO BAR LTDA EPP')
  })

  it('reconhece EIRELI, EI, MEI, SLU, EPP, ME', () => {
    expect(extractConsigneeShortName('JOAO SILVA MEI TEL 27 99999')).toBe('JOAO SILVA MEI')
    expect(extractConsigneeShortName('BETA TRADE EIRELI\nBRASIL')).toBe('BETA TRADE EIRELI')
    expect(extractConsigneeShortName('OMEGA IMPORTACAO EI AV BEIRA MAR 200')).toBe('OMEGA IMPORTACAO EI')
    expect(extractConsigneeShortName('SIGMA LOGISTICA SLU\nVITORIA ES')).toBe('SIGMA LOGISTICA SLU')
    expect(extractConsigneeShortName('ALFA TRADING EPP CEP 29000-000')).toBe('ALFA TRADING EPP')
    expect(extractConsigneeShortName('BRAVO COMERCIAL ME TEL 27 3333-4444')).toBe('BRAVO COMERCIAL ME')
  })

  it('nao confunde o primeiro token da razao social com sufixo juridico', () => {
    expect(extractConsigneeShortName('ME GUSTA ALIMENTOS LTDA')).toBe('ME GUSTA ALIMENTOS LTDA')
    expect(extractConsigneeShortName('EI TRANSPORTES BRASIL LTDA')).toBe('EI TRANSPORTES BRASIL LTDA')
    expect(extractConsigneeShortName('SA COMERCIO IMPORTACAO LTDA')).toBe('SA COMERCIO IMPORTACAO LTDA')
  })

  it('aceita SA cru apenas como ultimo token da linha', () => {
    expect(extractConsigneeShortName('ACME COMERCIO SA')).toBe('ACME COMERCIO SA')
    expect(extractConsigneeShortName('ACME SA COMERCIO AV BRASIL 1')).toBe('ACME SA COMERCIO AV BRASIL 1')
  })

  it('sem natureza juridica reconhecida usa a primeira linha nao vazia', () => {
    expect(extractConsigneeShortName('\n  \nGAMMA GLOBAL TRADING\nRUA Y')).toBe('GAMMA GLOBAL TRADING')
  })

  it('nao inclui endereco, telefone, CEP, cidade ou pais apos o marcador', () => {
    expect(extractConsigneeShortName('DELTA LOG LTDA CNPJ 11.444.777/0001-61 VITORIA BRAZIL')).toBe('DELTA LOG LTDA')
  })
})
