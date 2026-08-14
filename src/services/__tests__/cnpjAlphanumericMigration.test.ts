import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/293_cnpj_alfanumerico.sql', 'utf8')

describe('CNPJ alfanumérico migration contract', () => {
  it('canonicalizes and validates both CNPJ formats in the database', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.normalize_cnpj')
    expect(sql).toContain("regexp_replace(p_value, '[^0-9A-Za-z]', '', 'g')")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_valid_cnpj')
    expect(sql).toContain('ascii(substr(v_cnpj, v_index, 1)) - 48')
    expect(sql).toContain('CREATE TRIGGER trg_canonicalize_customer_cnpj')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.portal_create_account_on_customer_insert')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.portal_admin_change_cnpj')
  })
})
