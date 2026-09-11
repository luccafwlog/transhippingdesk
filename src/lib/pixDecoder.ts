export type PixDecodedField = {
  id: string
  value: string
  children?: PixDecodedField[]
}

export type DecodedStaticPixPayload = {
  fields: PixDecodedField[]
  payloadFormatIndicator: string
  merchantAccount: {
    gui: string
    pixKey: string
    infoAdicional: string | null
    fss: string | null
  }
  amount: string | null
  merchantName: string
  merchantCity: string
  txid: string
  crc: string
}

function fail(message: string): never {
  throw new Error(`BR Code inválido: ${message}`)
}

function parseFields(value: string, context: string): PixDecodedField[] {
  const fields: PixDecodedField[] = []
  const seen = new Set<string>()
  let offset = 0

  while (offset < value.length) {
    if (offset + 4 > value.length) fail(`${context} termina com um cabeçalho TLV incompleto.`)

    const id = value.slice(offset, offset + 2)
    const sizeText = value.slice(offset + 2, offset + 4)
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(sizeText)) {
      fail(`${context} contém um ID ou tamanho TLV inválido.`)
    }
    if (seen.has(id)) fail(`${context} contém o ID duplicado ${id}.`)
    seen.add(id)

    const size = Number(sizeText)
    const start = offset + 4
    const end = start + size
    if (end > value.length) fail(`${context} declara tamanho maior que o valor disponível.`)

    fields.push({ id, value: value.slice(start, end) })
    offset = end
  }

  return fields
}

function requiredField(fields: readonly PixDecodedField[], id: string, context: string): PixDecodedField {
  const field = fields.find((candidate) => candidate.id === id)
  if (!field) fail(`${context} não contém o campo obrigatório ${id}.`)
  return field
}

function childFields(field: PixDecodedField, context: string): PixDecodedField[] {
  const children = parseFields(field.value, context)
  field.children = children
  return children
}

function crc16CcittFalse(value: string): string {
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

function boundedText(value: string, field: string, max: number): string {
  if (value.length < 1 || value.length > max) fail(`${field} deve ter entre 1 e ${max} caracteres.`)
  return value
}

/**
 * Decodifica o subconjunto de QR Code estático Pix que o sistema emite.
 *
 * O parser mantém a sua própria leitura TLV e CRC; ele não reutiliza o
 * builder para validar o próprio output. Assim, os vetores oficiais e o SQL
 * podem detectar uma árvore 26/62 incorreta mesmo quando o builder é alterado.
 */
export function decodeStaticPixPayload(payload: string): DecodedStaticPixPayload {
  if (!payload || !/^[\x20-\x7E]+$/.test(payload)) {
    fail('o payload deve conter somente bytes ASCII imprimíveis.')
  }

  const fields = parseFields(payload, 'raiz')
  const crcField = requiredField(fields, '63', 'raiz')
  if (fields.at(-1) !== crcField) fail('o campo CRC 63 deve ser o último campo.')
  if (!/^[0-9A-Fa-f]{4}$/.test(crcField.value)) fail('o campo CRC 63 deve conter quatro hexadecimais.')

  const crcInput = payload.slice(0, -4)
  const expectedCrc = crc16CcittFalse(crcInput)
  const actualCrc = crcField.value.toUpperCase()
  if (actualCrc !== expectedCrc) fail(`CRC divergente: esperado ${expectedCrc}, recebido ${actualCrc}.`)

  const payloadFormatIndicator = requiredField(fields, '00', 'raiz').value
  if (payloadFormatIndicator !== '01') fail('o Payload Format Indicator deve ser 01.')

  const merchantAccount = fields.find((field) => field.id === '26')
  if (!merchantAccount) fail('o QR Code Pix deve conter o Merchant Account Information 26.')
  const merchantAccountChildren = childFields(merchantAccount, 'Merchant Account Information 26')
  const gui = requiredField(merchantAccountChildren, '00', 'Merchant Account Information 26').value
  if (gui.toLowerCase() !== 'br.gov.bcb.pix') fail('o GUI Pix deve ser br.gov.bcb.pix.')
  const pixKey = boundedText(requiredField(merchantAccountChildren, '01', 'Merchant Account Information 26').value, 'a chave Pix', 77)
  const infoAdicional = merchantAccountChildren.find((field) => field.id === '02')?.value ?? null
  if (infoAdicional !== null) boundedText(infoAdicional, 'infoAdicional', 72)
  const fss = merchantAccountChildren.find((field) => field.id === '03')?.value ?? null
  if (fss !== null && !/^\d{8}$/.test(fss)) fail('o FSS deve conter oito dígitos.')
  const unsupportedMerchantChildren = merchantAccountChildren.filter((field) => !['00', '01', '02', '03'].includes(field.id))
  if (unsupportedMerchantChildren.length > 0) fail('o Merchant Account Information contém campo Pix não previsto.')

  const merchantCategory = requiredField(fields, '52', 'raiz').value
  if (!/^\d{4}$/.test(merchantCategory)) fail('o Merchant Category Code deve conter quatro dígitos.')
  if (requiredField(fields, '53', 'raiz').value !== '986') fail('a moeda do QR Code Pix deve ser 986.')

  const amountField = fields.find((field) => field.id === '54')
  const amount = amountField?.value ?? null
  if (amount !== null && !/^\d{1,10}(?:\.\d{2})?$/.test(amount)) {
    fail('o valor 54 deve ser decimal sem expoente e ter no máximo 13 caracteres.')
  }
  if (requiredField(fields, '58', 'raiz').value !== 'BR') fail('o país do QR Code Pix deve ser BR.')
  const merchantName = boundedText(requiredField(fields, '59', 'raiz').value, 'o Merchant Name', 25)
  const merchantCity = boundedText(requiredField(fields, '60', 'raiz').value, 'o Merchant City', 15)

  const additionalData = requiredField(fields, '62', 'raiz')
  const additionalChildren = childFields(additionalData, 'Additional Data Field 62')
  const txid = boundedText(requiredField(additionalChildren, '05', 'Additional Data Field 62').value, 'o txid 62-05', 25)
  if (txid !== '***' && !/^[A-Za-z0-9]+$/.test(txid)) fail('o txid 62-05 deve ser alfanumérico ou ***.')

  return {
    fields,
    payloadFormatIndicator,
    merchantAccount: { gui, pixKey, infoAdicional, fss },
    amount,
    merchantName,
    merchantCity,
    txid,
    crc: actualCrc,
  }
}
