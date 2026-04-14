import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const enabled = process.env.SUPABASE_RUN_INTEGRATION === '1'
const describeIntegration = enabled ? describe : describe.skip

type IntegrationEnv = {
  url: string
  anonKey: string
  email: string
  password: string
  voyageId: number
  blId: string
  blIdWithCe?: string | null
  operatorEmail?: string | null
  operatorPassword?: string | null
}

let client: SupabaseClient<Database>
let env: IntegrationEnv
let userId: string
const operatorRlsTest = hasOperatorCredentials() ? it : it.skip

describeIntegration('supabase integration - hardening gate', () => {
  beforeAll(async () => {
    env = loadEnv()
    client = createClient<Database>(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await client.auth.signInWithPassword({
      email: env.email,
      password: env.password,
    })
    if (error || !data.user) {
      throw new Error(`Falha no login de integracao: ${error?.message ?? 'usuario sem sessao'}`)
    }
    userId = data.user.id
  })

  afterAll(async () => {
    if (!client) return
    await client.auth.signOut()
  })

  it('import_manifest_transactional rejeita hash duplicado (23505)', async () => {
    const hash = `it-dup-${Date.now()}`

    const first = await client.rpc('import_manifest_transactional', {
      p_filename: `${hash}.xlsx`,
      p_voyage_id: env.voyageId,
      p_uploaded_by: userId,
      p_cargo_mode: 'container',
      p_file_hash: hash,
      p_total_bls: 0,
      p_total_containers: 0,
      p_bls: [],
      p_containers: [],
      p_errors: [],
    })

    expect(first.error).toBeNull()
    expect(typeof first.data).toBe('number')

    const second = await client.rpc('import_manifest_transactional', {
      p_filename: `${hash}.xlsx`,
      p_voyage_id: env.voyageId,
      p_uploaded_by: userId,
      p_cargo_mode: 'container',
      p_file_hash: hash,
      p_total_bls: 0,
      p_total_containers: 0,
      p_bls: [],
      p_containers: [],
      p_errors: [],
    })

    expect(second.data).toBeNull()
    expect(second.error?.code).toBe('23505')
  })

  it('import_manifest_transactional aciona rate limit (P0429)', async () => {
    let limited = false

    for (let index = 0; index < 8; index += 1) {
      const hash = `it-rate-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`
      const result = await client.rpc('import_manifest_transactional', {
        p_filename: `${hash}.xlsx`,
        p_voyage_id: env.voyageId,
        p_uploaded_by: userId,
        p_cargo_mode: 'container',
        p_file_hash: hash,
        p_total_bls: 0,
        p_total_containers: 0,
        p_bls: [],
        p_containers: [],
        p_errors: [],
      })

      if (result.error?.code === 'P0429') {
        limited = true
        break
      }

      if (result.error) {
        throw new Error(`Erro inesperado no teste de rate limit: ${result.error.code} ${result.error.message}`)
      }
    }

    expect(limited).toBe(true)
  })

  it('save_bl_review aplica optimistic lock e retorna 40001 em timestamp stale', async () => {
    const result = await client.rpc('save_bl_review', {
      p_bl_id: env.blId,
      p_expected_updated_at: '2000-01-01T00:00:00.000Z',
      p_update_payload: {},
      p_audit_rows: [],
      p_changed_by: userId,
    })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe('40001')
  })

  it('apply_ce_mercante_update retorna unchanged quando CE nao muda', async () => {
    if (!env.blIdWithCe) return

    const current = await client.from('bls').select('ce_mercante').eq('id', env.blIdWithCe).single()
    if (current.error) {
      throw new Error(`Falha ao consultar CE atual: ${current.error.message}`)
    }

    const ce = String(current.data?.ce_mercante ?? '').trim()
    if (!ce) return

    const result = await client.rpc('apply_ce_mercante_update', {
      p_bl_id: env.blIdWithCe,
      p_new_ce: ce,
      p_changed_by: userId,
    })

    expect(result.error).toBeNull()
    expect(result.data).toBe('unchanged')
  })

  operatorRlsTest('RLS financeiro bloqueia leitura de invoices para operador', async () => {
    const operatorClient = createClient<Database>(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const login = await operatorClient.auth.signInWithPassword({
      email: String(env.operatorEmail),
      password: String(env.operatorPassword),
    })

    if (login.error || !login.data.user) {
      throw new Error(`Falha no login do operador de integracao: ${login.error?.message ?? 'sem sessao'}`)
    }

    const invoices = await operatorClient.from('invoices').select('id').limit(1)
    expect(invoices.error?.code).toBe('42501')

    await operatorClient.auth.signOut()
  })
})

function hasOperatorCredentials() {
  return Boolean(process.env.SUPABASE_OPERATOR_EMAIL && process.env.SUPABASE_OPERATOR_PASSWORD)
}

function loadEnv(): IntegrationEnv {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.SUPABASE_INTEGRATION_EMAIL
  const password = process.env.SUPABASE_INTEGRATION_PASSWORD
  const voyageIdRaw = process.env.SUPABASE_TEST_VOYAGE_ID
  const blId = process.env.SUPABASE_TEST_BL_ID

  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
  if (!anonKey) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
  if (!email) missing.push('SUPABASE_INTEGRATION_EMAIL')
  if (!password) missing.push('SUPABASE_INTEGRATION_PASSWORD')
  if (!voyageIdRaw) missing.push('SUPABASE_TEST_VOYAGE_ID')
  if (!blId) missing.push('SUPABASE_TEST_BL_ID')

  if (missing.length > 0) {
    throw new Error(
      `Variaveis obrigatorias para testes de integracao ausentes: ${missing.join(', ')}. Defina-as e rode: SUPABASE_RUN_INTEGRATION=1 npm run test:integration`,
    )
  }

  const voyageId = Number(voyageIdRaw)
  if (!Number.isInteger(voyageId) || voyageId <= 0) {
    throw new Error('SUPABASE_TEST_VOYAGE_ID deve ser inteiro positivo.')
  }

  return {
    url: String(url),
    anonKey: String(anonKey),
    email: String(email),
    password: String(password),
    voyageId,
    blId: String(blId),
    blIdWithCe: process.env.SUPABASE_TEST_BL_ID_WITH_CE ?? null,
    operatorEmail: process.env.SUPABASE_OPERATOR_EMAIL ?? null,
    operatorPassword: process.env.SUPABASE_OPERATOR_PASSWORD ?? null,
  }
}
