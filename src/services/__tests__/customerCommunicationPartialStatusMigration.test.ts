import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/032_customer_communication_partial_status.sql'), 'utf8')

describe('S07 — estado parcial de Comunicados', () => {
  it('adiciona parcial sem quebrar os estados históricos', () => {
    expect(migration).toMatch(/customer_communications_status_check[\s\S]*enviado[\s\S]*simulado[\s\S]*falha[\s\S]*parcial/i)
    expect(migration).toContain("dispatch_mode IN ('real', 'simulado')")
  })

  it('deriva o estado a partir das tentativas e mantém escrita server-only', () => {
    expect(migration).toContain('refresh_customer_communication_status')
    expect(migration).toContain('v_real_success')
    expect(migration).toContain('v_simulated_success')
    expect(migration).toContain('v_failures')
    expect(migration).toContain("'parcial'")
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_customer_communication_status[\s\S]*TO service_role/i)
    expect(migration).toContain('customer_communication_attempts_refresh_status')
  })
})
