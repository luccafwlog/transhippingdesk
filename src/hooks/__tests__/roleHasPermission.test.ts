import { describe, expect, it } from 'vitest'
import { roleHasPermission, type Permission } from '../useAuth'

const ALL: Permission[] = [
  'admin_panel', 'manage_users', 'charge_tables', 'charge_overrides',
  'demurrage_edit', 'faturamento_edit', 'reconciliacao_edit', 'voyages_edit',
  'manifests_upload', 'customers_edit', 'portal_provisioning',
]

describe('matriz RBAC do modelo de quatro perfis', () => {
  it('administrativo tem tudo', () => {
    for (const permission of ALL) expect(roleHasPermission('administrativo', permission)).toBe(true)
  })

  it('financeiro só concilia pagamentos', () => {
    for (const permission of ALL) {
      expect(roleHasPermission('financeiro', permission)).toBe(permission === 'reconciliacao_edit')
    }
  })

  it('operacoes atua somente em viagens', () => {
    for (const permission of ALL) {
      expect(roleHasPermission('operacoes', permission)).toBe(permission === 'voyages_edit')
    }
  })

  it('documentacao faz ações de negócio exceto conciliação e administração', () => {
    const allowed: Permission[] = [
      'charge_tables', 'charge_overrides', 'demurrage_edit', 'faturamento_edit',
      'voyages_edit', 'manifests_upload', 'customers_edit', 'portal_provisioning',
    ]
    for (const permission of ALL) expect(roleHasPermission('documentacao', permission)).toBe(allowed.includes(permission))
  })

  it('mapeia os papéis legados', () => {
    expect(roleHasPermission('admin', 'manage_users')).toBe(true)
    expect(roleHasPermission('operator', 'portal_provisioning')).toBe(true)
    expect(roleHasPermission('operator', 'reconciliacao_edit')).toBe(false)
  })
})
