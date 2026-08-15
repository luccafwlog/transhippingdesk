import { describe, expect, it } from 'vitest'
import { findReusableRecoveryInvite, resolveEmailChangeConfirmation } from '../../../supabase/functions/_shared/portalInvites.ts'
import { createFakePortalDb, opArgs, type FakeCall } from './fakePortalDb'

const NOW = Date.parse('2026-08-14T12:00:00.000Z')
const TOKEN_HASH = 'hash-do-token'

function pendingInvite(overrides: Record<string, unknown> = {}) {
  return { id: 9, account_id: 4, status: 'pendente', expires_at: new Date(NOW + 3_600_000).toISOString(), ...overrides }
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 4, customer_id: 7, auth_user_id: 'uuid-do-cliente',
    pending_recovery_email: 'novo@example.com',
    provisioning_decision: 'aprovado_para_provisionar', account_situation: 'ativo',
    ...overrides,
  }
}

describe('confirmação da troca de Email de Recuperação', () => {
  it('aplica a troca quando há pedido pendente, consumindo o convite de forma condicional', async () => {
    const { db, calls } = createFakePortalDb({
      resolve: (call) => {
        if (call.table === 'portal_invites' && call.ops[0].op === 'select') return pendingInvite()
        if (call.table === 'customer_portal_accounts') return account()
        return { id: 9 }
      },
    })

    const result = await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)

    expect(result).toMatchObject({ outcome: 'aplicar', inviteId: 9 })
    const consume = calls.find((call): call is FakeCall => call.table === 'portal_invites' && call.ops[0].op === 'update')
    expect(consume).toBeDefined()
    // O ponto de serialização continua sendo o update condicional: só um
    // chamador vence a corrida, e o perdedor não queima nada.
    expect(consume?.ops.some((entry) => entry.op === 'eq' && entry.args[0] === 'status' && entry.args[1] === 'pendente')).toBe(true)
  })

  // Achado C: a ordem antiga queimava o convite no passo 2 para descobrir no
  // passo 3 que não havia nada a aplicar, e devolvia "link inválido" — mentira,
  // porque o link estava válido e quem o destruiu foi a própria chamada.
  it('não consome o convite quando não há pedido de troca pendente', async () => {
    const { db, calls } = createFakePortalDb({
      resolve: (call) => {
        if (call.table === 'portal_invites') return pendingInvite()
        return account({ pending_recovery_email: null })
      },
    })

    const result = await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)

    expect(result).toEqual({ outcome: 'pedido_ja_resolvido' })
    expect(calls.some((call) => call.table === 'portal_invites' && call.ops[0].op === 'update')).toBe(false)
  })

  it('recusa token desconhecido sem tocar na conta', async () => {
    const { db, calls } = createFakePortalDb({ resolve: () => null })
    expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)).toEqual({ outcome: 'link_invalido' })
    expect(calls.some((call) => call.table === 'customer_portal_accounts')).toBe(false)
  })

  it('recusa convite encerrado ou vencido enquanto o pedido de troca segue de pé', async () => {
    for (const superado of [pendingInvite({ status: 'invalidado_por_reenvio' }), pendingInvite({ expires_at: new Date(NOW - 1).toISOString() })]) {
      const { db, calls } = createFakePortalDb({
        resolve: (call) => (call.table === 'portal_invites' ? superado : account()),
      })
      expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)).toEqual({ outcome: 'link_invalido' })
      expect(calls.some((call) => call.table === 'portal_invites' && call.ops[0].op === 'update')).toBe(false)
    }
  })

  // O 409 era inalcançável justamente no caso que ele descreve: a troca
  // assistida (300) encerra o convite no mesmo UPDATE em que zera o pedido, e
  // exigir `status = 'pendente'` antes de olhar a conta devolvia 410 "link
  // inválido" para um link que estava válido até aquele momento.
  it('devolve "já resolvido" quando o convite foi encerrado pela própria resolução do pedido', async () => {
    for (const encerrado of [pendingInvite({ status: 'invalidado_por_reenvio' }), pendingInvite({ status: 'consumido' }), pendingInvite({ expires_at: new Date(NOW - 1).toISOString() })]) {
      const { db, calls } = createFakePortalDb({
        resolve: (call) => (call.table === 'portal_invites' ? encerrado : account({ pending_recovery_email: null })),
      })
      expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)).toEqual({ outcome: 'pedido_ja_resolvido' })
      expect(calls.some((call) => call.table === 'portal_invites' && call.ops[0].op === 'update')).toBe(false)
    }
  })

  // Quem perdeu a corrida perdeu para quem aplicou a troca: o desfecho dele
  // também é "já foi resolvido", não "o link nunca valeu".
  it('trata a perda da corrida no update condicional como pedido já resolvido', async () => {
    const { db } = createFakePortalDb({
      resolve: (call) => {
        if (call.table === 'portal_invites' && call.ops[0].op === 'select') return pendingInvite()
        if (call.table === 'customer_portal_accounts') return account()
        return null
      },
    })
    expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)).toEqual({ outcome: 'pedido_ja_resolvido' })
  })
})

