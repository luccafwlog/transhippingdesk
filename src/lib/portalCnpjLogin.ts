import { canonicalizeDocument } from './cnpj'

export const INCOMPLETE_CNPJ_MESSAGE = 'Informe o CNPJ completo, com 14 caracteres.'

// Login do Portal aceita CNPJ numérico e alfanumérico. A validação de tela
// cobre só o COMPRIMENTO: é o que distingue "digitou pela metade" de "digitou
// outro CNPJ", e é decidível offline, sem revelar nada sobre a base. Se o CNPJ
// existe ou não, quem responde é o servidor — e ele responde igual para todos.
//
// ponytail: teto conhecido — não checa dígito verificador, embora
// `isValidCnpj` exista e siga a regra da Receita (numérico e alfanumérico).
// O motivo é de dados, não de regra: `customer_portal_accounts.login_cnpj` é
// cópia literal de `customers.cnpj_cpf`, e o cadastro atual ainda carrega
// documentos que não fecham DV, remanescentes de teste. O upgrade para
// `isValidCnpj` fica liberado quando o cadastro estiver limpo — a partir daí
// nenhum documento inválido entra, porque `createCustomer` já barra.
export function isCompleteCnpjLogin(value: string): boolean {
  return canonicalizeDocument(value).length === 14
}
