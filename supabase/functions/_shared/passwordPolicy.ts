// Espelha src/lib/passwordPolicy.ts; Deno não importa o bundle Vite — mesma
// convenção do maskEmail em portalEmail.ts. Vale para o usuário interno E para o
// cliente do Portal: a conta do Portal dá acesso a faturas, saldo em aberto,
// B/Ls, containers e payload PIX, então não há motivo para uma regra mais fraca.
// Alterar aqui exige alterar src/lib/passwordPolicy.ts no mesmo commit; o
// contrato está travado por src/lib/__tests__/passwordPolicy.test.ts.
export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_RULE_MESSAGE =
  'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula e número.'

export function isValidPassword(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
}
