import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrations = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', file), 'utf8'))
  .join('\n')
const portalMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/202_portal_global_transshipment.sql')
const portalMigration = fs.existsSync(portalMigrationPath) ? fs.readFileSync(portalMigrationPath, 'utf8') : ''

describe('contrato Portal do transbordo global', () => {
  it('estende portal_list_operation_bls com os campos globais da omissão', () => {
    expect(portalMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_operation_bls\(\)/i)
    expect(portalMigration).toMatch(/voyage_omissions/i)
    expect(portalMigration).toMatch(/onward_vessel_name[\s\S]*onward_eta/i)
  })

  it('preserva uma notificação na omissão, nenhuma na complementação e COD individual', () => {
    const updateRpc = migrations.match(/CREATE OR REPLACE FUNCTION public\.update_voyage_omission[\s\S]*?\$function\$;/i)?.[0] ?? ''
    expect(updateRpc).not.toMatch(/portal_notifications/i)
    expect(migrations).toMatch(/CREATE FUNCTION public\.omit_voyage_escala[\s\S]*INSERT INTO public\.portal_notifications/i)
    expect(migrations).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_cod[\s\S]*INSERT INTO public\.portal_notifications/i)
    expect(migrations).toMatch(/set_bl_cod[\s\S]*WHERE t\.bl_id = p_bl_id/i)
  })
})
