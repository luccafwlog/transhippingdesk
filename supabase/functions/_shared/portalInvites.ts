import type { PortalDb } from './portalDb.ts'

export type LiveInvite = { id: number; expires_at: string }

// Convite de recuperação ainda pendente e dentro da validade.
//
// Cada pedido de recuperação invalidava o convite anterior e criava outro,
// disparando um email. Como o CNPJ é público e a função é necessariamente
// pública (`verify_jwt = false`), um terceiro fazia o sistema enviar até 480
// emails por dia à caixa de recuperação de um cliente real. E o cliente que
// pediu o link, foi lê-lo e clicou podia encontrá-lo cancelado por um pedido
// que não era dele. Havendo link vivo, o pedido novo reusa em vez de reenviar.
export async function findLiveRecoveryInvite(db: PortalDb, accountId: number, nowIso: string): Promise<LiveInvite | null> {
  const { data } = await db
    .from('portal_invites')
    .select('id, expires_at')
    .eq('account_id', accountId)
    .eq('purpose', 'recuperacao')
    .eq('status', 'pendente')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { id: Number(data.id), expires_at: String(data.expires_at) }
}

export type EmailChangeAccount = {
  id: number
  customer_id: number
  auth_user_id: string | null
  pending_recovery_email: string
  provisioning_decision: string | null
  account_situation: string | null
}

export type EmailChangeConfirmation =
  | { outcome: 'link_invalido' }
  | { outcome: 'pedido_ja_resolvido' }
  | { outcome: 'aplicar'; inviteId: number; account: EmailChangeAccount }

// Ordem do `confirm`: LER a conta antes de queimar o convite.
//
// Antes, a sequência era validar o convite → marcar como consumido → ler a
// conta → devolver 410 se `pending_recovery_email` fosse nulo. O convite era
// destruído no passo 2 para se descobrir no passo 3 que não havia nada a
// aplicar, e a mensagem devolvida ("Link inválido ou expirado") era falsa: o
// link estava válido, quem o destruiu foi a própria chamada. O caminho que
// produzia isso é a troca assistida, que zera `pending_recovery_email` — a
// migration 300 passou a encerrar o convite junto, e esta ordem cobre os links
// que já estavam em trânsito.
//
// A proteção contra confirmação dupla continua vindo do UPDATE condicional
// (`status = 'pendente'`), que é o ponto de serialização real: só um chamador
// vence, e o perdedor não queima nada.
export async function resolveEmailChangeConfirmation(db: PortalDb, tokenHash: string, now: number): Promise<EmailChangeConfirmation> {
  const { data: invite } = await db
    .from('portal_invites')
    .select('id, account_id, expires_at, status')
    .eq('token_hash', tokenHash)
    .eq('purpose', 'confirmacao_email')
    .maybeSingle()
  if (!invite || invite.status !== 'pendente' || new Date(String(invite.expires_at)).getTime() <= now) return { outcome: 'link_invalido' }

  const { data: account } = await db
    .from('customer_portal_accounts')
    .select('id, customer_id, auth_user_id, pending_recovery_email, provisioning_decision, account_situation')
    .eq('id', invite.account_id)
    .maybeSingle()
  if (!account?.pending_recovery_email) return { outcome: 'pedido_ja_resolvido' }

  const { data: consumed } = await db
    .from('portal_invites')
    .update({ status: 'consumido', consumed_at: new Date(now).toISOString() })
    .eq('id', invite.id)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle()
  if (!consumed) return { outcome: 'link_invalido' }

  return {
    outcome: 'aplicar',
    inviteId: Number(invite.id),
    account: {
      id: Number(account.id),
      customer_id: Number(account.customer_id),
      auth_user_id: account.auth_user_id === null || account.auth_user_id === undefined ? null : String(account.auth_user_id),
      pending_recovery_email: String(account.pending_recovery_email),
      provisioning_decision: account.provisioning_decision === null || account.provisioning_decision === undefined ? null : String(account.provisioning_decision),
      account_situation: account.account_situation === null || account.account_situation === undefined ? null : String(account.account_situation),
    },
  }
}
