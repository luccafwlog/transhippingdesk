import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/339_treatment_echo_and_transversal_surfaces.sql'), 'utf8')

describe('migration 339 — Eco de Tratamento e superfícies transversais', () => {
  it('amplia alert_item_events para aceitar o evento dismissed', () => {
    expect(migration).toContain("CHECK (event_type IN ('opened', 'updated', 'resolved', 'dismissed'))")
  })

  it('emite evento dismissed e executa fan-out do Eco de Tratamento dentro de dismiss_alert_item', () => {
    expect(migration).toContain("event_type, previous_status, new_status, actor_id, metadata")
    expect(migration).toContain("'dismissed',")
    expect(migration).toContain("n.recipient_id <> auth.uid()")
    expect(migration).toContain("'is_echo', true")
    expect(migration).toContain("'normal',")
    expect(migration).toContain("ON CONFLICT (event_id, recipient_id) DO NOTHING")
    expect(migration).toContain("n.is_fallback")
    expect(migration).toContain("n.recipient_department")
  })

  it('entrega RPCs de contagem e baixa em massa de Notificações Internas', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.count_unread_internal_notifications()')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.mark_all_internal_notifications_read()')
    expect(migration).toContain('recipient_id = auth.uid()')
    expect(migration).toContain('read_at IS NULL')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.count_unread_internal_notifications() TO authenticated')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.mark_all_internal_notifications_read() TO authenticated')
  })

  it('pagina list_internal_notifications com limite e offset', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.list_internal_notifications(')
    expect(migration).toContain('p_limit INTEGER DEFAULT 20')
    expect(migration).toContain('p_offset INTEGER DEFAULT 0')
    expect(migration).toContain('LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))')
  })

  it('projeta autor, motivo e revisão da dispensa e filtra por departamento na fila', () => {
    expect(migration).toContain('p_department TEXT DEFAULT NULL')
    expect(migration).toContain("'dismissal_reason', d.reason")
    expect(migration).toContain("'dismissed_by', d.dismissed_by")
    expect(migration).toContain("'dismissed_by_name', up.full_name")
    expect(migration).toContain("'dismissed_at', d.dismissed_at")
    expect(migration).toContain('COALESCE(d.review_at > now(), false) AS is_dismissed')
    expect(migration).toContain("p_department = 'sem_departamento' AND (i.department IS NULL OR btrim(i.department) = '')")
    expect(migration).toContain("p_department = 'sem_departamento' AND (c.responsible_department IS NULL OR btrim(c.responsible_department) = '')")
  })

  it('ordena a fila com não dispensados antes de dispensados e críticos antes de normais', () => {
    expect(migration).toContain('COALESCE(d.review_at > now(), false) AS is_dismissed')
    expect(migration).toContain('is_dismissed ASC')
    expect(migration).toContain('is_critical DESC')
    expect(migration).toContain('created_at DESC')
    expect(migration).toContain('item_id DESC')
  })

  it('entrega agregação dedicada de alertas por departamento para o /painel', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.summarize_alert_queue_by_department()')
    expect(migration).toContain('COALESCE(d.review_at > now(), false) AS is_dismissed')
    expect(migration).toContain('active_count BIGINT')
    expect(migration).toContain('dismissed_count BIGINT')
    expect(migration).toContain('is_legacy BOOLEAN')
    expect(migration).toContain("dept AS department")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.summarize_alert_queue_by_department() TO authenticated')
  })
})
