import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 242 — validação de unidade manual', () => {
  it('rejeita datas de depot inválidas no mesmo contrato do import', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/242_validate_manual_vazios_bookings.sql'), 'utf8')
    expect(sql).toContain("NEW.hand_out_date < NEW.hand_in_date")
    expect(sql).toContain("v_local_tipo = 'depot'")
  })
})
