import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const migration = fs.readFileSync(path.join(migrationsDir, '312_cod_reprices_local_charges.sql'), 'utf8')
const migration310 = fs.readFileSync(path.join(migrationsDir, '310_cod_justification.sql'), 'utf8')

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

function functionBody(source: string, functionName: string) {
  const match = source.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$;`, 'i'),
  )
  expect(match, `função ${functionName} não encontrada`).toBeTruthy()
  return match?.[1] ?? ''
}

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function callAsAuthenticated(userId: string, sql: string) {
  return spawnSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-d',
      databaseUrl,
      '-c',
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql}; COMMIT;`,
    ],
    { encoding: 'utf8' },
  )
}

describe('contrato da reprecificação de Taxa Local no COD', () => {
  it('cria o ledger no grão B/L × omissão com snapshots e ações financeiras', () => {
    expect(migration).toMatch(/CREATE TABLE public\.cod_adjustments/i)
    for (const column of [
      'bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT',
      'omission_id BIGINT NOT NULL REFERENCES public.voyage_omissions(id) ON DELETE RESTRICT',
      'original_value_brl NUMERIC(14,2)',
      'new_destination_value_brl NUMERIC(14,2)',
      'difference_brl NUMERIC(14,2)',
      'paid_amount_brl NUMERIC(14,2)',
      'manual_review_required BOOLEAN',
      'resulting_document_id BIGINT',
    ]) {
      expect(migration).toContain(column)
    }
    expect(migration).toMatch(/UNIQUE\s*\(bl_id,\s*omission_id\)/i)
    expect(migration).toMatch(/action TEXT NOT NULL[\s\S]*?complementary_invoice[\s\S]*?cancel_and_reissue[\s\S]*?manual_charge_review[\s\S]*?offset_open_balance[\s\S]*?refund_overpayment/i)
    expect(migration).toMatch(/status TEXT NOT NULL[\s\S]*?pending[\s\S]*?settled[\s\S]*?cancelled/i)
    expect(migration).toMatch(/CONSTRAINT cod_adjustments_difference_check[\s\S]*difference_brl[\s\S]*new_destination_value_brl[\s\S]*original_value_brl/i)
  })

  it('abre leitura somente a usuários ativos e não cria policy de escrita', () => {
    expect(migration).toMatch(/ALTER TABLE public\.cod_adjustments ENABLE ROW LEVEL SECURITY/i)
    expect(migration).toMatch(/CREATE POLICY cod_adjustments_select_active[\s\S]*FOR SELECT[\s\S]*TO authenticated[\s\S]*public\.is_active_user\(\)/i)
    expect(migration).not.toMatch(/CREATE POLICY cod_adjustments_(insert|update|delete)/i)
    expect(migration).toMatch(/GRANT SELECT ON (TABLE )?public\.cod_adjustments TO authenticated/i)
    expect(migration).toMatch(/REVOKE ALL ON (TABLE )?public\.cod_adjustments FROM PUBLIC, anon/i)
  })

  it('publica helper interno sem changed_by e revoga EXECUTE de toda sessão cliente', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_cod_financial_effect\(\s*p_bl_id TEXT,\s*p_omission_id BIGINT,\s*p_previous_pod TEXT\s*\)/i)
    const body = functionBody(migration, 'apply_cod_financial_effect')
    expect(body).toMatch(/v_actor UUID := auth\.uid\(\)|v_actor := auth\.uid\(\)/i)
    expect(body).not.toMatch(/p_changed_by|changed_by/i)
    expect(body).toMatch(/resolve_bl_local_charge_items\(p_bl_id,\s*p_previous_pod\)/i)
    expect(body).toMatch(/resolve_bl_local_charge_items\(p_bl_id,\s*v_bl\.pod\)/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.apply_cod_financial_effect\(TEXT, BIGINT, TEXT\) FROM PUBLIC, anon, authenticated/i)
  })

  it('separa o calculador mutável do preview puro e preserva linhas manuais', () => {
    const body = functionBody(migration, 'apply_cod_financial_effect')
    expect(body).toMatch(/IF COALESCE\(v_bl\.financial_status, 'pending'\) NOT IN \('invoiced', 'partially_paid', 'paid'\)[\s\S]*calculate_bl_local_charges/i)
    expect(body).toMatch(/p_recalculate\s*=>\s*true/i)
    expect(body).toMatch(/source[\s\S]*?['"]manual['"]/i)
    expect(body).toMatch(/manual_charge_review/i)
    expect(body).toMatch(/resolve_bl_local_charge_items/i)
  })

  it('registra todas as decisões sem emitir documento ou restituição no ato do COD', () => {
    const body = functionBody(migration, 'apply_cod_financial_effect')
    for (const action of ['cancel_and_reissue', 'complementary_invoice', 'offset_open_balance', 'refund_overpayment']) {
      expect(body).toContain(`'${action}'`)
    }
    expect(body).toMatch(/LEAST\([\s\S]*v_outstanding/i)
    expect(body).toMatch(/GREATEST\([\s\S]*v_paid_amount/i)
    expect(body).toMatch(/INSERT INTO public\.cod_adjustments/i)
    expect(body).not.toMatch(/INSERT INTO public\.(invoices|invoice_refunds)/i)
  })

  it('mantém a ordem POD atualizado → efeito financeiro nas duas funções pai de 310', () => {
    const codBody = functionBody(migration310, 'set_bl_cod')
    const restoreBody = functionBody(migration310, 'set_bl_transshipment')
    expect(codBody.indexOf('UPDATE public.bls SET pod = v_discharge')).toBeLessThan(codBody.indexOf('apply_cod_financial_effect'))
    expect(restoreBody.indexOf('UPDATE public.bls SET pod = v_original_pod')).toBeLessThan(restoreBody.indexOf('apply_cod_financial_effect'))
    expect(migration310).toMatch(/apply_cod_financial_effect\(p_bl_id, p_omission_id, v_old_pod\)/i)
  })
})

describeLocal('comportamento efetivo da reprecificação de COD no Postgres local', () => {
  const userId = '61000000-0000-0000-0000-000000000001'
  const customerId = 610001
  const carrierId = 610004
  const vesselId = 610005
  const oldTableId = 610006
  const newTableId = 610007
  const oldItemId = 610008
  const newItemId = 610009
  const voyageId = 610002
  const blId = 'COD-312-BL'
  const omissionId = 610003

  beforeAll(() => {
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'cod-312@example.test') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${userId}', 'COD 312', 'admin', true)
      ON CONFLICT (id) DO UPDATE SET active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '00610010000149', 'Cliente COD 312')
      ON CONFLICT (id) DO UPDATE SET cnpj_cpf = EXCLUDED.cnpj_cpf, name = EXCLUDED.name;
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES (${customerId}, 'Financeiro COD 312', 'financeiro-cod-312@example.test', 'financeiro', true)
      ON CONFLICT DO NOTHING;
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier COD 312') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel COD 312', ${carrierId}) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'COD-312', 'active') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.charge_tables (id, name, pod, cargo_mode, valid_from, active)
      VALUES
        (${oldTableId}, 'Tabela OLD COD 312', 'BRVIX', 'container', CURRENT_DATE, true),
        (${newTableId}, 'Tabela NEW COD 312', 'BRSSA', 'container', CURRENT_DATE, true)
      ON CONFLICT (id) DO UPDATE SET pod = EXCLUDED.pod, cargo_mode = EXCLUDED.cargo_mode, active = true;
      INSERT INTO public.charge_table_items
        (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, cargo_profile, manual_only, sort_order)
      VALUES
        (${oldItemId}, ${oldTableId}, 'Taxa OLD COD 312', 'bl', 100, 100, 'bl', 'any', false, 1),
        (${newItemId}, ${newTableId}, 'Taxa NEW COD 312', 'bl', 80, 80, 'bl', 'any', false, 1)
      ON CONFLICT (id) DO UPDATE SET charge_table_id = EXCLUDED.charge_table_id, unit_value_brl = EXCLUDED.unit_value_brl, active = true;
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pod, financial_status)
      VALUES ('${blId}', ${voyageId}, ${customerId}, 'container', 'BRVIX', 'invoiced')
      ON CONFLICT (id) DO UPDATE SET pod = EXCLUDED.pod, financial_status = EXCLUDED.financial_status;
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, reason)
      VALUES (${omissionId}, ${voyageId}, 'BRVIX', 'BRSSA', 'teste COD 312') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition)
      VALUES ('${blId}', ${omissionId}, 'transshipment') ON CONFLICT (bl_id, omission_id) DO UPDATE SET disposition = 'transshipment';
      DELETE FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};
      DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
      DELETE FROM public.invoice_bls WHERE bl_id = '${blId}';
      DELETE FROM public.invoices WHERE invoice_number = 'INV-312';
      INSERT INTO public.invoices (invoice_number, customer_id, bl_id, total_brl, status, total_paid_brl, balance_brl)
      VALUES ('INV-312', ${customerId}, '${blId}', 100, 'partially_paid', 10, 90)
      ON CONFLICT (invoice_number) DO UPDATE SET status = 'partially_paid', total_brl = 100, total_paid_brl = 10, balance_brl = 90;
      INSERT INTO public.invoice_bls (invoice_id, bl_id, subtotal_brl, financial_status_snapshot)
      SELECT id, '${blId}', 100, 'partially_paid' FROM public.invoices WHERE invoice_number = 'INV-312'
      ON CONFLICT (invoice_id, bl_id) DO NOTHING;
      DELETE FROM public.payments WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');
      INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at)
      SELECT id, 10, 'pix', now() FROM public.invoices WHERE invoice_number = 'INV-312';
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.cod_adjustments WHERE bl_id = '${blId}';
      DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');
      DELETE FROM public.invoice_bls WHERE bl_id = '${blId}';
      DELETE FROM public.invoices WHERE invoice_number = 'INV-312';
      DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
      DELETE FROM public.bl_transshipments WHERE bl_id = '${blId}';
      DELETE FROM public.voyage_omissions WHERE id = ${omissionId};
      DELETE FROM public.bls WHERE id = '${blId}';
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
    `)
  })

  it('cobre parcial, reversão simétrica, overpayment, pureza e privilégio do helper', () => {
    const invoicesBefore = psql("SELECT count(*) FROM public.invoices WHERE invoice_number = 'INV-312';")
    const refundsBefore = psql("SELECT count(*) FROM public.invoice_refunds WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');")

    const cod = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'Cliente confirmou COD 312', '${userId}')`,
    )
    expect(cod.status).toBe(0)
    expect(psql(`
      SELECT action || '|' || original_value_brl || '|' || new_destination_value_brl || '|' ||
        difference_brl || '|' || paid_amount_brl || '|' || outstanding_balance_brl || '|' ||
        offset_amount_brl || '|' || refund_amount_brl
      FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};
    `)).toBe('offset_open_balance|100.00|80.00|-20.00|10.00|90.00|20.00|0.00')
    expect(psql(`SELECT pod FROM public.bls WHERE id = '${blId}';`)).toBe('BRSSA')
    expect(psql("SELECT count(*) FROM public.invoices WHERE invoice_number = 'INV-312';")).toBe(invoicesBefore)
    expect(psql("SELECT count(*) FROM public.invoice_refunds WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');")).toBe(refundsBefore)

    const direct = callAsAuthenticated(
      userId,
      `SELECT public.apply_cod_financial_effect('${blId}', ${omissionId}, 'BRVIX')`,
    )
    expect(direct.status).not.toBe(0)
    expect(`${direct.stdout}\n${direct.stderr}`).toMatch(/permission denied|42501/i)
    const directWrite = callAsAuthenticated(
      userId,
      `INSERT INTO public.cod_adjustments (bl_id, omission_id, action) VALUES ('${blId}', ${omissionId}, 'offset_open_balance')`,
    )
    expect(directWrite.status).not.toBe(0)
    expect(`${directWrite.stdout}\n${directWrite.stderr}`).toMatch(/permission denied|42501|row-level security/i)

    const reversal = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_transshipment('${blId}', ${omissionId}, 'Navio 312', 'Carrier 312', 'VY-312', NULL, NULL, 'Reversão simétrica', '${userId}')`,
    )
    expect(reversal.status).toBe(0)
    expect(psql(`SELECT pod FROM public.bls WHERE id = '${blId}';`)).toBe('BRVIX')
    expect(psql(`SELECT action || '|' || original_value_brl || '|' || new_destination_value_brl || '|' || difference_brl FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};`)).toBe('complementary_invoice|80.00|100.00|20.00')

    psql(`
      UPDATE public.invoices SET status = 'partially_paid', total_paid_brl = 95, balance_brl = 5
      WHERE invoice_number = 'INV-312';
      DELETE FROM public.payments WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');
      INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at)
      SELECT id, 95, 'pix', now() FROM public.invoices WHERE invoice_number = 'INV-312';
    `)
    const overpayment = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'COD 312 com excedente', '${userId}')`,
    )
    expect(overpayment.status).toBe(0)
    expect(psql(`SELECT action || '|' || offset_amount_brl || '|' || refund_amount_brl FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};`)).toBe('refund_overpayment|5.00|15.00')

    const reverseOverpayment = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_transshipment('${blId}', ${omissionId}, 'Navio 312', 'Carrier 312', 'VY-312', NULL, NULL, 'Reverter excedente', '${userId}')`,
    )
    expect(reverseOverpayment.status).toBe(0)
    psql(`
      UPDATE public.invoices SET status = 'issued', total_paid_brl = 0, balance_brl = 100
      WHERE invoice_number = 'INV-312';
      DELETE FROM public.payments WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');
    `)
    const unpaid = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'COD 312 sem pagamento', '${userId}')`,
    )
    expect(unpaid.status).toBe(0)
    expect(psql(`SELECT action || '|' || manual_review_required FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};`)).toBe('cancel_and_reissue|true')

    const reverseUnpaid = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_transshipment('${blId}', ${omissionId}, 'Navio 312', 'Carrier 312', 'VY-312', NULL, NULL, 'Reverter sem pagamento', '${userId}')`,
    )
    expect(reverseUnpaid.status).toBe(0)
    psql(`
      UPDATE public.invoices SET status = 'paid', total_paid_brl = 100, balance_brl = 0
      WHERE invoice_number = 'INV-312';
      INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at)
      SELECT id, 100, 'pix', now() FROM public.invoices WHERE invoice_number = 'INV-312';
    `)
    const fullyPaid = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'COD 312 pago integralmente', '${userId}')`,
    )
    expect(fullyPaid.status).toBe(0)
    expect(psql(`SELECT action || '|' || paid_amount_brl || '|' || offset_amount_brl || '|' || refund_amount_brl FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};`)).toBe('refund_overpayment|100.00|0.00|20.00')

    const reverseFullyPaid = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_transshipment('${blId}', ${omissionId}, 'Navio 312', 'Carrier 312', 'VY-312', NULL, NULL, 'Reverter pago integralmente', '${userId}')`,
    )
    expect(reverseFullyPaid.status).toBe(0)
    psql(`
      DELETE FROM public.payments WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-312');
      DELETE FROM public.invoice_bls WHERE bl_id = '${blId}';
      DELETE FROM public.invoices WHERE invoice_number = 'INV-312';
      UPDATE public.bls SET financial_status = 'pending', charge_status = 'not_calculated', pod = 'BRVIX' WHERE id = '${blId}';
      DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
      INSERT INTO public.charge_calculations
        (bl_id, source, status, calculation_key, quantity, total_value_brl, created_by)
      VALUES ('${blId}', 'manual', 'reviewed', 'manual:312', 1, 30, '${userId}');
    `)
    const manual = callAsAuthenticated(
      userId,
      `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'COD 312 com linha manual', '${userId}')`,
    )
    expect(manual.status).toBe(0)
    expect(psql(`SELECT action || '|' || manual_review_required FROM public.cod_adjustments WHERE bl_id = '${blId}' AND omission_id = ${omissionId};`)).toBe('manual_charge_review|true')
    expect(psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}' AND source = 'manual';`)).toBe('1')

    const pureBefore = psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}';`)
    psql(`BEGIN; SELECT count(*) FROM public.resolve_bl_local_charge_items('${blId}', 'BRVIX'); ROLLBACK;`)
    expect(psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}';`)).toBe(pureBefore)
  })
})
