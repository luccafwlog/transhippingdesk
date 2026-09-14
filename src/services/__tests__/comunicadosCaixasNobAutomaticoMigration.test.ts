import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/045_comunicados_caixas_e_nob_automatico.sql'), 'utf8')

describe('migration 045 — roteamento por caixa e NOB automático', () => {
  it('substitui a produtora que o cron realmente chama', () => {
    // A 008 corrigiu a sósia morta (find_due_customer_communication_automations)
    // e deixou a viva no modelo antigo. Esta migration corrige a viva.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.evaluate_and_dispatch_automatic_communications/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.evaluate_and_dispatch_automatic_communications\(TIMESTAMPTZ\) TO service_role/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.evaluate_and_dispatch_automatic_communications\(TIMESTAMPTZ\) FROM PUBLIC, anon, authenticated/i)
  })

  it('roteia avisos operacionais somente para a caixa Documentação e Operação', () => {
    const noaNor = sql.slice(sql.indexOf('-- NOA/NOR'), sql.indexOf('-- CE Mercante'))
    expect(noaNor).toMatch(/JOIN public\.customer_contact_box_links/i)
    expect(noaNor).toMatch(/box_code = 'documentacao_operacao'/i)
    expect(noaNor).toMatch(/cc\.deactivated_at IS NULL/i)
    // O opt-out legado por Natureza continua respeitado: a caixa soma, não afrouxa.
    expect(noaNor).toMatch(/customer_contact_preferences[\s\S]*?nature = 'avisos_operacionais'[\s\S]*?enabled = false/i)
  })

  it('roteia o comunicado financeiro para as duas caixas que o servem', () => {
    const ce = sql.slice(sql.indexOf('-- CE Mercante'), sql.indexOf('-- NOB'))
    expect(ce).toMatch(/JOIN public\.customer_contact_box_links/i)
    expect(ce).toMatch(/box_code IN \('documentacao_operacao', 'financeiro'\)/i)
  })

  it('deriva a frente de operação do cargo_mode do B/L', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.bl_operation_front_modalidade\(p_cargo_mode text\)/i)
    expect(sql).toMatch(/IMMUTABLE/i)
    expect(sql).toMatch(/WHEN 'carga_solta' THEN 'carga_solta'/i)
    expect(sql).toMatch(/WHEN 'veiculo' THEN 'veiculo'/i)
    expect(sql).toMatch(/WHEN 'veiculos' THEN 'veiculo'/i)
    expect(sql).toMatch(/ELSE 'carga_cheia'/i)
  })

  it('produz NOB por Atracação, restrito à carga da frente atribuída àquele terminal', () => {
    const nob = sql.slice(sql.indexOf('-- NOB'))
    // Âncora é o UUID da linha de estado do terminal, nunca o UUID do terminal.
    expect(nob).toMatch(/ts\.id AS state_id/i)
    expect(nob).toMatch(/'anchor_atracacao_id', v_atracacao\.state_id/i)
    expect(nob).toMatch(/ts\.terminal_atb IS NOT NULL/i)
    // Só clientes cuja carga pertence a uma frente atribuída a ESTE terminal.
    expect(nob).toMatch(/public\.voyage_escala_operation_fronts/i)
    expect(nob).toMatch(/f\.terminal_id = v_atracacao\.terminal_id/i)
    expect(nob).toMatch(/f\.sentido = 'importacao'/i)
    expect(nob).toMatch(/public\.bl_operation_front_modalidade\(b\.cargo_mode\)/i)
    // Mesmo roteamento por caixa dos demais avisos operacionais.
    expect(nob).toMatch(/box_code = 'documentacao_operacao'/i)
  })

  it('não reenvia NOB já enviado para a mesma atracação e respeita escala excluída/omitida', () => {
    const nob = sql.slice(sql.indexOf('-- NOB'))
    expect(nob).toMatch(/sent\.kind = 'aviso_atracacao_nob'[\s\S]*?sent\.anchor_atracacao_id = v_atracacao\.state_id/i)
    expect(nob).toMatch(/field_name = 'deleted'/i)
    expect(nob).toMatch(/field_name = 'omitted'/i)
  })

  it('NOR e NOB não têm teto de idade do marco: o gatilho é o registro', () => {
    // Um número fixo é aposta sobre a velocidade de um processo humano e
    // descarta em silêncio a atracação de sexta lançada na segunda. Envio
    // repetido é barrado pela idempotência, não por janela.
    const nob = sql.slice(sql.indexOf('-- NOB'))
    expect(nob).toMatch(/ts\.terminal_atb <= v_as_of/i)
    expect(nob).not.toMatch(/terminal_atb >= v_as_of - interval/i)

    const noaNor = sql.slice(sql.indexOf('-- NOA/NOR'), sql.indexOf('-- CE Mercante'))
    expect(noaNor).toMatch(/l\.ata IS NOT NULL AND l\.ata <= v_as_of/i)
    expect(noaNor).not.toMatch(/l\.ata BETWEEN v_as_of - interval/i)
  })

  it('o NOA mantém a janela, que é a definição do comunicado e não guarda de idade', () => {
    const noaNor = sql.slice(sql.indexOf('-- NOA/NOR'), sql.indexOf('-- CE Mercante'))
    expect(noaNor).toMatch(/v_as_of >= l\.eta - interval '5 days' AND v_as_of < l\.eta/i)
  })

  it('marca a sósia morta para que a correção não caia nela de novo', () => {
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.find_due_customer_communication_automations/i)
  })
})
