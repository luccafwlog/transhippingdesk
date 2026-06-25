import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/128_review_gate_canonical_pendencies.sql',
  ),
  'utf8',
)

describe('review gate canonical pendencies migration', () => {
  it('cria a funcao canonica de pendencias', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(p_bl_id TEXT)')
    expect(sql).toContain('RETURNS TEXT[]')
  })

  it('bloqueia pelas quatro travas confirmadas', () => {
    expect(sql).toContain('Cliente nao vinculado')
    expect(sql).toContain('Cliente sem e-mail cadastrado')
    expect(sql).toContain('Acesso ao portal nao provisionado')
    expect(sql).toContain('Peso BB ausente')
  })

  it('checa e-mail em qualquer contato e portal ativo', () => {
    expect(sql).toContain('FROM public.customer_contacts c')
    expect(sql).toContain('NULLIF(btrim(c.email)')
    expect(sql).toContain('FROM public.customer_portal_accounts a')
    expect(sql).toContain('a.active = true')
  })

  it('nao usa CE Mercante como bloqueio do gate', () => {
    // CE Mercante e editavel, mas nunca entra no conjunto de pendencias que prende o B/L.
    const computeBody = sql.slice(
      sql.indexOf('FUNCTION public.compute_bl_review_pendencies'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies'),
    )
    expect(computeBody).not.toMatch(/array_append\(v_reasons[^)]*ce[_\s]*mercante/i)
  })

  it('save_bl_review recomputa o status pela funcao e nao confia no payload', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID)')
    expect(sql).toContain('RETURNS JSONB')
    expect(sql).toContain('v_reasons := public.compute_bl_review_pendencies(p_bl_id)')
    expect(sql).toMatch(/v_status := CASE WHEN COALESCE\(cardinality\(v_reasons\), 0\) = 0 THEN 'reviewed' ELSE 'pending_review' END/)
    // O review_status do payload nao pode mais ser aplicado cegamente no UPDATE de dados.
    expect(sql).not.toContain("review_status      = CASE WHEN p_update_payload ? 'review_status'")
  })

  it('retorna o estado recomputado para a UI', () => {
    expect(sql).toContain("'review_status', v_status")
    expect(sql).toContain("'pendencias', to_jsonb(v_reasons)")
  })

  it('preserva o lock otimista (PT409)', () => {
    expect(sql).toContain("USING ERRCODE = 'PT409'")
  })

  it('preserva notas humanas e so reescreve a string de pendencias da maquina', () => {
    expect(sql).toContain("b.notes ILIKE 'Pendencias de importacao:%'")
  })
})
