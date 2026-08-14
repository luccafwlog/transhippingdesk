import { describe, expect, it } from 'vitest'
import { findLiveRecoveryInvite, resolveEmailChangeConfirmation } from '../../../supabase/functions/_shared/portalInvites.ts'
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

  it('recusa convite consumido, cancelado ou vencido sem tocar na conta', async () => {
    for (const invalid of [pendingInvite({ status: 'consumido' }), pendingInvite({ expires_at: new Date(NOW - 1).toISOString() }), null]) {
      const { db, calls } = createFakePortalDb({ resolve: () => invalid })
      expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)).toEqual({ outcome: 'link_invalido' })
      expect(calls.some((call) => call.table === 'customer_portal_accounts')).toBe(false)
    }
  })

  it('trata a perda da corrida no update condicional como link inválido', async () => {
    const { db } = createFakePortalDb({
      resolve: (call) => {
        if (call.table === 'portal_invites' && call.ops[0].op === 'select') return pendingInvite()
        if (call.table === 'customer_portal_accounts') return account()
        return null
      },
    })
    expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH, NOW)).toEqual({ outcome: 'link_invalido' })
  })
})

describe('convite de recuperação ainda vivo', () => {
  it('procura por conta, propósito, status pendente e validade futura', async () => {
    const nowIso = new Date(NOW).toISOString()
    const { db, calls } = createFakePortalDb({ resolve: () => ({ id: 12, expires_at: new Date(NOW + 600_000).toISOString() }) })

    expect(await findLiveRecoveryInvite(db, 4, nowIso)).toMatchObject({ id: 12 })

    const filters = calls[0].ops.filter((entry) => entry.op === 'eq').map((entry) => entry.args)
    expect(filters).toEqual([['account_id', 4], ['purpose', 'recuperacao'], ['status', 'pendente']])
    expect(opArgs(calls[0], 'gt')).toEqual(['expires_at', nowIso])
  })

  it('devolve nulo quando não há convite vivo, liberando o envio de um link novo', async () => {
    const { db } = createFakePortalDb({ resolve: () => null })
    expect(await findLiveRecoveryInvite(db, 4, new Date(NOW).toISOString())).toBeNull()
  })
})
