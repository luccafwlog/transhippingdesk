import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/196_portal_provisioning_console_read_model.sql'), 'utf8')

describe('read model seguro do console de provisionamento', () => {
  it('protege a RPC e separa projeções por perfil', () => {
    expect(sql).toMatch(/portal_list_provisioning_console/i)
    expect(sql).toMatch(/SECURITY DEFINER SET search_path TO 'public', 'pg_temp'/i)
    expect(sql).toContain("v_role IN ('administrativo','documentacao','financeiro')")
    expect(sql).toMatch(/CASE WHEN v_full_access THEN a\.recovery_email ELSE NULL END/i)
    expect(sql).toMatch(/portal_list_provisioning_events[\s\S]*permission denied/i)
    expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM PUBLIC/i)
  })
})
