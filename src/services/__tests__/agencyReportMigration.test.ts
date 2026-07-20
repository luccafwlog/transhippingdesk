import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/213_agency_departure_reports.sql'),
  'utf-8',
)
const closeSql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/214_agency_report_pending_alerts.sql'),
  'utf-8',
)

describe('migration 213 — agregado do Agency Departure Report', () => {
  it('ancora em (voyage_id, port) com unicidade', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agency_departure_reports')
    expect(sql).toContain('UNIQUE (voyage_id, port)')
  })

  it('nunca usa o prefixo abreviado adr_', () => {
    expect(sql).not.toMatch(/\badr_/)
  })

  it('sign-off valida o departamento dono da secao', () => {
    expect(sql).toContain('agency_report_section_owner')
    expect(sql).toMatch(/v_role NOT IN \('administrativo', v_owner\)/)
  })

  it('bloqueia sign-off fechado e deixa escrita somente nas RPCs', () => {
    expect(sql).toContain("status = 'closed'")
    expect(sql).not.toMatch(/CREATE POLICY \S+ ON public\.agency_departure_report\S* FOR (INSERT|UPDATE|DELETE|ALL)/)
  })

  it('permite leitura a perfis ativos e protege as RPCs definidoras', () => {
    expect(sql).toContain('public.is_active_read_user()')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.set_agency_report_signoff')
  })
})

describe('migration 214 — fechamento do Agency Departure Report', () => {
  it('exige snapshot com seções e todos os sign-offs antes do fechamento', () => {
    expect(closeSql).toMatch(/jsonb_typeof\(p_snapshot->'sections'\) <> 'object'/)
    expect(closeSql).toContain("state <> 'pending'")
    expect(closeSql).toContain("status = 'closed'")
  })

  it('serializa fechamento contra alterações concorrentes das seções e ocorrências', () => {
    expect(closeSql).toContain('FOR UPDATE')
    expect(closeSql).toContain('agency_report_reject_closed_write')
    expect(closeSql).toContain('BEFORE INSERT OR UPDATE ON public.agency_departure_report_signoffs')
    expect(closeSql).toContain('BEFORE INSERT ON public.agency_departure_report_occurrences')
  })

  it('reabertura exige justificativa, audita e devolve as seções a pendente', () => {
    expect(closeSql).toContain('Reabertura exige justificativa')
    expect(closeSql).toMatch(/SET state = 'pending', signed_by = NULL, signed_at = NULL/)
    expect(closeSql).toMatch(/INSERT INTO public\.audit_logs[\s\S]*'agency_departure_report'/)
  })
})

describe('migration 218 — contrato do snapshot fechado', () => {
  const sql218 = readFileSync(
    resolve(__dirname, '../../../supabase/migrations/218_agency_report_reopen_admin.sql'),
    'utf-8',
  )

  it('exige as quatro coleções canônicas e limita o payload', () => {
    expect(sql218).toMatch(/jsonb_typeof\(p_snapshot->'header'\) <> 'object'/)
    expect(sql218).toMatch(/jsonb_typeof\(p_snapshot->'occurrences'\) <> 'array'/)
    expect(sql218).toMatch(/jsonb_typeof\(p_snapshot->'signoffs'\) <> 'array'/)
    expect(sql218).toContain('octet_length(p_snapshot::text) > 1048576')
  })

  it('rejeita chaves de topo e seções fora do contrato', () => {
    expect(sql218).toContain("key NOT IN ('header', 'sections', 'occurrences', 'signoffs')")
    expect(sql218).toContain("'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados'")
    expect(sql218).toContain("'overtimeTransportCount'")
    expect(sql218).toContain('Snapshot possui secoes desconhecidas')
  })
})
