import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsPath = path.resolve(process.cwd(), 'supabase/migrations')
const migrations = fs.readdirSync(migrationsPath)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => fs.readFileSync(path.join(migrationsPath, file), 'utf8'))
  .join('\n')

describe('migration do registro global de transbordo', () => {
  it('mantém o scanner textual como rede secundária para o schema global', () => {
    expect(migrations).toContain('ALTER TABLE public.voyage_omissions')
    expect(migrations).toContain('ADD COLUMN IF NOT EXISTS onward_vessel_name TEXT')
    expect(migrations).toContain('ADD COLUMN IF NOT EXISTS onward_eta TIMESTAMPTZ')
    expect(migrations).toContain('UPDATE public.voyage_omissions vo SET')
    expect(migrations).toContain('array_agg(onward_vessel_name ORDER BY id)')
    expect(migrations).toContain('FROM public.bl_transshipments')
  })

  it('documenta no scanner a guarda e a auditoria da complementação global', () => {
    expect(migrations).toContain('CREATE OR REPLACE FUNCTION public.update_voyage_omission')
    expect(migrations).toContain('auth.uid() IS NULL OR NOT public.is_active_user()')
    expect(migrations).toContain('p_changed_by IS DISTINCT FROM auth.uid()')
    expect(migrations).toContain('UPDATE public.voyage_omissions SET')
    expect(migrations).toContain("VALUES ('voyage', v_voyage_id::text, 'transshipment_info'")
    expect(migrations).toContain("SELECT 'bls', bt.bl_id, 'transshipment_info'")
  })

  it('mantém no scanner o grant esperado da complementação global', () => {
    expect(migrations).toContain('GRANT EXECUTE ON FUNCTION public.update_voyage_omission')
    expect(migrations).toContain('TO authenticated')
    expect(migrations).toContain('REVOKE ALL ON FUNCTION public.update_voyage_omission')
  })
})
