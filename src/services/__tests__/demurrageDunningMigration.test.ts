import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const baseSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/378_demurrage_dunning_communication.sql'), 'utf8')
const correctionSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/379_demurrage_dunning_claim_recovery.sql'), 'utf8')
const hardeningSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/380_comunicados_financeiros_hardening.sql'), 'utf8')
const sql = `${baseSql}\n${correctionSql}`

describe('migration 378 — régua de Demurrage', () => {
  it('protege o payload financeiro e oferece configuração administrativa do intervalo', () => {
    expect(hardeningSql).toContain('customer_local_charges_communication_payload')
    expect(hardeningSql).toContain('set_demurrage_dunning_interval_days')
    expect(correctionSql).toContain("pse.reason = 'bounce_permanente'")
    expect(hardeningSql).toContain('demurrage_dunning_candidate_sendable')
  })
  it('usa first_billed_at, intervalo configurável e não impõe teto de cobranças', () => {
    expect(sql).toContain('first_billed_at')
    expect(sql).toContain('paid_at IS NULL')
    expect(sql).toContain('demurrage_dunning_interval_days')
    expect(sql).toContain("'0 * * * *'")
    expect(sql).toContain('demurrage_dunning_claims')
    expect(sql).toContain('p_limit INTEGER DEFAULT 50')
    expect(sql).toContain('LIMIT v_limit')
    expect(sql).toContain('released_at')
    expect(sql).toContain('count(*) FILTER (WHERE prior_claim.released_at IS NULL)')
    expect(sql).toMatch(/attempt_discriminator\s+INTEGER[\s\S]*CHECK\s*\(attempt_discriminator\s*>\s*0\)/i)
    expect(sql).not.toMatch(/LIMIT\s+[1-6]\b/i)
  })

  it('pausa por disputa e por cliente sem contatos válidos após bounce', () => {
    expect(correctionSql).toMatch(/COALESCE\(di\.dispute_open, false\) = false/i)
    expect(correctionSql).not.toContain("cliente_contato_bounced_sem_alternativa")
    expect(correctionSql).toContain("pse.reason = 'bounce_permanente'")
    expect(correctionSql).toContain('customer_communication_suppressions')
  })

  it('reutiliza claims liberados, oferece release server-only e expõe leitura agregada', () => {
    expect(correctionSql).toContain('released_at = NULL')
    expect(correctionSql).toContain('release_demurrage_dunning_claim')
    expect(correctionSql).toContain('list_demurrage_dunning_claim_statuses')
    expect(correctionSql).toContain('GRANT EXECUTE ON FUNCTION public.release_demurrage_dunning_claim(BIGINT, INTEGER) TO service_role')
    expect(correctionSql).toContain('GRANT EXECUTE ON FUNCTION public.list_demurrage_dunning_claim_statuses(BIGINT[]) TO authenticated, service_role')
  })
})

// Opt-in: executa as RPCs contra o Postgres descartável depois do replay local
// (`LOCAL_PG_INTEGRATION=1`). O contrato textual acima continua útil para a
// suíte padrão, mas este cenário pega regressões na forma real do alerta,
// limite do lote, release/reuso e leitura autenticada.
const describeLocal = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'
const localAdminId = '00000000-0000-0000-0000-000000379001'
const localCustomerId = 99037901
const localBouncedCustomerId = 99037902
const localCarrierId = 99037903
const localVesselId = 99037904
const localVoyageId = 99037905
const localInvoiceIds = [99037901, 99037902, 99037903, 99037904]
const localBlIds = ['T379-DUN-BL-1', 'T379-DUN-BL-2', 'T379-DUN-BL-3', 'T379-DUN-BL-4']

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${localAdminId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function localCallAsAuthenticated(sql: string) {
  return spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${localAdminId}', true); END $$; ${sql}; COMMIT;`,
  ], { encoding: 'utf8' })
}

