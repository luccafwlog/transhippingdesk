import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/321_alerts_foundation_review_followups.sql')
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const describeLocal = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

describe('follow-up da fundação de alertas', () => {
  it('define a resolução terminal de invoice_overdue e consome carriers órfãos', () => {
    expect(existsSync(migrationPath)).toBe(true)
    expect(migration).toContain("NEW.status IN ('paid', 'cancelled', 'covered', 'obsolete')")
    expect(migration).toContain("NEW.status = 'partially_paid' AND NEW.balance_brl IS NOT NULL AND NEW.balance_brl <= 0.01")
    expect(migration).toContain('v_upsert_result := public.upsert_alert_item')
    expect(migration).toContain("v_upsert_alert_id IS DISTINCT FROM NEW.id")
  })
})

describeLocal('comportamento efetivo do follow-up no Postgres local', () => {
  // O caso de invoice_overdue saiu daqui na migration 348 (ADR 0055): taxa local
  // não tem vencimento praticado, o tipo foi aposentado no catálogo e
  // resolve_invoice_alerts_on_status_change deixou de citá-lo. As asserções de
  // texto sobre a 321 acima permanecem: a migration é registro histórico.

  it('fecha o carrier legado quando o item é anexado a um agregado existente', () => {
    const result = psql(`
      BEGIN;
      SET LOCAL ROLE postgres;
      SELECT set_config('request.jwt.claim.role', 'service_role', true);
      INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
      VALUES ('aggregate', 'review_followup', 'carrier-519568', 'Agregado existente', 'open');
      INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
      VALUES ('portal_dispute_opened', 'review_followup', 'carrier-519568', 'Carrier legado', 'closed');
      SELECT a.status || '|' || count(i.id)::text
      FROM public.alerts a
      LEFT JOIN public.alert_items i ON i.alert_id = (SELECT id FROM public.alerts WHERE type = 'aggregate' AND entity_type = 'review_followup' AND entity_id = 'carrier-519568')
        AND i.item_type = 'portal_dispute_opened'
      WHERE a.type = 'portal_dispute_opened' AND a.entity_type = 'review_followup' AND a.entity_id = 'carrier-519568'
      GROUP BY a.status;
      ROLLBACK;
    `)

    expect(result.split(/\r?\n/).find((line) => line.includes('|'))).toBe('closed|1')
  })
})
