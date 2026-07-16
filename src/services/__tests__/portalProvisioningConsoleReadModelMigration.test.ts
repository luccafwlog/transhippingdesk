import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/196_portal_provisioning_console_read_model.sql'), 'utf8')
const sql197 = readFileSync(resolve(process.cwd(), 'supabase/migrations/197_portal_provisioning_console_fixes.sql'), 'utf8')

describe('read model seguro do console de provisionamento', () => {
  it('protege a RPC e separa projeções por perfil', () => {
    expect(sql).toMatch(/portal_list_provisioning_console/i)
    expect(sql).toMatch(/SECURITY DEFINER SET search_path TO 'public', 'pg_temp'/i)
    expect(sql).toContain("v_role IN ('administrativo','documentacao','financeiro')")
    expect(sql).toMatch(/CASE WHEN v_full_access THEN a\.recovery_email ELSE NULL END/i)
    expect(sql).toMatch(/portal_list_provisioning_events[\s\S]*permission denied/i)
    expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM PUBLIC/i)
  })
  it('197 corrige o cast de entity_id e trata financial_status nulo', () => {
    expect(sql197).toMatch(/invoice_number = al\.entity_id/i)
    expect(sql197).toMatch(/CASE WHEN al\.entity_id ~ '\^\[0-9\]\+\$' THEN al\.entity_id::bigint END/)
    expect(sql197).toMatch(/IS DISTINCT FROM 'cancelled'/i)
    expect(sql197).not.toMatch(/al\.entity_id::bigint AND/i)
  })
})
