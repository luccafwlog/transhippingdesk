import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/201_voyage_omission_global_transshipment.sql')
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''

describe('migration do registro global de transbordo', () => {
  it('promove os campos onward para voyage_omissions e faz backfill por omissao', () => {
    expect(migration).toMatch(/ALTER TABLE public\.voyage_omissions[\s\S]*ADD COLUMN IF NOT EXISTS onward_vessel_name TEXT[\s\S]*onward_eta TIMESTAMPTZ/i)
    expect(migration).toMatch(/UPDATE public\.voyage_omissions vo SET[\s\S]*array_agg\(onward_vessel_name ORDER BY id\)[\s\S]*FROM public\.bl_transshipments/i)
  })

  it('atualiza o registro global com guarda ativa e audita viagem e B/Ls', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.update_voyage_omission/i)
    expect(migration).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\)[\s\S]*p_changed_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(migration).toMatch(/UPDATE public\.voyage_omissions SET[\s\S]*onward_vessel_name[\s\S]*reason/i)
    expect(migration).toMatch(/VALUES \('voyage',[\s\S]*'transshipment_info'[\s\S]*'Informacoes de Transbordo complementadas'/i)
    expect(migration).toMatch(/SELECT 'bls', bt\.bl_id, 'transshipment_info'[\s\S]*FROM public\.bl_transshipments bt/i)
  })

  it('nao notifica ao complementar e restringe EXECUTE ao authenticated', () => {
    const updateRpc = migration.match(/CREATE OR REPLACE FUNCTION public\.update_voyage_omission[\s\S]*?\$function\$;/i)?.[0] ?? ''
    expect(updateRpc).not.toMatch(/portal_notifications/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.update_voyage_omission\([\s\S]*FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.update_voyage_omission\([\s\S]*TO authenticated/i)
  })
})
