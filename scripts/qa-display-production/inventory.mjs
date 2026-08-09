import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { EXTERNAL_SIDE_EFFECTS_DISABLED, FIXTURE_CODE, FIXTURE_PREFIX, PROTECTED_TABLES, assertFixtureConfig } from './fixture-config.mjs'

const TABLES = [
  'voyages', 'vessels', 'voyage_scales', 'customers', 'bls', 'bl_containers',
  'baplie_containers', 'vehicles', 'breakbulk_manifests', 'granite_bls',
  'vazios_bookings', 'vazios_importacao_containers', 'vazios_export_operations',
  'invoices', 'bl_receivables', 'ledger_settlements', 'demurrage_invoices',
  'customer_portal_accounts', 'portal_notifications', 'audit_logs',
]

export async function countTable(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

export async function createInventory(client) {
  assertFixtureConfig()
  const counts = {}
  for (const table of TABLES) counts[table] = await countTable(client, table)
  return {
    generatedAt: new Date().toISOString(),
    fixturePrefix: FIXTURE_PREFIX,
    fixtureCode: FIXTURE_CODE,
    protectedTables: [...PROTECTED_TABLES],
    externalSideEffectsDisabled: EXTERNAL_SIDE_EFFECTS_DISABLED,
    counts,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required')
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: session, error: authError } = await client.auth.signInWithPassword({
    email: process.env.SUPABASE_INTEGRATION_EMAIL,
    password: process.env.SUPABASE_INTEGRATION_PASSWORD,
  })
  if (authError) throw authError
  const inventory = await createInventory(client)
  await fs.mkdir('artifacts/qa-display-production', { recursive: true })
  await fs.writeFile('artifacts/qa-display-production/inventory.json', `${JSON.stringify({ userId: session.user.id, ...inventory }, null, 2)}\n`)
  console.log(JSON.stringify({ ...inventory, userId: session.user.id }, null, 2))
}
