// Regra única de senha do sistema interno e do Portal.
// A Edge Function repete esta regra em Deno, que não importa o bundle do Vite —
// mesma convenção do maskEmail em supabase/functions/_shared/portalEmail.ts.
export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_RULE_MESSAGE =
  'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula e número.'

export function isValidPassword(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
}
