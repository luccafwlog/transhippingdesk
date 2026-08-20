import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/323_agency_report_alerts_foundation.sql'),
  'utf8',
)

const functionBody = (name: string) =>
  sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]+?\\$function\\$;`, 'i'))?.[0] ?? ''

describe('migration 323 — produtores de Alertas do ADR na fundação transversal', () => {
  it('registra os produtores de pendência e prazo no catálogo central', () => {
    expect(sql).toContain("'agency_report_department_pending'")
    expect(sql).toContain("'agency_report_deadline_missed'")
    expect(sql).toMatch(/public\.upsert_alert_item\(/i)
    expect(sql).toMatch(/public\.resolve_alert_item_for_department\(/i)
    expect(sql).toContain('foundation_backfill')
  })

  it('usa um agregado por ADR terminalizado e preserva a chave legada', () => {
    expect(sql).toContain('agency_report_alert_entity_key')
    expect(sql).toContain('terminal_atd')
    expect(sql).toMatch(/terminal_id IS NOT NULL[\s\S]+terminal_code/i)
    expect(sql).toMatch(/terminal_id IS NULL[\s\S]+agency_report_alert_entity_key/i)
  })

  it('reconcilia pela origem, sem INSERT direto dos dois produtores em alerts', () => {
    const pending = functionBody('detect_agency_report_department_pending')
    const deadline = functionBody('detect_agency_report_deadline_missed')
    expect(pending).toContain('reconcile_agency_report_alerts')
    expect(deadline).toContain('reconcile_agency_report_alerts')
    expect(pending).not.toContain('INSERT INTO public.alerts')
    expect(deadline).not.toContain('INSERT INTO public.alerts')
  })

  it('reabre sign-off de seção invalidando atomicamente o sign-off departamental', () => {
    expect(sql).toContain('UPDATE public.agency_departure_report_department_signoffs')
    expect(sql).toContain('signed_at = NULL')
    expect(sql).toContain('reconcile_agency_report_alerts')
    expect(sql).toContain('NEW.justification')
  })

  it('dispara reconciliação server-side nas mutações de origem', () => {
    expect(sql).toContain('reconcile_agency_report_alerts_on_audit')
    expect(sql).toContain('AFTER INSERT ON public.audit_logs')
    expect(sql).toContain('reconcile_agency_report_alerts_on_report_change')
  })
})
