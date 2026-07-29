import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), 'utf8')

describe('contrato SQL do Embarque de Vazios ADR 0033', () => {
  it('reformula unidades e usa substituicao total atomica', () => {
    const sql = read('238_embarque_vazios_unidades.sql')
    expect(sql).toContain('local_id UUID')
    expect(sql).toContain("condition IN ('vazio', 'material')")
    expect(sql).toContain('DELETE FROM public.vazios_bookings')
    expect(sql).toContain('INSERT INTO public.vazios_bookings')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional')
  })

  it('declara linhas, percentual limitado, catalogo e RLS', () => {
    const sql = read('239_embarque_vazios_linhas_servico.sql') + read('240_depot_catalogo_sugerido.sql')
    expect(sql).toContain('vazios_export_service_lines')
    expect(sql).toContain('percentual IN (50, 100)')
    expect(sql).toContain('uq_vazios_storage_line_operation_local_condition')
    expect(sql).toContain("tipo IN ('depot', 'terminal_portuario')")
    expect(sql).toContain("natureza IN ('armazenagem', 'transporte', 'geral')")
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
  })
})