describeLocal('migration 379 — comportamento efetivo da régua no Postgres', () => {
  beforeAll(() => {
    localPsql(`
      DELETE FROM public.alerts WHERE entity_id = '${localBouncedCustomerId}';
      DELETE FROM public.customer_communications WHERE customer_id IN (${localCustomerId}, ${localBouncedCustomerId});
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${localInvoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${localInvoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_contacts WHERE customer_id IN (${localCustomerId}, ${localBouncedCustomerId});
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${localBlIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${localVoyageId};
      DELETE FROM public.vessels WHERE id = ${localVesselId};
      DELETE FROM public.carriers WHERE id = ${localCarrierId};
      SET session_replication_role = replica;
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${localCustomerId}, ${localBouncedCustomerId});
      DELETE FROM public.customers WHERE id IN (${localCustomerId}, ${localBouncedCustomerId});
      SET session_replication_role = origin;
      DELETE FROM public.audit_logs WHERE changed_by = '${localAdminId}';
      DELETE FROM public.user_profiles WHERE id = '${localAdminId}';
      DELETE FROM auth.users WHERE id = '${localAdminId}';

      INSERT INTO auth.users (id, email)
      VALUES ('${localAdminId}', 't379-dunning@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${localAdminId}', 'T379 Dunning', 'admin', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES
        (${localCustomerId}, '99037901000115', 'Cliente T379'),
        (${localBouncedCustomerId}, '99037902000160', 'Cliente T379 Bounce');
      INSERT INTO public.carriers (id, name)
      VALUES (${localCarrierId}, 'Carrier T379');
      INSERT INTO public.vessels (id, name, carrier_id)
      VALUES (${localVesselId}, 'Vessel T379', ${localCarrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${localVoyageId}, ${localVesselId}, 'T379', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, financial_status)
      VALUES
        ('${localBlIds[0]}', ${localVoyageId}, ${localCustomerId}, 'container', 'invoiced'),
        ('${localBlIds[1]}', ${localVoyageId}, ${localCustomerId}, 'container', 'invoiced'),
        ('${localBlIds[2]}', ${localVoyageId}, ${localCustomerId}, 'container', 'invoiced'),
        ('${localBlIds[3]}', ${localVoyageId}, ${localBouncedCustomerId}, 'container', 'invoiced');
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, doc_date, first_billed_at, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES
        (${localInvoiceIds[0]}, 'T379-DEM-1', '${localBlIds[0]}', ${localCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued'),
        (${localInvoiceIds[1]}, 'T379-DEM-2', '${localBlIds[1]}', ${localCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued'),
        (${localInvoiceIds[2]}, 'T379-DEM-3', '${localBlIds[2]}', ${localCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued'),
        (${localInvoiceIds[3]}, 'T379-DEM-4', '${localBlIds[3]}', ${localBouncedCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued');
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES
        (${localCustomerId}, 'Financeiro T379', 't379-finance@example.test', 'financeiro', true),
        (${localBouncedCustomerId}, 'Financeiro T379 Bounce', 't379-bounce@example.test', 'financeiro', true);
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;

      INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
      VALUES ('aggregate', 'customer', '${localBouncedCustomerId}', 'T379 bounce sem alternativa', 'open');
      INSERT INTO public.alert_items (alert_id, item_type, source, severity, department, message)
      SELECT id, 'cliente_contato_bounced_sem_alternativa', 't379_test', 'critical', 'documentacao', 'T379 bounce sem alternativa'
      FROM public.alerts
      WHERE type = 'aggregate' AND entity_type = 'customer' AND entity_id = '${localBouncedCustomerId}' AND status = 'open';
    `)
  })

  afterAll(() => {
    localPsql(`
      DELETE FROM public.alerts WHERE entity_id = '${localBouncedCustomerId}';
      DELETE FROM public.customer_communications WHERE customer_id IN (${localCustomerId}, ${localBouncedCustomerId});
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${localInvoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${localInvoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_contacts WHERE customer_id IN (${localCustomerId}, ${localBouncedCustomerId});
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${localBlIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${localVoyageId};
      DELETE FROM public.vessels WHERE id = ${localVesselId};
      DELETE FROM public.carriers WHERE id = ${localCarrierId};
      SET session_replication_role = replica;
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${localCustomerId}, ${localBouncedCustomerId});
      DELETE FROM public.customers WHERE id IN (${localCustomerId}, ${localBouncedCustomerId});
      SET session_replication_role = origin;
      DELETE FROM public.audit_logs WHERE changed_by = '${localAdminId}';
      DELETE FROM public.user_profiles WHERE id = '${localAdminId}';
      DELETE FROM auth.users WHERE id = '${localAdminId}';
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;
    `)
  })

  it('limita o lote, ignora o carrier sem item e reusa uma claim liberada', () => {
    const first = JSON.parse(localPsql(`
      SELECT public.claim_demurrage_dunning_candidates('2026-09-10T12:00:00Z'::timestamptz, 2);
    `)) as Array<{ invoice_id: number; attempt_discriminator: number; claimed_at: string }>
    expect(first).toHaveLength(2)
    expect(first.map((candidate) => Number(candidate.invoice_id))).toEqual(localInvoiceIds.slice(0, 2))
    expect(first.every((candidate) => Number(candidate.attempt_discriminator) === 1)).toBe(true)
    expect(first.every((candidate) => typeof candidate.claimed_at === 'string')).toBe(true)

    const authenticatedRead = localCallAsAuthenticated(`
      SELECT invoice_id || '|' || attempt_count
      FROM public.list_demurrage_dunning_claim_statuses(ARRAY[${localInvoiceIds[0]}, ${localInvoiceIds[1]}]::bigint[])
      ORDER BY invoice_id;
    `)
    expect(authenticatedRead.status, `${authenticatedRead.stdout}\n${authenticatedRead.stderr}`).toBe(0)
    expect(authenticatedRead.stdout.trim().split(/\r?\n/)).toEqual([
      `${localInvoiceIds[0]}|1`,
      `${localInvoiceIds[1]}|1`,
    ])

    expect(localPsql(`SELECT public.release_demurrage_dunning_claim(${localInvoiceIds[0]}, 1);`)).toBe('t')
    const reused = JSON.parse(localPsql(`
      SELECT public.claim_demurrage_dunning_candidates('2026-09-10T12:00:00Z'::timestamptz, 50);
    `)) as Array<{ invoice_id: number; attempt_discriminator: number; claimed_at: string }>
    const reusedFirst = reused.find((candidate) => Number(candidate.invoice_id) === localInvoiceIds[0])
    expect(reusedFirst).toMatchObject({ invoice_id: localInvoiceIds[0], attempt_discriminator: 1 })
    expect(reusedFirst?.claimed_at).not.toBe(first[0]?.claimed_at)
    expect(reused.some((candidate) => Number(candidate.invoice_id) === localInvoiceIds[3])).toBe(false)
  })
})
