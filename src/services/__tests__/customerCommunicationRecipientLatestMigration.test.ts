import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/039_customer_communication_status_identity.sql'),
  'utf8',
)

describe('S07 — agregação da tentativa mais recente por destinatário', () => {
  it('seleciona DISTINCT ON pela identidade estável do destinatário', () => {
    expect(migration).toContain('DISTINCT ON (a.recipient_key)')
    expect(migration).toContain("COALESCE(NULLIF(btrim(a.recipient_key), ''),")
    expect(migration).toContain('ORDER BY a.recipient_key, a.created_at DESC, a.id DESC')
    expect(migration).toContain('FROM latest_attempts AS a;')
    expect(migration).not.toContain('DISTINCT ON (a.recipient_masked)')
  })

  it('mantém permissão de execução restrita a service_role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_customer_communication_status\(bigint\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_customer_communication_status\(bigint\) TO service_role/i)
  })
})
