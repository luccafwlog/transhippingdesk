import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/370_revisao_efeito_completo_conciliacao.sql'),
  'utf8',
)

// Contrato da 370 (ADR 0061, item 1 da #639). O comportamento foi provado
// contra um Postgres real antes do commit — captura normalizada, sem
// duplicata, approved_by gravado; estes testes travam o contrato do arquivo
// para que uma edicao futura nao desfaca a decisao em silencio.
describe('migration 370 — a Revisao produz o efeito completo da conciliacao', () => {
  it('cria a regra de captura como funcao unica, fechada a chamada direta', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.capture_manifest_financial_contact(')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.capture_manifest_financial_contact(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;',
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.capture_manifest_financial_contact\(BIGINT, TEXT\) TO authenticated/i,
    )
  })

  it('normaliza o e-mail e nao duplica contato ja cadastrado', () => {
    expect(sql).toContain("v_email := lower(NULLIF(TRIM(COALESCE(p_email, '')), ''));")
    expect(sql).toContain('WHERE NOT EXISTS (')
    expect(sql).toContain('AND lower(trim(cc.email)) = v_email')
    expect(sql).toContain("SELECT p_customer_id, 'Contato manifesto', v_email, 'financeiro', false")
  })

  // O ponto da entrega: os dois caminhos produzem o MESMO efeito. Uma copia
  // inline em qualquer um deles divergiria na primeira alteracao.
  it('faz os dois caminhos chamarem a mesma funcao, sem copia inline', () => {
    expect(sql).toContain('PERFORM public.capture_manifest_financial_contact(')
    expect(sql.match(/PERFORM public\.capture_manifest_financial_contact\(/g)).toHaveLength(2)
    expect(sql).not.toContain('INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)\n    SELECT v_target_customer_id')
  })

  it('captura na Revisao apenas quando um cliente e de fato vinculado', () => {
    expect(sql).toContain("IF p_update_payload ? 'customer_id' AND v_next_customer_id IS NOT NULL THEN")
    expect(sql).toContain('PERFORM public.capture_manifest_financial_contact(v_next_customer_id, v_manifest_email);')
  })

  // `approved_by` fica no save_bl_review, nao no sync: o sync tambem roda na
  // importacao, onde nao ha revisor humano decidindo coisa alguma.
  it('grava o revisor que resolveu, sem sobrescrever um approved_by anterior', () => {
    expect(sql).toContain('SET approved_by = COALESCE(q.approved_by, p_changed_by)')
    expect(sql).toContain("AND q.status = 'approved'")
    expect(sql).toContain('RETURNING q.manifest_customer_email INTO v_manifest_email;')
  })

  it('preserva assinatura, gates e grants das duas RPCs recriadas', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.save_bl_review(')
    expect(sql).toContain("RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';")
    expect(sql).toContain('OR p_changed_by IS DISTINCT FROM auth.uid() THEN')
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) TO authenticated;',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;',
    )
  })

  // A 358 e a definicao viva do save_bl_review: recria-la aqui nao pode perder
  // nenhum campo que a revisao ja gravava.
  it('nao perde nenhum campo que a 358 ja gravava no save_bl_review', () => {
    const previous = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/358_bl_ncm_codes.sql'),
      'utf8',
    )
    const start = previous.indexOf('CREATE OR REPLACE FUNCTION public.save_bl_review(')
    const body = previous.slice(start, previous.indexOf('$function$;', start))
    const assignments = [...body.matchAll(/^\s{4}([a-z_]+)\s+=\s/gm)].map((match) => match[1])

    expect(assignments.length).toBeGreaterThan(15)
    for (const field of new Set(assignments)) {
      expect(sql, `campo ausente no save_bl_review recriado: ${field}`).toContain(`    ${field} `)
    }
  })
})
