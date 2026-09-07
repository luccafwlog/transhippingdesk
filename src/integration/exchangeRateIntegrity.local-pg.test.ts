import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

const actorId = '00000000-0000-0000-0000-000000018001'
const quoteDate = '2026-09-05'

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function authenticatedPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('S09 — procedencia e integridade de ROE/PTAX', () => {
  beforeAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.exchange_rate_reference_history
       WHERE effective_date >= '2026-09-05';
      DELETE FROM public.exchange_rate_reference;
      DELETE FROM auth.users WHERE id = '${actorId}';
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's09-exchange@example.test');
      SET session_replication_role = origin;
    `)
  })

  afterAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.exchange_rate_reference_history
       WHERE effective_date >= '2026-09-05';
      DELETE FROM public.exchange_rate_reference;
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  it('persiste a cotacao BCB com identidade idempotente e mesma ROE canonica', () => {
    const first = JSON.parse(localPsql(`
      SELECT public.save_exchange_rate_reference_v2(
        5.1234, 5.4564, '${quoteDate}', 'bcb_live', '${quoteDate}'
      );
    `)) as { source: string; ptax: number; roe: number }
    expect(first).toMatchObject({ source: 'bcb_live', ptax: 5.1234, roe: 5.4564 })

    const repeat = JSON.parse(localPsql(`
      SELECT public.save_exchange_rate_reference_v2(
        5.1234, 5.4564, '${quoteDate}', 'bcb_live', '${quoteDate}'
      );
    `)) as { source: string }
    expect(repeat.source).toBe('bcb_live')
    expect(localPsql(`SELECT count(*) FROM public.exchange_rate_reference_history WHERE source = 'bcb_live' AND effective_date = '${quoteDate}';`)).toBe('1')
    expect(localPsql(`SELECT source || ':' || ptax::text || ':' || roe::text FROM public.exchange_rate_reference WHERE id = 1;`)).toBe('bcb_live:5.1234:5.4564')
  })

  it('rejeita PTAX ausente ou ROE divergente em origem automatica', () => {
    expect(() => localPsql(`SELECT public.save_exchange_rate_reference_v2(NULL::numeric, 5.4564, '${quoteDate}', 'bcb_live', '${quoteDate}');`)).toThrow()
    expect(() => localPsql(`SELECT public.save_exchange_rate_reference_v2(5.1234, 5.4, '${quoteDate}', 'cached', '${quoteDate}');`)).toThrow()
  })

  it('aceita manual sem PTAX e impede escrita direta do navegador', () => {
    const result = JSON.parse(localPsql(`
      SELECT public.save_exchange_rate_reference_v2(
        NULL::numeric, 5.5000, '2026-09-06', 'manual', '2026-09-06'
      );
    `)) as { source: string; ptax: number | null }
    expect(result).toMatchObject({ source: 'manual', ptax: null })
    expect(() => authenticatedPsql(`UPDATE public.exchange_rate_reference SET roe = 9 WHERE id = 1;`)).toThrow()
    expect(() => authenticatedPsql(`INSERT INTO public.exchange_rate_reference_history(source, roe, effective_date) VALUES ('manual', 5.5, '2026-09-07');`)).toThrow()
  })
})
