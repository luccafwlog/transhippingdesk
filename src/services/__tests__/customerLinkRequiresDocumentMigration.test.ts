import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () => readFileSync(resolve(process.cwd(), 'supabase/migrations/284_customer_link_requires_document.sql'), 'utf8')

describe('migration 284: sugestao separada do vinculo de B/L', () => {
  it('declara a coluna e a FK nomeada da sugestao', () => {
    const sql = readMigration()
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS suggested_customer_id BIGINT/i)
    expect(sql).toMatch(/CONSTRAINT bls_suggested_customer_id_fkey\s+FOREIGN KEY \(suggested_customer_id\)/i)
  })

  it('preserva a sugestao na fila e no import sem a nota textual antiga', () => {
    const sql = readMigration()
    expect(sql).toMatch(/COALESCE\(v_bl\.customer_id, v_bl\.suggested_customer_id\)/i)
    expect(sql).toMatch(/suggested_customer_id/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.import_bl_freight_transactional/i)
    expect(sql).not.toMatch(/Cliente vinculado por nome; validar CNPJ/i)
    expect(sql).toMatch(/customer_reconciliation_status IN \('matched_document', 'reconciled'\)/i)
  })

  it('limpa a sugestao quando a fila e aprovada manualmente', () => {
    expect(readMigration()).toMatch(/suggested_customer_id\s*=\s*NULL[\s\S]+customer_reconciliation_status\s*=\s*'reconciled'/i)
  })

  it('mantem a fila interna e os delegates legados fora do PostgREST', () => {
    const sql = readMigration()
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sync_customer_reconciliation_queue_for_bl\(TEXT\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.sync_customer_reconciliation_queue_for_bl/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.import_bl_freight_transactional_legacy_205\(jsonb, uuid\) FROM PUBLIC, anon, authenticated/i)
  })
})
