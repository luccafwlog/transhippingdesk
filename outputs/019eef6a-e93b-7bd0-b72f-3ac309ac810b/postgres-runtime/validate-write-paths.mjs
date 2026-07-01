import fs from 'node:fs/promises'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const dataDir = path.join(import.meta.dirname, 'data')
const reportPath = path.join(import.meta.dirname, 'write-path-validation.json')
const port = 55432
const actorId = '11111111-1111-4111-8111-111111111111'

const database = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
  onError: (message) => console.error(message),
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function scalar(client, text, values = []) {
  const result = await client.query(text, values)
  return result.rows[0] ? Object.values(result.rows[0])[0] : undefined
}

async function main() {
  await database.start()
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    database: 'app',
    user: 'postgres',
    password: 'postgres',
  })
  await client.connect()
  const checks = []

  try {
    await client.query('BEGIN')
    await client.query(
      `
        INSERT INTO auth.users (
          id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin,
          created_at, updated_at, is_anonymous
        )
        VALUES (
          $1, 'authenticated', 'authenticated', 'qa-admin@example.test', '',
          now(), '{}'::jsonb, '{}'::jsonb, false, now(), now(), false
        )
      `,
      [actorId],
    )
    await client.query(
      `INSERT INTO public.user_profiles (id, full_name, role, active)
       VALUES ($1, 'QA Admin', 'admin', true)`,
      [actorId],
    )

    const customer = await client.query(
      `INSERT INTO public.customers (cnpj_cpf, name, city)
       VALUES ('99999999000191', 'QA CUSTOMER', 'Vitoria')
       RETURNING id`,
    )
    const customerId = Number(customer.rows[0].id)

    const carrierId = Number(
      await scalar(
        client,
        `INSERT INTO public.carriers (name, scac) VALUES ('QA CARRIER', 'QACR') RETURNING id`,
      ),
    )
    const polId = Number(
      await scalar(
        client,
        `INSERT INTO public.ports (name, locode, country) VALUES ('Shanghai', 'CNSHA', 'CN') RETURNING id`,
      ),
    )
    const podId = Number(
      await scalar(
        client,
        `INSERT INTO public.ports (name, locode, country) VALUES ('Vitoria', 'BRVIX', 'BR') RETURNING id`,
      ),
    )
    const vessel = await client.query(
      `INSERT INTO public.vessels (name, imo, carrier_id)
       VALUES ('QA VESSEL', '9999999', $1) RETURNING id`,
      [carrierId],
    )
    const vesselId = Number(vessel.rows[0].id)
    const voyage = await client.query(
      `INSERT INTO public.voyages (vessel_id, voyage_number, pol_id, pod_id, ata)
       VALUES ($1, 'QA001E', $2, $3, '2026-06-01T10:00:00Z')
       RETURNING id`,
      [vesselId, polId, podId],
    )
    const voyageId = Number(voyage.rows[0].id)

    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: actorId, role: 'authenticated', email: 'qa-admin@example.test' }),
    ])
    await client.query('SET LOCAL ROLE authenticated')

    const customerUpdate = await scalar(
      client,
      `SELECT public.update_customer_with_audit($1, $2::jsonb, $3, $4)`,
      [customerId, JSON.stringify({ city: 'Serra', trade_name: 'QA Trade' }), actorId, 'QA atomic update'],
    )
    assert(customerUpdate === true, 'customer RPC did not report a change')
    assert(
      Number(
        await scalar(
          client,
          `SELECT count(*) FROM public.audit_logs
           WHERE entity_type = 'customer' AND entity_id = $1
             AND field_name IN ('city', 'trade_name')`,
          [String(customerId)],
        ),
      ) === 2,
      'customer update did not create both audit rows',
    )
    checks.push({ id: 'customer-update-audit', result: 'passed' })

    const scheduleRows = await client.query(
      `INSERT INTO public.vessel_schedules (vessel_name, voyage, display_order)
       VALUES ('QA SCHEDULE A', 'A1', 1), ('QA SCHEDULE B', 'B1', 2)
       RETURNING id, vessel_name`,
    )
    const scheduleA = scheduleRows.rows.find((row) => row.vessel_name === 'QA SCHEDULE A').id
    const scheduleB = scheduleRows.rows.find((row) => row.vessel_name === 'QA SCHEDULE B').id

    const reordered = await scalar(
      client,
      `SELECT public.reorder_vessel_schedules($1::jsonb)`,
      [JSON.stringify([{ id: scheduleA, display_order: 2 }, { id: scheduleB, display_order: 1 }])],
    )
    assert(Number(reordered) === 2, 'vessel reorder did not update both rows')
    assert(
      Number(
        await scalar(
          client,
          `SELECT display_order FROM public.vessel_schedules WHERE id = $1`,
          [scheduleB],
        ),
      ) === 1,
      'vessel reorder persisted the wrong order',
    )
    checks.push({ id: 'vessel-reorder-atomic', result: 'passed' })

    const archive = await scalar(
      client,
      `SELECT public.archive_vessel_schedule($1)`,
      [scheduleA],
    )
    assert(Boolean(archive?.archived_id), 'vessel archive did not return archived_id')
    assert(
      Number(await scalar(client, `SELECT count(*) FROM public.vessel_schedules WHERE id = $1`, [scheduleA])) === 0,
      'archived vessel remained active',
    )
    assert(
      Number(await scalar(client, `SELECT count(*) FROM public.ended_vessels WHERE original_id = $1`, [scheduleA])) === 1,
      'archived vessel snapshot was not created exactly once',
    )
    checks.push({ id: 'vessel-archive-atomic', result: 'passed' })

    const granitePayload = [
      {
        client_id: customerId,
        sequence: 1,
        booking_number: 'QA-BOOK-1',
        bl_number: 'QAGRN001',
        shipper_ref: 'QA-REF-1',
        vessel_voyage: 'QA VESSEL / QA001E',
        loading_port: 'CNSHA',
        discharge_port: 'BRVIX',
        shipper_name: 'QA SHIPPER',
        shipper_cnpj: '99999999000191',
        consignee_name: 'QA CUSTOMER',
        charter: null,
        shipper_m3: 12.5,
        shipper_weight_kg: 25000,
        blocks_qty: 10,
        received_blocks_qty: 10,
        final_m3: 12.5,
        real_weight_kg: 25000,
        stockyard: 'QA',
        remarks: null,
        partial_restriction: false,
        cosco_transport: null,
        fragile_blocks: 0,
        cssc_selection: null,
        cargo_readiness_date: '2026-05-20',
        phase: 'ready',
      },
      {
        client_id: customerId,
        sequence: 2,
        booking_number: 'QA-BOOK-2',
        bl_number: 'QAGRN002',
        shipper_ref: 'QA-REF-2',
        vessel_voyage: 'QA VESSEL / QA001E',
        loading_port: 'CNSHA',
        discharge_port: 'BRVIX',
        shipper_name: 'QA SHIPPER',
        shipper_cnpj: '99999999000191',
        consignee_name: 'QA CUSTOMER',
        charter: null,
        shipper_m3: 10,
        shipper_weight_kg: 20000,
        blocks_qty: 8,
        received_blocks_qty: 8,
        final_m3: 10,
        real_weight_kg: 20000,
        stockyard: 'QA',
        remarks: null,
        partial_restriction: false,
        cosco_transport: null,
        fragile_blocks: 0,
        cssc_selection: null,
        cargo_readiness_date: '2026-05-21',
        phase: 'ready',
      },
    ]
    const graniteImport = await scalar(
      client,
      `SELECT public.import_granite_manifest_transactional(
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb
      )`,
      [voyageId, 'QA VESSEL / QA001E', 'CNSHA', 'BRVIX', 2, 45000, actorId, JSON.stringify(granitePayload)],
    )
    assert(Number(graniteImport?.inserted_bls) === 2, 'Granite import did not insert both B/Ls')
    const graniteManifestId = graniteImport.manifest_id
    assert(
      Number(
        await scalar(
          client,
          `SELECT count(*) FROM public.granite_bls WHERE manifest_id = $1`,
          [graniteManifestId],
        ),
      ) === 2,
      'Granite manifest header and B/L count diverged',
    )
    checks.push({ id: 'granite-import-atomic', result: 'passed' })

    const graniteBlId = await scalar(
      client,
      `SELECT id FROM public.granite_bls WHERE manifest_id = $1 ORDER BY sequence LIMIT 1`,
      [graniteManifestId],
    )
    const invoice = await client.query(
      `INSERT INTO public.invoices (customer_id, total_brl, status, invoice_type)
       VALUES ($1, 100, 'issued', 'individual')
       RETURNING id`,
      [customerId],
    )
    const invoiceId = Number(invoice.rows[0].id)
    await client.query(
      `INSERT INTO public.invoice_granite_bls (invoice_id, granite_bl_id, subtotal_brl)
       VALUES ($1, $2, 100)`,
      [invoiceId, graniteBlId],
    )
    assert(
      (await scalar(client, `SELECT invoice_type FROM public.invoices WHERE id = $1`, [invoiceId])) === 'granite',
      'Granite invoice link did not classify the invoice',
    )
    checks.push({ id: 'granite-invoice-classification', result: 'passed' })

    await client.query(
      `INSERT INTO public.bls (
        id, voyage_id, customer_id, pol, pod, total_weight_kg, total_cbm,
        financial_status, review_status, charge_status, cargo_mode
      )
      VALUES (
        'QABLDATE1', $1, $2, 'CNSHA', 'BRVIX', 1000, 10,
        'pending', 'ok', 'not_calculated', 'container'
      )`,
      [voyageId, customerId],
    )
    const container = await client.query(
      `INSERT INTO public.bl_containers (bl_id, container_number, type)
       VALUES ('QABLDATE1', 'QATEST1234567', '40HC')
       RETURNING id`,
    )
    const containerId = Number(container.rows[0].id)
    assert(
      (await scalar(client, `SELECT discharge_date::text FROM public.bl_containers WHERE id = $1`, [containerId])) ===
        '2026-06-01',
      'initial ATA was not derived on container insert',
    )

    await client.query(
      `UPDATE public.voyages SET ata = '2026-06-03T10:00:00Z' WHERE id = $1`,
      [voyageId],
    )
    assert(
      (await scalar(client, `SELECT discharge_date::text FROM public.bl_containers WHERE id = $1`, [containerId])) ===
        '2026-06-03',
      'ATA correction was not propagated to derived discharge date',
    )
    checks.push({ id: 'ata-derived-date-propagation', result: 'passed' })

    await client.query(
      `SELECT public.update_container_demurrage_dates($1, $2, $3, $4, $5)`,
      [containerId, '2026-06-04', '2026-06-10', 'returned', 'QA date edit'],
    )
    assert(
      Number(
        await scalar(
          client,
          `SELECT count(*) FROM public.audit_logs
           WHERE entity_type = 'bl_container' AND entity_id = $1
             AND field_name IN ('discharge_date', 'return_date', 'demurrage_status')`,
          [String(containerId)],
        ),
      ) >= 3,
      'container date RPC did not audit each changed field',
    )
    await client.query(
      `UPDATE public.voyages SET ata = '2026-06-05T10:00:00Z' WHERE id = $1`,
      [voyageId],
    )
    assert(
      (await scalar(client, `SELECT discharge_date::text FROM public.bl_containers WHERE id = $1`, [containerId])) ===
        '2026-06-04',
      'ATA propagation overwrote a manually edited discharge date',
    )
    checks.push({ id: 'container-dates-audit-and-manual-preservation', result: 'passed' })

    const breakbulkBls = [{
      id: 'QA-BB-001',
      shipper: 'QA SHIPPER',
      consignee: 'QA CUSTOMER',
      notify_party: 'SAME AS CONSIGNEE',
      customer_id: customerId,
      manifest_customer_cnpj_cpf: '99999999000191',
      manifest_customer_name: 'QA CUSTOMER',
      customer_reconciliation_status: 'matched_document',
      customer_reconciliation_notes: 'QA',
      billing_hold_reason: null,
      pol: 'CNSHA',
      pod: 'BRVIX',
      cargo_description: 'QA BREAKBULK',
      total_weight_kg: 1000,
      total_cbm: 10,
      bb_machine_qty: 1,
      bb_packages_qty: 1,
      bb_packages_total: 1,
      bb_weight_ton: 1,
      review_status: 'ok',
      financial_status: 'pending',
      notes: null,
    }]
    const breakbulkItems = [{
      bl_id: 'QA-BB-001',
      item_description: 'QA MACHINE',
      package_qty: 1,
      package_unit: 'UN',
      gross_weight_kg: 1000,
      cbm: 10,
      marks: 'QA',
    }]

    await client.query('SAVEPOINT breakbulk_failure')
    try {
      await scalar(
        client,
        `SELECT public.import_breakbulk_manifest_transactional(
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, '[]'::jsonb
        )`,
        [
          'qa-breakbulk-failed.xlsx',
          voyageId,
          actorId,
          1,
          JSON.stringify(breakbulkBls),
          JSON.stringify([{ ...breakbulkItems[0], bl_id: 'MISSING-BL' }]),
        ],
      )
      throw new Error('breakbulk failure fixture unexpectedly succeeded')
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT breakbulk_failure')
    }
    assert(
      Number(await scalar(client, `SELECT count(*) FROM public.import_batches WHERE filename = 'qa-breakbulk-failed.xlsx'`)) === 0,
      'failed breakbulk import left an orphan batch',
    )

    const breakbulkResult = await scalar(
      client,
      `SELECT public.import_breakbulk_manifest_transactional(
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, '[]'::jsonb
      )`,
      [
        'qa-breakbulk.xlsx',
        voyageId,
        actorId,
        1,
        JSON.stringify(breakbulkBls),
        JSON.stringify(breakbulkItems),
      ],
    )
    assert(Number(breakbulkResult?.batch_id) > 0, 'breakbulk import did not return a batch')
    assert(
      Number(await scalar(client, `SELECT count(*) FROM public.bl_breakbulk_items WHERE bl_id = 'QA-BB-001'`)) === 1,
      'breakbulk import did not persist its item',
    )
    checks.push({ id: 'breakbulk-import-atomic', result: 'passed' })

    await client.query('RESET ROLE')
    await client.query('ROLLBACK')

    const report = {
      postgresVersion: (await client.query('SHOW server_version')).rows[0]?.server_version,
      fixturePersistence: 'rolled back',
      checks,
      passed: checks.length,
      failed: 0,
    }
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    try {
      await client.query('RESET ROLE')
      await client.query('ROLLBACK')
    } catch {}
    const report = {
      fixturePersistence: 'rolled back after failure',
      checks,
      passed: checks.length,
      failed: 1,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
        detail: error?.detail ?? null,
        hint: error?.hint ?? null,
      },
    }
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    console.error(JSON.stringify(report, null, 2))
    process.exitCode = 1
  } finally {
    await client.end()
    await database.stop()
  }
}

await main()
