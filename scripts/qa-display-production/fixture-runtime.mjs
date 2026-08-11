import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

export const FIXTURE_PATH = 'artifacts/qa-display-production/operational-fixture.json'
export const isMain = (metaUrl, argv1) => path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1)

export async function authClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  const email = process.env.SUPABASE_INTEGRATION_EMAIL
  const password = process.env.SUPABASE_INTEGRATION_PASSWORD
  if (!url || !key || !email || !password) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_INTEGRATION_EMAIL and SUPABASE_INTEGRATION_PASSWORD are required')
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { client, userId: data.user.id }
}

export async function readCatalog(path = FIXTURE_PATH) {
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

export async function writeCatalog(catalog, path = FIXTURE_PATH) {
  await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`)
  return catalog
}
