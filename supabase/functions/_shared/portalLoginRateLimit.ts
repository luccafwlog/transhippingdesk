import type { PortalDb } from './portalDb.ts'

// Contador de tentativas do LOGIN do Portal, chaveado pelo CNPJ (ADR 0049).
//
// A verificação da senha atual na troca de Email de Recuperação passa por aqui
// de propósito, em vez de ganhar um balde próprio: um terceiro balde faria
// daquele caminho uma porta paralela à trava do login, que é exatamente o que
// se quer fechar. É a mesma senha e o mesmo alvo, então é o mesmo orçamento de
// tentativas.
//
// Falha da RPC conta como bloqueio: sem resposta do contador não há como saber
// se o orçamento acabou, e liberar a verificação nesse caso transformaria uma
// indisponibilidade do banco em janela sem trava.
export async function isLoginRateLimited(db: PortalDb, loginCnpj: string): Promise<boolean> {
  const { data, error } = await db.rpc('portal_login_check_rate_limit', { p_login: loginCnpj })
  return Boolean(error) || data === true
}

export async function registerLoginFailure(db: PortalDb, loginCnpj: string): Promise<void> {
  await db.rpc('portal_login_register_failure', { p_login: loginCnpj })
}

export async function registerLoginSuccess(db: PortalDb, loginCnpj: string): Promise<void> {
  await db.rpc('portal_login_register_success', { p_login: loginCnpj })
}
