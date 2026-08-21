import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/327_bloco_522_final_guards.sql'), 'utf8')

describe('migracao forward final do bloco 522', () => {
  it('fecha PIX somente com TXID canonico, invoice local elegivel e baixa autoritativa', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_pix_reconciliation_exception')
    expect(migration).toContain('v_normalized_txid IS DISTINCT FROM v_exception.normalized_txid')
    expect(migration).toContain("i.invoice_type IN ('individual', 'consolidated')")
    expect(migration).toContain('get_demurrage_recent_values')
    expect(migration).toContain('v_exception.paid_at')
    expect(migration).toContain("resolution_source = p_resolution_source")
  })

  it('oferece vinculo manual sem fechar a pendencia e reabre em reversao', () => {
    expect(migration).toContain('link_pix_reconciliation_candidate')
    expect(migration).toContain('list_pix_reconciliation_candidates')
    expect(migration).toContain("status = 'active'")
    expect(migration).toContain('reopen_pix_reconciliation_exception')
    expect(migration).toContain('ledger_settlements')
    expect(migration).toContain('CREATE TRIGGER reopen_pix_exception')
  })

  it('nao inventa fallback de disputa sem fonte explicita de proxima acao', () => {
    expect(migration).toContain('demurrage_disputes')
    expect(migration).toContain('to_regclass')
    expect(migration).toContain("COALESCE(lower(trim(p_next_responder)), '') = 'equipamentos'")
    expect(migration).toContain('next_action_source_unavailable')
    expect(migration).toContain('CREATE TRIGGER sync_demurrage_dispute_source_alert')
  })
})
