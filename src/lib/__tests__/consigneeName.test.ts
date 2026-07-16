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
  })

  it('sem natureza juridica reconhecida usa a primeira linha nao vazia', () => {
    expect(extractConsigneeShortName('\n  \nGAMMA GLOBAL TRADING\nRUA Y')).toBe('GAMMA GLOBAL TRADING')
  })

  it('nao inclui endereco, telefone, CEP, cidade ou pais apos o marcador', () => {
    expect(extractConsigneeShortName('DELTA LOG LTDA CNPJ 11.444.777/0001-61 VITORIA BRAZIL')).toBe('DELTA LOG LTDA')
  })
})
