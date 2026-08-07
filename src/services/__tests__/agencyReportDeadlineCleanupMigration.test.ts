import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/272_agency_report_deadline_cleanup.sql'),
  'utf8',
)

describe('migration 272 — limpeza de alertas de escalas soft-deleted', () => {
  it('reconstrói o soft-delete a partir do audit log, não de uma coluna inexistente', () => {
    expect(sql).toContain("field_name = 'deleted'")
    expect(sql).toContain("new_value = 'true'")
    expect(sql).toContain('public.audit_logs')
    expect(sql).toContain('closed_at = COALESCE(a.closed_at, now())')
    expect(sql).not.toContain('resolved_at')
    expect(sql).not.toMatch(/voyage_pod_schedule\s+s[\s\S]{0,300}\bs\.deleted\b/)
  })
})
