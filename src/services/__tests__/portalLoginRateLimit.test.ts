import { describe, expect, it } from 'vitest'
import { isLoginRateLimited, registerLoginFailure, registerLoginSuccess } from '../../../supabase/functions/_shared/portalLoginRateLimit.ts'
import { createFakePortalDb } from './fakePortalDb'

describe('trava de tentativas do login do Portal', () => {
  it('bloqueia quando a RPC responde true', async () => {
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: true }) })
    expect(await isLoginRateLimited(db, '12ABC34501DE35')).toBe(true)
    expect(rpcCalls).toEqual([{ name: 'portal_login_check_rate_limit', params: { p_login: '12ABC34501DE35' } }])
  })

  it('libera quando a RPC responde false', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ data: false }) })
    expect(await isLoginRateLimited(db, '12345678000195')).toBe(false)
  })

  // Sem resposta do contador não há como saber se o orçamento acabou; liberar
  // nesse caso transformaria indisponibilidade do banco em janela sem trava.
  it('trata falha da RPC como bloqueio', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ error: new Error('indisponível') }) })
    expect(await isLoginRateLimited(db, '12345678000195')).toBe(true)
  })

  it('registra falha e sucesso no contador do login, não num terceiro balde', async () => {
    const { db, rpcCalls } = createFakePortalDb()
    await registerLoginFailure(db, '12345678000195')
    await registerLoginSuccess(db, '12345678000195')
    expect(rpcCalls.map((call) => call.name)).toEqual(['portal_login_register_failure', 'portal_login_register_success'])
    expect(rpcCalls.every((call) => call.params?.p_login === '12345678000195')).toBe(true)
  })
})
