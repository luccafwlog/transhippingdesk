import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/371_importacao_captura_contato_do_manifesto.sql'),
  'utf8',
)

// Contrato da 371. O comportamento foi provado contra um Postgres real antes do
// commit (captura unica para varios B/Ls do mesmo manifesto, reimport sem
// duplicata, B/L sem cliente sem contato orfao); estes testes travam as
// decisoes no arquivo.
describe('migration 371 — a importacao volta a capturar o contato do manifesto', () => {
  it('captura pela funcao unica da 370, sem copiar a regra', () => {
    expect(sql).toContain('PERFORM public.capture_manifest_financial_contact(alvo.customer_id, alvo.email)')
    expect(sql).not.toContain('INSERT INTO public.customer_contacts')
  })

  // O laco de pendencias faz CONTINUE quando o B/L nao tem pendencia — que e o
  // caso do vinculo automatico por CNPJ, o que mais precisa da captura.
  it('captura antes do laco de pendencias, nao dentro dele', () => {
    const captura = sql.indexOf('PERFORM public.capture_manifest_financial_contact')
    const laco = sql.indexOf('FOR v_bl IN')
    expect(captura).toBeGreaterThan(-1)
    expect(laco).toBeGreaterThan(-1)
    expect(captura).toBeLessThan(laco)
  })

  it('so captura de B/L com cliente vinculado e e-mail preenchido', () => {
    expect(sql).toContain('AND b.customer_id IS NOT NULL')
    expect(sql).toContain("AND NULLIF(btrim(COALESCE(b.manifest_customer_email, '')), '') IS NOT NULL")
  })

  // Varios B/Ls do mesmo manifesto trazem o mesmo cliente e o mesmo e-mail: sem
  // DISTINCT, as chamadas da mesma instrucao nao enxergam a linha que a anterior
  // inseriu e o NOT EXISTS interno deixaria passar duplicata.
  it('deduplica cliente e e-mail na propria consulta', () => {
    expect(sql).toContain('SELECT DISTINCT b.customer_id, lower(btrim(b.manifest_customer_email)) AS email')
  })

  it('preserva o gate canonico, a auditoria e a sincronizacao da fila da 129', () => {
    expect(sql).toContain('v_reasons := public.compute_bl_review_pendencies(v_bl.id);')
    expect(sql).toContain("SET\n      review_status = 'pending_review',")
    expect(sql).toContain("'Gate canonico aplicado apos importacao'")
    expect(sql).toContain('PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);')
    expect(sql).toContain('RAISE EXCEPTION \'Usuario sem permissao ativa para aplicar gate de importacao.\'')
  })

  it('mantem assinatura e grants da funcao recriada', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.apply_bl_review_gate_after_import(')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.apply_bl_review_gate_after_import(TEXT[], UUID) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.apply_bl_review_gate_after_import(TEXT[], UUID) TO authenticated;')
  })
})
