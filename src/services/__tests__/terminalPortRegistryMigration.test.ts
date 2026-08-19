import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/306_escala_multiplos_terminais.sql'),
  'utf8',
)

describe('contrato SQL do cadastro de terminais por porto', () => {
  it('liga terminal portuário ao porto e mantém depot comum sem porto', () => {
    expect(sql).toMatch(/ALTER TABLE public\.depots[\s\S]+ADD COLUMN IF NOT EXISTS port_id BIGINT/i)
    expect(sql).toContain('port_id BIGINT REFERENCES public.ports(id) ON DELETE RESTRICT')
    expect(sql).toMatch(/tipo = 'terminal_portuario'[\s\S]+tipo = 'depot' AND port_id IS NULL/i)
    expect(sql).toContain('CREATE TRIGGER validate_depot_terminal_port')
    expect(sql).toContain('Novo terminal portuario exige porto brasileiro.')
    expect(sql).toMatch(/UNIQUE \(id, port_id\)/i)
    expect(sql).toContain('idx_depots_port_id_active')
  })

  it('normaliza código antes da unicidade e bloqueia exclusão referenciada', () => {
    expect(sql).toContain('UPDATE public.depots')
    expect(sql).toContain('upper(btrim(code))')
    expect(sql).toContain('depots_code_normalized_key')
    expect(sql).toContain('depots_code_normalized_check')
    expect(sql).toContain('CREATE TRIGGER normalize_depot_code')
    expect(sql).toContain('ON DELETE RESTRICT')
    expect(sql).toContain('active')
  })

  it('não permite atribuição nova para terminal inativo e preserva histórico', () => {
    expect(sql).toMatch(/IF NOT v_current_terminal_assignment AND NOT v_depot\.active THEN[\s\S]+Terminal inativo/i)
    expect(sql).toContain('v_existing_terminal_state')
    expect(sql).toMatch(/status = 'closed'[\s\S]+closed_blockers/i)
    expect(sql).toContain('terminal_id IS NULL')
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.depots/i)
  })
})