describe('convite de recuperação reusável', () => {
  const EMAIL = 'contato@example.com'

  function reusableDb(invite: Record<string, unknown> | null, attempt: Record<string, unknown> | null) {
    return createFakePortalDb({
      resolve: (call) => (call.table === 'portal_invites' ? invite : attempt),
    })
  }

  function liveInvite(overrides: Record<string, unknown> = {}) {
    return { id: 12, expires_at: new Date(NOW + 600_000).toISOString(), sent_to_email: EMAIL, created_at: new Date(NOW - 10 * 60_000).toISOString(), ...overrides }
  }

  it('procura por conta, propósito, status pendente e validade futura', async () => {
    const { db, calls } = reusableDb(liveInvite(), { status: 'aceito' })

    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toMatchObject({ id: 12 })

    const filters = calls[0].ops.filter((entry) => entry.op === 'eq').map((entry) => entry.args)
    expect(filters).toEqual([['account_id', 4], ['purpose', 'recuperacao'], ['status', 'pendente']])
    expect(opArgs(calls[0], 'gt')).toEqual(['expires_at', new Date(NOW).toISOString()])
  })

  it('devolve nulo quando não há convite vivo, liberando o envio de um link novo', async () => {
    const { db } = reusableDb(null, null)
    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()
  })

  // Depois de uma troca de endereço, o convite pendente aponta para a caixa
  // anterior: reusá-lo responderia "enviamos" enquanto nada chega ao endereço
  // que o cliente acabou de passar a usar.
  it('não reusa convite endereçado a outro email, e a comparação ignora caixa', async () => {
    const { db } = reusableDb(liveInvite({ sent_to_email: 'antigo@example.com' }), { status: 'aceito' })
    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()

    const { db: outroCaso } = reusableDb(liveInvite({ sent_to_email: 'Contato@Example.com' }), { status: 'aceito' })
    expect(await findReusableRecoveryInvite(outroCaso, 4, EMAIL, NOW)).toMatchObject({ id: 12 })
  })

  // A falha do Resend só vira console.error dentro do waitUntil e o convite
  // fica pendente do mesmo jeito; tratar pendente como enviado transformava
  // uma indisponibilidade passageira em uma hora sem recuperação de senha.
  it('não reusa convite cujo envio falhou', async () => {
    for (const status of ['falha_transitoria', 'falha_permanente']) {
      const { db, calls } = reusableDb(liveInvite(), { status })
      expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()
      expect(opArgs(calls[1], 'eq')).toEqual(['idempotency_key', 'recuperacao:12'])
    }
  })

  it('reusa convite cujo envio saiu ou foi entregue', async () => {
    for (const status of ['aceito', 'entregue']) {
      const { db } = reusableDb(liveInvite(), { status })
      expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toMatchObject({ id: 12 })
    }
  })

  // Sem tentativa registrada há dois casos: o envio está em voo (o helper roda
  // em waitUntil e grava a tentativa no primeiro passo) ou nunca começou.
  it('segura o duplicado do envio em voo e libera o reenvio depois da janela', async () => {
    const emVoo = reusableDb(liveInvite({ created_at: new Date(NOW - 30_000).toISOString() }), null)
    expect(await findReusableRecoveryInvite(emVoo.db, 4, EMAIL, NOW)).toMatchObject({ id: 12 })

    const antigo = reusableDb(liveInvite({ created_at: new Date(NOW - 30 * 60_000).toISOString() }), null)
    expect(await findReusableRecoveryInvite(antigo.db, 4, EMAIL, NOW)).toBeNull()
  })
})
