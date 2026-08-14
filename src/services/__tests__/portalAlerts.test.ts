import { describe, expect, it } from 'vitest'
import { openAlertOnce } from '../../../supabase/functions/_shared/portalAlerts.ts'
import { createFakePortalDb } from './fakePortalDb'

const input = {
  type: 'portal_email_suprimido',
  entityType: 'customer',
  entityId: '7',
  message: 'Email de Recuperação indisponível. Informe ou valide outro endereço.',
}

describe('abertura deduplicada de alerta do Portal', () => {
  it('abre o alerta quando não há um aberto para o mesmo tipo e entidade', async () => {
    const { db, calls } = createFakePortalDb({ resolve: (call) => (call.ops[0].op === 'insert' ? { id: 1 } : null) })

    expect(await openAlertOnce(db, input)).toBe('aberto')

    const insert = calls.find((call) => call.ops[0].op === 'insert')
    expect(insert?.ops[0].args[0]).toMatchObject({ type: 'portal_email_suprimido', entity_id: '7', status: 'open' })
  })

  // Achado H: `alerts` não tem restrição de unicidade (migration 001) e o
  // webhook inseria sem checar, então cada bounce do mesmo endereço abria mais
  // um alerta para o mesmo Cliente.
  it('não abre um segundo alerta quando já existe um não fechado', async () => {
    const { db, calls } = createFakePortalDb({ resolve: () => ({ id: 1 }) })

    expect(await openAlertOnce(db, input)).toBe('ja_aberto')
    expect(calls.some((call) => call.ops[0].op === 'insert')).toBe(false)
  })

  it('procura o duplicado por tipo, entidade e alerta ainda não fechado', async () => {
    const { db, calls } = createFakePortalDb({ resolve: () => ({ id: 1 }) })
    await openAlertOnce(db, input)

    const filters = calls[0].ops.filter((entry) => entry.op === 'eq' || entry.op === 'neq')
    expect(filters.map((entry) => entry.args)).toEqual([
      ['type', 'portal_email_suprimido'],
      ['entity_type', 'customer'],
      ['entity_id', '7'],
      ['status', 'closed'],
    ])
    expect(filters[3].op).toBe('neq')
  })
})
