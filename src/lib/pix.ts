// Port verbatim from DM billing.js — PIX EMV (BR Code) payload builder

function pixCRC16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

function pixTLV(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value
}

function buildPixPayload(chavePix: string, nomeBeneficiario: string, cidade: string, valor: number, txid: string): string {
  const nome = nomeBeneficiario.substring(0, 25).replace(/[^A-Za-z0-9 ]/g, '').trim()
  const cid = cidade.substring(0, 15).replace(/[^A-Za-z0-9 ]/g, '').trim()
  const chave = chavePix.replace(/[^0-9]/g, '')
  const tid = (txid || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 35) || '***'

  const merchantAccountInfo = pixTLV('00', 'br.gov.bcb.pix') + pixTLV('01', chave) + pixTLV('05', tid)

  const valorStr = valor > 0 ? valor.toFixed(2) : ''

  const payload =
    pixTLV('00', '01') +
    pixTLV('26', merchantAccountInfo) +
    pixTLV('52', '0000') +
    pixTLV('53', '986') +
    (valorStr ? pixTLV('54', valorStr) : '') +
    pixTLV('58', 'BR') +
    pixTLV('59', nome) +
    pixTLV('60', cid) +
    pixTLV('62', pixTLV('05', tid)) +
    '6304'

  return payload + pixCRC16(payload)
}

// Baked-in Transhipping constants
const PIX_CNPJ = '06352972000121'
const PIX_MERCHANT = 'TRANSHIPPING AGENCIAMENTO MARITIMO'
const PIX_CITY = 'VIT'

export function buildTransshippingPixPayload(valorBRL: number, txid: string): string {
  return buildPixPayload(PIX_CNPJ, PIX_MERCHANT, PIX_CITY, valorBRL, txid)
}
