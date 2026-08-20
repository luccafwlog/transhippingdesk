import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/317_review_customer_group_onboarding.sql')

describe('migration de onboarding da revisão por cliente', () => {
  it('declara o helper idempotente, a RPC transacional e o wrapper de importação', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.ensure_customer_contact_email/i)
    expect(sql).toMatch(/ON CONFLICT|NOT EXISTS/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_review_customer_group/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/compute_bl_review_pendencies/i)
    expect(sql).toMatch(/REVOKE ALL[\s\S]*complete_review_customer_group/i)
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/i)
    expect(sql).toMatch(/import_bl_freight_transactional_legacy_284/i)
    expect(sql).toMatch(/manifest_customer_email/i)
    expect(sql).toMatch(/concat_ws\(\s*E'\\n'/i)
    expect(sql).toMatch(/regexp_matches\([\s\S]*'gi'/i)
    expect(sql).toMatch(/ORDER BY b\.id[\s\S]*FOR UPDATE/i)
    expect(sql).not.toMatch(/O B\/L % não pertence ao nome do grupo informado/i)
  })

  it('recalcula o gate depois de adicionar o e-mail importado', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/ensure_customer_contact_email[\s\S]*apply_bl_review_gate_after_import[\s\S]*sync_customer_reconciliation_queue_for_bl/i)
  })

  it('mantém a limpeza do motivo de vínculo por nome na camada de importação', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/import_bl_freight_transactional_legacy_284/i)
  })
})
