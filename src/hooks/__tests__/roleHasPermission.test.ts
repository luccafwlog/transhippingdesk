import { describe, expect, it } from 'vitest'
import { roleHasPermission, type Permission } from '../useAuth'

const ALL: Permission[] = ['admin_panel', 'manage_users', 'portal_provisioning', 'settle_financial_adjustments']
const NAVIGATION: Permission[] = ['admin_panel', 'manage_users', 'portal_provisioning']

describe('matriz RBAC de exceções', () => {
  it('Administrativo mantém painel, usuários e provisionamento', () => {
    for (const permission of ALL) expect(roleHasPermission('administrativo', permission)).toBe(true)
  })
  it('Documentação mantém apenas provisionamento do Portal', () => {
    expect(roleHasPermission('documentacao', 'portal_provisioning')).toBe(true)
    expect(roleHasPermission('documentacao', 'admin_panel')).toBe(false)
    expect(roleHasPermission('documentacao', 'manage_users')).toBe(false)
  })
  it('Administrativo e Financeiro podem liquidar ajustes financeiros', () => {
    expect(roleHasPermission('administrativo', 'settle_financial_adjustments')).toBe(true)
    expect(roleHasPermission('financeiro', 'settle_financial_adjustments')).toBe(true)
  })
  it('os demais departamentos não recebem exceções de navegação', () => {
    for (const role of ['financeiro', 'operacoes', 'equipamentos'] as const) {
      for (const permission of NAVIGATION) expect(roleHasPermission(role, permission)).toBe(false)
    }
  })
  it('mapeia os papéis legados', () => {
    expect(roleHasPermission('admin', 'manage_users')).toBe(true)
    expect(roleHasPermission('operator', 'portal_provisioning')).toBe(true)
  })
})
