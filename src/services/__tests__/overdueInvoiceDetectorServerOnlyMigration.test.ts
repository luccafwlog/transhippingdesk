import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/325_financeiro_overdue_detector_server_only.sql'),
  'utf8',
)

describe('detector server-side de faturas vencidas do bloco 522', () => {
  it('processa somente invoices locais e usa a identidade canônica', () => {
    expect(migration).toContain("invoice_type IN ('individual', 'consolidated')")
    expect(migration).not.toContain("invoice_type = 'granite'")
    expect(migration).toContain("status IN ('issued', 'partially_paid')")
    expect(migration).not.toContain("status IN ('issued', 'partially_paid', 'overdue')")
    expect(migration).toContain("due_date < CURRENT_DATE")
    expect(migration).toContain("'invoice',\n      v_row.id::TEXT")
    expect(migration).toContain("'invoice_type', v_row.invoice_type")
  })

  it('upserta o item idempotentemente e não insere carrier legado', () => {
    expect(migration).toContain("PERFORM public.upsert_alert_item(")
    expect(migration).toContain("'invoice_overdue',")
    expect(migration).toContain("'overdue_invoice_detector'")
    expect(migration).toContain("'/taxas-locais'")
    expect(migration).not.toContain('INSERT INTO public.alerts')
  })

  it('fecha a RPC do detector para service_role e exige o runner interno', () => {
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(migration).toContain("current_setting('alerts.detector_runner', true) IS DISTINCT FROM 'on'")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.detect_overdue_invoices() FROM PUBLIC, anon, authenticated;')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.detect_overdue_invoices() TO service_role;')
    expect(migration).toContain("set_config('request.jwt.claim.role', 'service_role', true)")
    expect(migration).toContain("set_config('alerts.detector_runner', 'on', true)")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;')
  })

  it('não depende de abrir a tela de Faturamento', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/TaxasLocais.tsx'), 'utf8')
    const alerts = readFileSync(resolve(process.cwd(), 'src/services/alerts.ts'), 'utf8')

    expect(page).not.toContain('detectOverdueInvoices')
    expect(alerts).not.toContain("rpc('detect_overdue_invoices')")
  })
})
