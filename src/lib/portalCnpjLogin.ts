import { normalizeCnpj } from './cnpj'

export const INCOMPLETE_CNPJ_MESSAGE = 'Informe o CNPJ completo, com 14 caracteres.'

// Login do Portal aceita CNPJ numérico e alfanumérico, e a base real contém
// contas cujo login não fecha o dígito verificador (filiais e cargas
// importadas). Por isso a validação de tela cobre só o COMPRIMENTO: é o que
// distingue "digitou pela metade" de "digitou outro CNPJ", sem reprovar conta
// legítima. Se o CNPJ existe ou não, quem responde é o servidor — e ele
// responde igual para todos.
// ponytail: teto conhecido — não checa dígito verificador. O upgrade só é
// possível depois de normalizar `customer_portal_accounts.login_cnpj`, hoje com
// metade dos registros reprovando em `isValidCnpj`.
export function isCompleteCnpjLogin(value: string): boolean {
  return normalizeCnpj(value).length === 14
}
