import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const dataDir = path.join(import.meta.dirname, 'data')
const reportPath = path.join(import.meta.dirname, 'project-integration-validation.json')
const port = 55432
const adminId = '22222222-2222-4222-8222-222222222222'
const portalUserId = '33333333-3333-4333-8333-333333333333'
const operatorId = '44444444-4444-4444-8444-444444444444'
const email = 'integration-admin@example.test'
const operatorEmail = 'integration-operator@example.test'
const password = 'integration-local-only'
const portalEmail = 'integration-customer@example.test'

const database = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
  onError: (message) => console.error(message),
})

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function waitForShim(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Supabase shim did not start')), 15_000)
    const onData = (chunk) => {
      const text = String(chunk)
      process.stdout.write(chunk)
      if (text.includes('sb-shim listening')) {
        clearTimeout(timeout)
        child.stdout.off('data', onData)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Supabase shim exited before readiness (${code})`))
    })
  })
}

async function seed(client) {
  await client.query('BEGIN')
  try {
    await client.query(
      `
        INSERT INTO auth.users (
          id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin,
          created_at, updated_at, is_anonymous
        )
        VALUES (
          $1, 'authenticated', 'authenticated', $2,
          extensions.crypt($3, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, now(), now(), false
        )
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email, encrypted_password = EXCLUDED.encrypted_password
      `,
      [adminId, email, password],
    )
    await client.query(
      `
        INSERT INTO public.user_profiles (id, full_name, role, active)
        VALUES ($1, 'Integration Admin', 'admin', true)
        ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = true
      `,
      [adminId],
    )
    await client.query(
      `
        INSERT INTO auth.users (
          id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin,
          created_at, updated_at, is_anonymous
        )
        VALUES (
          $1, 'authenticated', 'authenticated', $2,
          extensions.crypt($3, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, now(), now(), false
        )
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email, encrypted_password = EXCLUDED.encrypted_password
      `,
      [operatorId, operatorEmail, password],
    )
    await client.query(
      `
        INSERT INTO public.user_profiles (id, full_name, role, active)
        VALUES ($1, 'Integration Operator', 'operator', true)
        ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = true
      `,
      [operatorId],
    )

    const carrier = await client.query(
      `INSERT INTO public.carriers (name, scac)
       VALUES ('INTEGRATION CARRIER', 'ITST')
       RETURNING id`,
    )
    const carrierId = Number(carrier.rows[0].id)
    const pol = await client.query(
      `INSERT INTO public.ports (name, locode, country)
       VALUES ('Integration Shanghai', 'CNSHA', 'CN')
       RETURNING id`,
    )
    const pod = await client.query(
      `INSERT INTO public.ports (name, locode, country)
       VALUES ('Integration Vitoria', 'BRVIX', 'BR')
       RETURNING id`,
    )
    const vessel = await client.query(
      `INSERT INTO public.vessels (name, imo, carrier_id)
       VALUES ('INTEGRATION VESSEL', '9888888', $1)
       RETURNING id`,
      [carrierId],
    )
    const voyage = await client.query(
      `INSERT INTO public.voyages (
        vessel_id, voyage_number, pol_id, pod_id, etd, eta, status
      )
      VALUES ($1, 'IT001E', $2, $3, now() - interval '5 days', now() + interval '5 days', 'active')
      RETURNING id`,
      [Number(vessel.rows[0].id), Number(pol.rows[0].id), Number(pod.rows[0].id)],
    )
    const voyageId = Number(voyage.rows[0].id)
    const customer = await client.query(
      `INSERT INTO public.customers (cnpj_cpf, name, city, state)
       VALUES ('88888888000188', 'INTEGRATION CUSTOMER', 'Vitoria', 'ES')
       RETURNING id`,
    )
    const customerId = Number(customer.rows[0].id)
    await client.query(
      `
        INSERT INTO auth.users (
          id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin,
          created_at, updated_at, is_anonymous
        )
        VALUES (
          $1, 'authenticated', 'authenticated', $2,
          extensions.crypt($3, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, now(), now(), false
        )
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email, encrypted_password = EXCLUDED.encrypted_password
      `,
      [portalUserId, portalEmail, password],
    )
    await client.query(
      `INSERT INTO public.customer_contacts (
        customer_id, name, email, purpose, is_primary
      )
      VALUES ($1, 'Integration Billing', $2, 'faturamento', true)`,
      [customerId, portalEmail],
    )
    await client.query(
      `INSERT INTO public.customer_portal_accounts (
        customer_id, contact_email, password_hash, active, created_by,
        auth_user_id, portal_email
      )
      VALUES (
        $1, $2, extensions.crypt($3, extensions.gen_salt('bf')), true, $4, $5, $2
      )`,
      [customerId, portalEmail, password, adminId, portalUserId],
    )

    await client.query(
      `
        INSERT INTO public.bls (
          id, voyage_id, customer_id, consignee, pol, pod,
          total_weight_kg, total_cbm, financial_status, review_status,
          cargo_mode, charge_status, customer_reconciliation_status,
          manifest_customer_cnpj_cpf, manifest_customer_name
        )
        VALUES (
          'QAIT001', $1, $2, 'INTEGRATION CUSTOMER', 'CNSHA', 'BRVIX',
          1000, 10, 'pending', 'ok', 'container', 'ready_for_billing',
          'matched_document', '88888888000188', 'INTEGRATION CUSTOMER'
        )
      `,
      [voyageId, customerId],
    )
    await client.query(
      `INSERT INTO public.bl_containers (
        bl_id, container_number, type, gross_weight_kg, cbm
      )
      VALUES ('QAIT001', 'QAIT1234567', '40HC', 1000, 10)`,
    )
    const chargeTable = await client.query(
      `INSERT INTO public.charge_tables (
        name, pod, carrier_id, valid_from, active, cargo_mode
      )
      VALUES (
        'INTEGRATION BRVIX', 'BRVIX', $1, CURRENT_DATE - 1, true, 'container'
      )
      RETURNING id`,
      [carrierId],
    )
    const chargeTableId = Number(chargeTable.rows[0].id)
    await client.query(
      `UPDATE public.bls
       SET financial_status = 'pending', charge_status = 'ready_for_billing'
       WHERE id = 'QAIT001'`,
    )
    await client.query(
      `INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key,
        quantity, unit_value_brl, total_value_brl, notes, created_by
      )
      VALUES (
        'QAIT001', $1, 'auto', 'ready_for_billing', 'integration:seed',
        1, 10, 10, 'integration eligibility seed', $2
      )`,
      [chargeTableId, adminId],
    )

    await client.query('COMMIT')
    return { voyageId, blId: 'QAIT001' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
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
  let shim

  try {
    const fixture = await seed(client)
    shim = spawn(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'design-audit', 'sb-shim.cjs')],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_PATH: path.join(import.meta.dirname, 'node_modules'),
          PGPORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    shim.stderr.on('data', (chunk) => process.stderr.write(chunk))
    await waitForShim(shim)

    const env = {
      ...process.env,
      SUPABASE_RUN_INTEGRATION: '1',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'local-anon-key',
      SUPABASE_INTEGRATION_EMAIL: email,
      SUPABASE_INTEGRATION_PASSWORD: password,
      SUPABASE_OPERATOR_EMAIL: operatorEmail,
      SUPABASE_OPERATOR_PASSWORD: password,
      SUPABASE_TEST_VOYAGE_ID: String(fixture.voyageId),
      SUPABASE_TEST_BL_ID: fixture.blId,
      SUPABASE_TEST_BILLING_BL_IDS: fixture.blId,
    }
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm run test:integration']
      : ['run', 'test:integration']
    const result = await run(command, args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const report = {
      postgresVersion: (await client.query('SHOW server_version')).rows[0]?.server_version,
      environment: 'disposable local PostgreSQL + Supabase shim',
      exitCode: result.code,
      passed: result.code === 0,
      stdoutTail: result.stdout.split(/\r?\n/).slice(-30).join('\n'),
      stderrTail: result.stderr.split(/\r?\n/).slice(-30).join('\n'),
    }
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    if (result.code !== 0) process.exitCode = result.code ?? 1
  } finally {
    shim?.kill()
    await client.end()
    await database.stop()
  }
}

await main()
