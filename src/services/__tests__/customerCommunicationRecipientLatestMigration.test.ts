import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/038_customer_communication_status_recipient_latest.sql'),
  'utf8',
)

describe('S07 — agregação da tentativa mais recente por destinatário', () => {
  it('seleciona DISTINCT ON por recipient_masked com ordenação decrescente', () => {
    expect(migration).toContain('DISTINCT ON (a.recipient_masked)')
    expect(migration).toContain('ORDER BY a.recipient_masked, a.created_at DESC, a.id DESC')
    expect(migration).toContain('FROM latest_attempts AS a;')
  })

  it('mantém permissão de execução restrita a service_role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_customer_communication_status\(bigint\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_customer_communication_status\(bigint\) TO service_role/i)
  })
})
