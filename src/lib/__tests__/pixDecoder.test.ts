import { describe, expect, it } from 'vitest'
import { decodeStaticPixPayload } from '../pixDecoder'

const OFFICIAL_STATIC_VECTOR = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D'

function crc16(value: string): string {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function vectorWithTxid(txid: string): string {
  const rootBeforeAdditionalData = OFFICIAL_STATIC_VECTOR.slice(0, OFFICIAL_STATIC_VECTOR.indexOf('6207'))
  const additionalData = `62${String(4 + txid.length).padStart(2, '0')}05${String(txid.length).padStart(2, '0')}${txid}`
  const withoutCrc = `${rootBeforeAdditionalData}${additionalData}6304`
  return `${withoutCrc}${crc16(withoutCrc)}`
}

describe('decoder independente de BR Code/Pix estático', () => {
  it('decodifica o vetor oficial do Manual Pix 2.10.0 e valida o CRC', () => {
    const decoded = decodeStaticPixPayload(OFFICIAL_STATIC_VECTOR)

    expect(decoded.payloadFormatIndicator).toBe('01')
    expect(decoded.merchantAccount.gui).toBe('br.gov.bcb.pix')
    expect(decoded.merchantAccount.pixKey).toBe('123e4567-e12b-12d1-a456-426655440000')
    expect(decoded.amount).toBeNull()
    expect(decoded.merchantName).toBe('Fulano de Tal')
    expect(decoded.merchantCity).toBe('BRASILIA')
    expect(decoded.txid).toBe('***')
    expect(decoded.crc).toBe('1D3D')
  })

  it('recusa CRC adulterado e campos fora do lugar', () => {
    expect(() => decodeStaticPixPayload(`${OFFICIAL_STATIC_VECTOR.slice(0, -1)}0`)).toThrow(/CRC/i)

    const invalidMerchantAccount = OFFICIAL_STATIC_VECTOR.replace(
      '26580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000',
      '26680014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400000508TESTTXID',
    )
    expect(() => decodeStaticPixPayload(invalidMerchantAccount)).toThrow(/Merchant Account|campo|TLV/i)
  })

  it('exige txid alfanumérico ou *** e limite de 25 caracteres', () => {
    const invalidTxid = vectorWithTxid('A-B12')
    expect(() => decodeStaticPixPayload(invalidTxid)).toThrow(/txid|Reference Label/i)

    const longTxid = vectorWithTxid('A'.repeat(26))
    expect(() => decodeStaticPixPayload(longTxid)).toThrow(/txid|Reference Label/i)
  })
})
