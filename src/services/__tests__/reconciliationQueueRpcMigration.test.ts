import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('RPC publica de sincronizacao da fila de reconciliacao', () => {
  it('mantem o helper interno fechado e expoe apenas o wrapper protegido', () => {
    const sql = fs.readFileSync('supabase/migrations/278_reconciliation_queue_refresh_rpc.sql', 'utf8')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.refresh_customer_reconciliation_queue_for_bl')
    expect(sql).toContain('is_active_non_equipamentos_user()')
    expect(sql).toContain('public.sync_customer_reconciliation_queue_for_bl(p_bl_id)')
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_customer_reconciliation_queue_for_bl\(TEXT\) TO authenticated/i)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.sync_customer_reconciliation_queue_for_bl\(TEXT\) FROM PUBLIC, anon, authenticated/i)
  })
})
