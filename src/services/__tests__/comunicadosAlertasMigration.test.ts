import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/374_comunicados_alertas.sql'), 'utf8')

describe('migration 374 — alertas de Comunicados', () => {
  it('cataloga os quatro tipos com destinos e audiência corretos', () => {
    for (const type of ['comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente', 'cliente_contato_bounced_sem_alternativa']) {
      expect(sql).toContain(`'${type}'`)
    }
    expect(sql).toMatch(/comunicado_noa_pendente[\s\S]*'normal'[\s\S]*'documentacao'[\s\S]*\/clientes\/comunicacao/i)
    expect(sql).toMatch(/cliente_contato_bounced_sem_alternativa[\s\S]*'critical'[\s\S]*ARRAY\['documentacao',\s*'administrativo'\]/i)
  })

  it('abre somente nas janelas operacionais e fecha apenas com enviado/origem resolvida', () => {
    expect(sql).toMatch(/v_eta - interval '5 days' <= v_now[\s\S]*v_now < v_eta/i)
    expect(sql).toMatch(/v_ata >= v_now - interval '30 days'[\s\S]*v_ata <= v_now/i)
    expect(sql).toMatch(/v_terminal\.terminal_atb < v_now - interval '30 days'[\s\S]*v_terminal\.terminal_atb > v_now/i)
    expect(sql).toMatch(/c\.kind = 'aviso_chegada_noa'[\s\S]*c\.status = 'enviado'/i)
    expect(sql).toMatch(/c\.kind = 'aviso_prontidao_nor'[\s\S]*c\.status = 'enviado'/i)
    expect(sql).toMatch(/c\.kind = 'aviso_atracacao_nob'[\s\S]*c\.status = 'enviado'/i)
    expect(sql).toMatch(/resolve_customer_contact_bounce_alert_on_change[\s\S]*customer_contacts/i)
  })

  it('integra o detector ao runner server-only', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.detect_customer_communication_alerts\(\)[\s\S]*auth\.role\(\) IS DISTINCT FROM 'service_role'/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.run_alert_detectors\(\)[\s\S]*v_customer_communications := public\.detect_customer_communication_alerts\(\)/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.detect_customer_communication_alerts\(\) TO service_role/i)
  })

  it('mantém complaints do Portal fora da definição de contato alternativo', () => {
    const correction = readFileSync(resolve(process.cwd(), 'supabase/migrations/375_comunicados_bloco2_correcoes.sql'), 'utf8')
    expect(correction).toMatch(/pse\.reason = 'bounce_permanente'/i)
    expect(correction).toMatch(/resolve_customer_contact_bounce_alert_on_change/i)
  })
})
