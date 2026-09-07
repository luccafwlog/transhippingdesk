import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const routingSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/010_contact_routing_and_dunning_eligibility.sql'), 'utf8')
const schemaSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql'), 'utf8')

describe('migration 010 — roteamento de caixas e elegibilidade da régua', () => {
  it('repara fallback somente pelo principal, sem contato arbitrário', () => {
    expect(routingSql).toContain('CREATE OR REPLACE FUNCTION public.repair_customer_contact_box_fallbacks')
    expect(routingSql).not.toMatch(/v_substitute_id/i)
    expect(routingSql).not.toContain('outro contato adicional')
    expect(routingSql).toContain('blocked_boxes')
    expect(routingSql).toContain('caixa_sem_destinatario')
    expect(routingSql).toContain('GRANT EXECUTE ON FUNCTION public.repair_customer_contact_box_fallbacks(bigint, text, text) TO service_role')
  })

  it('alinha claim e sendable com desativação, vínculo de caixa e supressões', () => {
    for (const signature of [
      'claim_demurrage_dunning_candidates',
      'demurrage_dunning_candidate_sendable',
    ]) {
      expect(routingSql).toContain(`CREATE OR REPLACE FUNCTION public.${signature}`)
    }
    expect(routingSql).toContain("bl.box_code IN ('demurrage', 'financeiro')")
    expect(routingSql).toContain('cc.deactivated_at IS NULL')
    expect(routingSql).toContain("pse.reason = 'bounce_permanente'")
    expect(routingSql).toContain('customer_communication_suppressions')
    expect(routingSql).toContain('customer_contact_box_links')
  })

  it('remove leitura de produção a customer_contact_preferences, preservando rollback', () => {
    expect(routingSql).not.toMatch(/FROM\s+public\.customer_contact_preferences/i)
    expect(routingSql).not.toMatch(/JOIN\s+public\.customer_contact_preferences/i)
    expect(schemaSql).toContain('CREATE TABLE public.customer_contact_preferences')
  })

  it('reconhece mensagem agrupada D11 e mantém release server-only sem consumir a régua', () => {
    expect(routingSql).toContain('customer_communication_bls')
    expect(routingSql).toContain('release_demurrage_dunning_claim')
    expect(routingSql).toContain('GRANT EXECUTE ON FUNCTION public.release_demurrage_dunning_claim(bigint, integer) TO service_role')
    expect(routingSql).toContain('GRANT EXECUTE ON FUNCTION public.claim_demurrage_dunning_candidates(timestamp with time zone, integer) TO service_role')
    expect(routingSql).toContain('GRANT EXECUTE ON FUNCTION public.demurrage_dunning_candidate_sendable(bigint) TO service_role')
  })
})

// Opt-in: exerce os contratos contra o Postgres descartável depois do replay
// local (`LOCAL_PG_INTEGRATION=1`). O contrato textual acima continua útil para
// a suíte padrão; este cenário pega regressões de elegibilidade, starvation e
// release/reuso no comportamento real.
const describeLocal = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'
const localAdminId = '00000000-0000-0000-0000-000000010601'
const localEligibleCustomerId = 99010601
const localBouncedCustomerId = 99010602
const localCarrierId = 99010603
const localVesselId = 99010604
const localVoyageId = 99010605
const localCustomerIds = [localEligibleCustomerId, localBouncedCustomerId]
const localStarvationIds = Array.from({ length: 60 }, (_, index) => 99110600 + index + 1)

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

