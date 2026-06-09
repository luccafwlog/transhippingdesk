import { describe, it, expect } from 'vitest'
import { buildTransshippingPixPayload } from '../pix'

// Vetores dourados: payloads completos calculados e validados com uma
// implementação independente de CRC-16/CCITT-FALSE (table-driven), conferida
// contra o vetor público do algoritmo ("123456789" -> 0x29B1).
// Qualquer mudança de um único caractere no payload quebra estes testes —
// é o comportamento desejado: pix.ts gera QR codes impressos em faturas reais.

describe('buildTransshippingPixPayload', () => {
  it('gera payload exato para valor com centavos e txid simples', () => {
    expect(buildTransshippingPixPayload(123.45, 'TESTTXID')).toBe(
      '00020126480014br.gov.bcb.pix0114063529720001210508TESTTXID5204000053039865406123.455802BR5925TRANSHIPPING AGENCIAMENTO6003VIT62120508TESTTXID63049823',
    )
  })

  it('gera payload exato para valor inteiro e txid de fatura', () => {
    expect(buildTransshippingPixPayload(1500, 'FAT2026000123')).toBe(
      '00020126530014br.gov.bcb.pix0114063529720001210513FAT202600012352040000530398654071500.005802BR5925TRANSHIPPING AGENCIAMENTO6003VIT62170513FAT20260001236304156A',
    )
  })

  it('omite o campo 54 e usa txid "***" quando valor é zero e txid vazio', () => {
    expect(buildTransshippingPixPayload(0, '')).toBe(
      '00020126430014br.gov.bcb.pix0114063529720001210503***5204000053039865802BR5925TRANSHIPPING AGENCIAMENTO6003VIT62070503***6304504E',
    )
  })

  it('sanitiza txid removendo caracteres não alfanuméricos', () => {
    expect(buildTransshippingPixPayload(0.01, 'AB-CD_12!@#xyz')).toBe(
      '00020126490014br.gov.bcb.pix0114063529720001210509ABCD12xyz52040000530398654040.015802BR5925TRANSHIPPING AGENCIAMENTO6003VIT62130509ABCD12xyz6304B240',
    )
  })

  it('omite o campo 54 para valor negativo', () => {
    const payload = buildTransshippingPixPayload(-10, 'TXID')
    expect(payload).not.toContain('5403')
    expect(payload).not.toContain('54051')
    expect(payload).toContain('5802BR')
  })

  it('trunca o nome do beneficiário em 25 caracteres', () => {
    const payload = buildTransshippingPixPayload(1, 'TXID')
    expect(payload).toContain('5925TRANSHIPPING AGENCIAMENTO')
    expect(payload).not.toContain('MARITIMO')
  })

  it('limita o txid a 35 caracteres', () => {
    const longTxid = 'A'.repeat(50)
    const payload = buildTransshippingPixPayload(1, longTxid)
    expect(payload).toContain('0535' + 'A'.repeat(35))
    expect(payload).not.toContain('A'.repeat(36))
  })

  it('termina com CRC16 de 4 dígitos hex maiúsculos após o id 6304', () => {
    const payload = buildTransshippingPixPayload(99.9, 'XYZ')
    expect(payload).toMatch(/6304[0-9A-F]{4}$/)
  })
})
