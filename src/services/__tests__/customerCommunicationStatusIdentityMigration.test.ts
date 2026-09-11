import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/039_customer_communication_status_identity.sql'),
  'utf8',
)

describe('S07 — identidade e recuperação do estado de Comunicados', () => {
  it('preserva tentativas históricas como legado até serem reconciliadas', () => {
    expect(migration).toContain('recipient_key text')
    expect(migration).toContain("dispatch_mode IN ('real', 'simulado', 'legado')")
    expect(migration).toContain("dispatch_mode = 'legado'")
    expect(migration).toContain("status = 'aceito'")
    expect(migration).toContain('provider_message_id IS NULL')
  })

  it('marca bloqueios de dispatch como estado retryable e mantém a RPC server-only', () => {
    expect(migration).toContain('mark_customer_communication_dispatch_blocked')
    expect(migration).toContain("v_next_status := CASE WHEN v_attempt_count = 0 THEN 'falha' ELSE 'parcial' END")
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.mark_customer_communication_dispatch_blocked\(bigint\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.mark_customer_communication_dispatch_blocked\(bigint\) TO service_role/i)
  })
})