describeLocal('migration 010 — comportamento efetivo da elegibilidade no Postgres', () => {
  beforeAll(() => {
    const starvationInvoices = localStarvationIds
      .map((id, index) => `(${id}, 'S06-STAR-${id}', 'S06-STAR-BL-${id}', ${localEligibleCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued', ${index < 50 ? 'true' : 'false'})`)
      .join(',\n        ')
    const starvationBls = localStarvationIds
      .map((id) => `('S06-STAR-BL-${id}', ${localVoyageId}, ${localEligibleCustomerId}, 'container')`)
      .join(',\n        ')
    localPsql(`
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${localStarvationIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${localStarvationIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id LIKE 'S06-STAR-BL-%';
      DELETE FROM public.customer_communications WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (99010611, 99010612);
      DELETE FROM public.demurrage_invoices WHERE id IN (99010611, 99010612);
      DELETE FROM public.customer_contacts WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.bls WHERE id IN ('S06-BL-1', 'S06-BL-2');
      DELETE FROM public.voyages WHERE id = ${localVoyageId};
      DELETE FROM public.vessels WHERE id = ${localVesselId};
      DELETE FROM public.carriers WHERE id = ${localCarrierId};
      SET session_replication_role = replica;
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.customers WHERE id IN (${localCustomerIds.join(',')});
      SET session_replication_role = origin;
      DELETE FROM public.audit_logs WHERE changed_by = '${localAdminId}';
      DELETE FROM public.alert_item_events WHERE actor_id = '${localAdminId}';
      DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN (${localCustomerIds.map((id) => `'${id}'`).join(',')});
      DELETE FROM public.user_profiles WHERE id = '${localAdminId}';
      DELETE FROM auth.users WHERE id = '${localAdminId}';
      DELETE FROM public.portal_suppressed_emails WHERE email IN ('s06-bounced@example.test', 's06-star-bounced@example.test');

      INSERT INTO auth.users (id, email)
      VALUES ('${localAdminId}', 's06-dunning@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${localAdminId}', 'S06 Dunning', 'admin', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES
        (${localEligibleCustomerId}, '00000000000191', 'Cliente S06'),
        (${localBouncedCustomerId}, '22334455000186', 'Cliente S06 Bounce');
      INSERT INTO public.carriers (id, name)
      VALUES (${localCarrierId}, 'Carrier S06');
      INSERT INTO public.vessels (id, name, carrier_id)
      VALUES (${localVesselId}, 'Vessel S06', ${localCarrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${localVoyageId}, ${localVesselId}, 'S06', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode)
      VALUES
        ('S06-BL-1', ${localVoyageId}, ${localEligibleCustomerId}, 'container'),
        ('S06-BL-2', ${localVoyageId}, ${localBouncedCustomerId}, 'container');
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, doc_date, first_billed_at, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES
        (99010611, 'S06-DEM-1', 'S06-BL-1', ${localEligibleCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued'),
        (99010612, 'S06-DEM-2', 'S06-BL-2', ${localBouncedCustomerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued');
      -- Principal elegível nasce com as 3 caixas (seed); alternativo recebe só a operacional.
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES
        (${localEligibleCustomerId}, 'Principal S06', 's06-principal@example.test', 'financeiro', true),
        (${localBouncedCustomerId}, 'Principal S06 Bounce', 's06-bounced@example.test', 'financeiro', true),
        (${localBouncedCustomerId}, 'Operacional S06', 's06-operacional@example.test', 'operacional', false);
      INSERT INTO public.portal_suppressed_emails (email, reason)
      VALUES ('s06-bounced@example.test', 'bounce_permanente');
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;
      -- Starvation: 50 inelegíveis (disputa) à frente dos 10 elegíveis.
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode)
      VALUES ${starvationBls};
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, doc_date, first_billed_at, total_usd, current_roe, current_total_brl, roe_source, status, dispute_open)
      VALUES ${starvationInvoices};
    `)
  })

  afterAll(() => {
    localPsql(`
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${localStarvationIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${localStarvationIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id LIKE 'S06-STAR-BL-%';
      DELETE FROM public.customer_communications WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (99010611, 99010612);
      DELETE FROM public.demurrage_invoices WHERE id IN (99010611, 99010612);
      DELETE FROM public.customer_contacts WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.bls WHERE id IN ('S06-BL-1', 'S06-BL-2');
      DELETE FROM public.voyages WHERE id = ${localVoyageId};
      DELETE FROM public.vessels WHERE id = ${localVesselId};
      DELETE FROM public.carriers WHERE id = ${localCarrierId};
      SET session_replication_role = replica;
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${localCustomerIds.join(',')});
      DELETE FROM public.customers WHERE id IN (${localCustomerIds.join(',')});
      SET session_replication_role = origin;
      DELETE FROM public.audit_logs WHERE changed_by = '${localAdminId}';
      DELETE FROM public.alert_item_events WHERE actor_id = '${localAdminId}';
      DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN (${localCustomerIds.map((id) => `'${id}'`).join(',')});
      DELETE FROM public.user_profiles WHERE id = '${localAdminId}';
      DELETE FROM auth.users WHERE id = '${localAdminId}';
      DELETE FROM public.portal_suppressed_emails WHERE email IN ('s06-bounced@example.test', 's06-star-bounced@example.test');
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;
    `)
  })

  it('não vincula alternativo só-operacional à Demurrage e pausa com alerta + auditoria', () => {
    const repaired = JSON.parse(localPsql(`
      SELECT public.repair_customer_contact_box_fallbacks(${localBouncedCustomerId}, NULL, 'demurrage');
    `)) as { success: boolean; relinked_boxes: string[]; blocked_boxes: string[] }
    expect(repaired.success).toBe(true)
    expect(repaired.relinked_boxes).toEqual([])
    expect(repaired.blocked_boxes).toEqual(['demurrage'])

    const links = localPsql(`
      SELECT l.box_code FROM public.customer_contact_box_links l
      JOIN public.customer_contacts cc ON cc.id = l.contact_id
      WHERE cc.customer_id = ${localBouncedCustomerId} AND l.box_code = 'demurrage';
    `)
    expect(links).toBe('')

    expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(99010612);`)).toBe('f')
    const claimed = JSON.parse(localPsql(`
      SELECT public.claim_demurrage_dunning_candidates('2026-09-10T12:00:00Z'::timestamptz, 50);
    `)) as Array<{ invoice_id: number }>
    expect(claimed.some((candidate) => Number(candidate.invoice_id) === 99010612)).toBe(false)
    expect(claimed.some((candidate) => Number(candidate.invoice_id) === 99010611)).toBe(true)
  })

  it('principal elegível segue sendable e recipients da Demurrage o alcançam', () => {
    expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(99010611);`)).toBe('t')
    expect(localPsql(`
      SELECT public.customer_communication_recipient_allowed(
        ${localEligibleCustomerId},
        (SELECT id FROM public.customer_contacts WHERE customer_id = ${localEligibleCustomerId} AND is_primary = true LIMIT 1),
        'cobranca_demurrage', 'caixa', NULL);
    `)).toBe('t')
  })

  it('starvation: 50 inelegíveis à frente não bloqueiam os 10 elegíveis no 1º lote', () => {
    const claimed = JSON.parse(localPsql(`
      SELECT public.claim_demurrage_dunning_candidates('2026-09-10T12:00:00Z'::timestamptz, 50);
    `)) as Array<{ invoice_id: number; attempt_discriminator: number }>
    const starved = claimed.filter((candidate) => localStarvationIds.includes(Number(candidate.invoice_id)))
    expect(starved).toHaveLength(10)
    expect(starved.every((candidate) => Number(candidate.attempt_discriminator) === 1)).toBe(true)
  })

  it('pausa libera sem consumir a régua; claim é server-only', () => {
    const pausedInvoiceId = localStarvationIds[localStarvationIds.length - 1]!
    expect(localPsql(`SELECT public.release_demurrage_dunning_claim(${pausedInvoiceId}, 1);`)).toBe('t')
    const reused = JSON.parse(localPsql(`
      SELECT public.claim_demurrage_dunning_candidates('2026-09-10T12:00:00Z'::timestamptz, 50);
    `)) as Array<{ invoice_id: number; attempt_discriminator: number }>
    const again = reused.find((candidate) => Number(candidate.invoice_id) === pausedInvoiceId)
    expect(again).toMatchObject({ invoice_id: pausedInvoiceId, attempt_discriminator: 1 })

    const denied = localCallAsAuthenticated(`SELECT public.release_demurrage_dunning_claim(${pausedInvoiceId}, 1)`)
    expect(denied.status, `${denied.stdout}\n${denied.stderr}`).not.toBe(0)
  })
})
