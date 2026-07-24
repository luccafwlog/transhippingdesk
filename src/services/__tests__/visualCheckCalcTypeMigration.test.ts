import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/236_fix_visual_check_calc_type.sql', 'utf8')

describe('migration 236', () => {
  it('reclassifica visual_check como serviço de quantidade', () => {
    expect(migration).toContain("SET calc_type = 'quantidade'")
    expect(migration).toContain("name = 'visual_check'")
    expect(migration).toContain("calc_type = 'fixo_por_container'")
  })

  it('não marca visual_check como sujeito a overtime', () => {
    expect(migration).toContain('subject_to_overtime = FALSE')
  })
})
