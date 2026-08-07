import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('drop auto-promote bl ready trigger migration (263)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/263_drop_auto_promote_bl_ready_trigger.sql'),
    'utf8',
  )

  it('drops the trigger and its function', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_promote_calculated_bl_ready ON public.bls')
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.promote_calculated_bl_ready_for_billing()')
  })
})
