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
  it('preserva invoice_overdue em pagamento parcial e resolve no estado terminal', () => {
    const result = psql(`
      BEGIN;
      SET LOCAL ROLE postgres;
      SELECT set_config('request.jwt.claim.role', 'service_role', true);
      INSERT INTO public.customers (cnpj_cpf, name)
      VALUES ('04252011000110', 'Cliente review follow-up')
      ON CONFLICT (cnpj_cpf) DO NOTHING;
      INSERT INTO public.invoices (invoice_number, customer_id, total_brl, total_paid_brl, balance_brl, status, due_date)
      VALUES ('T5F-OVERDUE', (SELECT id FROM public.customers WHERE cnpj_cpf = '04252011000110'), 100, 10, 90, 'overdue', CURRENT_DATE - 10);
      SELECT public.upsert_alert_item(
        'invoice_overdue', 'invoice', (SELECT id::text FROM public.invoices WHERE invoice_number = 'T5F-OVERDUE'),
        'Fatura vencida de teste', 'review_followup', '{}'::jsonb, NULL
      );
      UPDATE public.invoices
      SET status = 'partially_paid', total_paid_brl = 50, balance_brl = 50
      WHERE invoice_number = 'T5F-OVERDUE';
      SELECT status FROM public.alert_items
      WHERE item_type = 'invoice_overdue'
        AND alert_id = (SELECT id FROM public.alerts WHERE type = 'aggregate' AND entity_id = (SELECT id::text FROM public.invoices WHERE invoice_number = 'T5F-OVERDUE'));
      UPDATE public.invoices
      SET status = 'paid', total_paid_brl = 100, balance_brl = 0
      WHERE invoice_number = 'T5F-OVERDUE';
      SELECT status FROM public.alert_items
      WHERE item_type = 'invoice_overdue'
        AND alert_id = (SELECT id FROM public.alerts WHERE type = 'aggregate' AND entity_id = (SELECT id::text FROM public.invoices WHERE invoice_number = 'T5F-OVERDUE'));
      ROLLBACK;
    `)

    const statuses = result.split(/\r?\n/).filter((line) => line === 'active' || line === 'resolved')
    expect(statuses).toEqual(['active', 'resolved'])
  })

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
