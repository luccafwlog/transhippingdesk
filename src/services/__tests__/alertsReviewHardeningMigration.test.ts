import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/338_alerts_review_hardening.sql'), 'utf8')

describe('migration 338 — hardening da revisão de alertas', () => {
  it('fecha audiência, identidade terminalizada, ocorrência por marco e grants server-only', () => {
    expect(migration).toContain('up.role = ANY(v_audience)')
    expect(migration).toContain('voyage_terminal_code(v_term_rec.terminal_id)')
    expect(migration).toContain("v_before.metadata->>'milestone' IS DISTINCT FROM v_metadata->>'milestone'")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.reconcile_voyage_operation_alerts')
    expect(migration).toContain("entity_type = 'voyage_pod_schedule'")
  })

  it('declara o teto de granularidade documental dos manifests', () => {
    expect(migration).toContain('a pendência deve existir uma vez por escala')
    expect(migration).toContain("'voyage_export_after_atd', 'voyage_pod_schedule'")
    expect(migration).toContain('idx_pix_reconciliation_exceptions_resolved_invoice')
  })

  it('sincroniza o estado da conversa quando o editor legado atualiza a invoice', () => {
    expect(migration).toContain('sync_demurrage_dispute_lifecycle_from_invoice')
    expect(migration).toContain("NEW.dispute_status = 'resolvido'")
    expect(migration).toContain("NEW.dispute_status = 'cancelado'")
    expect(migration).toContain("WHERE demurrage_invoice_id = NEW.id")
    expect(migration).toContain('DROP TRIGGER IF EXISTS sync_demurrage_dispute_lifecycle_from_invoice')
  })
})
