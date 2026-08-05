import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENCY_REPORT_SECTIONS, agencyReportSectionLabel } from '../agencyDepartureReport'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/253_adr_embarque_vazios_secao_unica.sql'),
  'utf8',
)

describe('migration 253 — Embarque de Vazios volta a ser uma seção só (ADR 0036)', () => {
  it('reduz o CHECK de seção às 6 seções vivas, sem operacao_patio', () => {
    const check = sql.match(/ADD CONSTRAINT agency_departure_report_signoffs_section_check CHECK \(section IN \([\s\S]*?\)\);/)?.[0] ?? ''
    expect(check).toContain("'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',")
    expect(check).toContain("'vazios_embarcados', 'vazios_descarregados'")
    expect(check).not.toContain("'operacao_patio'")
    expect(check).not.toContain("'ocorrencias'")
  })

  it('funde as resoluções de pátio em vazios_embarcados antes de apagar as linhas', () => {
    const insertIndex = sql.indexOf('INSERT INTO public.agency_departure_report_signoffs')
    const deleteIndex = sql.indexOf("DELETE FROM public.agency_departure_report_signoffs WHERE section = 'operacao_patio'")
    expect(insertIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(insertIndex)
    // Qualquer pendência mantém a seção pendente — a fusão não pode "assinar"
    // por ninguém o que ainda não foi resolvido.
    expect(sql).toMatch(/WHEN p\.state = 'pending' OR v\.state = 'pending' THEN 'pending'/)
    // Nenhuma observação escrita por Equipamentos se perde na fusão.
    expect(sql).toMatch(/concat_ws\(\s*E'\\n',/)
    // Um estado fundido 'pending' não pode herdar autor/data de nenhuma das
    // duas partes — "assinado por alguém, mas pendente" não é um estado que
    // o resto do modelo sabe representar.
    expect(sql).toMatch(/CASE WHEN state = 'pending' THEN NULL/)
  })

  it('tira operacao_patio do dono da seção, fechando a RPC para clientes desatualizados', () => {
    const owner = sql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_owner[\s\S]*?\$\$;/)?.[0] ?? ''
    expect(owner).toContain("WHEN 'vazios_embarcados' THEN 'equipamentos'")
    expect(owner).not.toContain("WHEN 'operacao_patio'")
    expect(owner).toContain('ELSE NULL')
  })

  it('mantém as chaves aposentadas legíveis, porque audit_logs e snapshots as guardam', () => {
    const label = sql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_label[\s\S]*?\$\$;/)?.[0] ?? ''
    expect(label).toContain("WHEN 'datas' THEN 'Escala'")
    expect(label).toContain("WHEN 'vazios_embarcados' THEN 'Embarque de vazios'")
    expect(label).toContain("WHEN 'operacao_patio' THEN 'Operação de pátio'")
    expect(label).toContain("WHEN 'ocorrencias' THEN 'Ocorrências'")
  })

  it('exige 6 seções nas duas funções que varrem o conjunto (assinatura e pendência)', () => {
    const listas = sql.match(/\('datas'\), \('carga_descarregada'\), \('carga_carregada'\), \('veiculos'\),\s*\('vazios_embarcados'\), \('vazios_descarregados'\)/g) ?? []
    expect(listas).toHaveLength(2)
    expect(sql).not.toMatch(/\('operacao_patio'\)/)
  })

  it('preserva o contrato da 251: POD e POL como fontes de ATD, POL com baseline', () => {
    const detect = sql.match(/CREATE OR REPLACE FUNCTION public\.detect_agency_report_pending[\s\S]*?\$function\$;/)?.[0] ?? ''
    expect(detect).toContain("entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')")
    expect(detect).toMatch(/changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00\+00'/)
    expect(detect).toContain("baseline_key = 'voyage_pol_schedule_atd'")
    expect(detect).toContain('SECURITY DEFINER')
    // A copy do alerta nomeia o departamento em pt-BR, como a 219 pretendia —
    // a lista de departamentos crua vinha desde a 225.
    expect(detect).toContain('agency_report_department_label(p.department)')
  })

  it('revoga anon e concede só a authenticated nas duas funções redefinidas', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_agency_report_department_signoff\(BIGINT, TEXT, TEXT, BOOLEAN, TEXT\) FROM PUBLIC, anon;/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_agency_report_department_signoff\(BIGINT, TEXT, TEXT, BOOLEAN, TEXT\) TO authenticated;/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.detect_agency_report_pending\(\) FROM PUBLIC, anon;/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.detect_agency_report_pending\(\) TO authenticated;/)
  })

  // Revisão pós-merge: a reescrita original de set_agency_report_department_signoff
  // trocou o mapeamento de role (admin->administrativo, operator->documentacao)
  // por is_admin()/current_user_role() cru, que rejeita quem antes podia assinar
  // (roles 'operator' e 'administrativo'). O gate precisa espelhar a 228.
  it('mantém o mapeamento de role (admin/operator) no gate de sign-off departamental', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.set_agency_report_department_signoff[\s\S]*?\$function\$;/)?.[0] ?? ''
    expect(fn).toMatch(/WHEN 'admin' THEN 'administrativo'/)
    expect(fn).toMatch(/WHEN 'operator' THEN 'documentacao'/)
    expect(fn).toMatch(/v_role NOT IN \('administrativo', p_department\)/)
    expect(fn).not.toContain('public.current_user_role()')
  })
})

describe('agencyReportSectionLabel', () => {
  it('preserva os rótulos definidos pela migration histórica', () => {
    const label = sql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_label[\s\S]*?\$\$;/)?.[0] ?? ''
    expect(label).toContain("WHEN 'carga_carregada' THEN 'Carga carregada'")
    expect(label).toContain("WHEN 'operacao_patio' THEN 'Operação de pátio'")
    expect(label).toContain("WHEN 'ocorrencias' THEN 'Ocorrências'")
  })

  it('devolve a chave crua para um valor desconhecido, como o ELSE do SQL', () => {
    expect(agencyReportSectionLabel('secao_inexistente')).toBe('secao_inexistente')
  })

  it('cobre todas as seções vivas — nenhuma seção fica sem rótulo', () => {
    for (const section of Object.keys(AGENCY_REPORT_SECTIONS)) {
      expect(agencyReportSectionLabel(section)).not.toBe(section)
    }
  })
})
