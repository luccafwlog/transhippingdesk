import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/215_rbac_voyages_customers_writes.sql', 'utf8')

function fnBody(name: string) {
  return sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$(?:function\\$|\\$);`, 'i'))?.[0] ?? ''
}

describe('208_rbac_voyages_customers_writes', () => {
  it('define can_edit_voyages e can_edit_customers espelhando roleHasPermission', () => {
    const voyages = fnBody('can_edit_voyages\\(\\)')
    expect(voyages).toMatch(/role IN \('admin', 'administrativo', 'operator', 'documentacao', 'operacoes'\)/)
    expect(voyages).toMatch(/active = true/)

    const customers = fnBody('can_edit_customers\\(\\)')
    expect(customers).toMatch(/role IN \('admin', 'administrativo', 'operator', 'documentacao'\)/)
    expect(customers).not.toMatch(/operacoes/)
  })

  it('set_bl_cod e set_bl_transshipment exigem can_edit_voyages alem do usuario ativo', () => {
    for (const fn of ['set_bl_cod', 'set_bl_transshipment']) {
      const body = fnBody(fn.replace(/_/g, '_'))
      expect(body).toMatch(/public\.is_active_user\(\)/)
      expect(body).toMatch(/IF NOT public\.can_edit_voyages\(\) THEN/)
      expect(body).toMatch(/RAISE EXCEPTION 'Usuario sem permissao para alterar disposicao de B\/L\.' USING ERRCODE = '42501'/)
    }
  })

  it('remove o overload de 5 argumentos de omit_voyage_escala e reaplica o de 10 com bl_id', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.omit_voyage_escala\(BIGINT, TEXT, TEXT, TEXT, UUID\);/)
    const body = fnBody('omit_voyage_escala')
    expect(body).toMatch(/p_onward_vessel_name TEXT DEFAULT NULL/)
    expect(body).toMatch(/p_onward_eta TIMESTAMPTZ DEFAULT NULL/)
    expect(body).toMatch(/INSERT INTO public\.portal_notifications\(customer_id, bl_id, type, title, message, link\)/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.omit_voyage_escala\(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ\) TO authenticated/)
  })

  it('aperta INSERT/UPDATE de customers e customer_contacts para can_edit_customers', () => {
    for (const table of ['customers', 'customer_contacts']) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY ${table}_insert_active ON public\\.${table}\\s*\\n\\s*FOR INSERT TO authenticated WITH CHECK \\(public\\.can_edit_customers\\(\\)\\)`))
      expect(sql).toMatch(new RegExp(`CREATE POLICY ${table}_update_active ON public\\.${table}\\s*\\n\\s*FOR UPDATE TO authenticated USING \\(public\\.can_edit_customers\\(\\)\\) WITH CHECK \\(public\\.can_edit_customers\\(\\)\\)`))
    }
  })

  it('update_customer_with_audit verifica can_edit_customers antes de gravar', () => {
    const body = fnBody('update_customer_with_audit')
    expect(body).toMatch(/IF NOT public\.can_edit_customers\(\) THEN/)
    expect(body).toMatch(/RAISE EXCEPTION 'Usuario sem permissao para editar cliente\.' USING ERRCODE = '42501'/)
  })
})
