import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

describe('migration 372 — fundação de Comunicados', () => {
  const sql = read('372_comunicados_fundacao.sql')

  it('protege a idempotência por status, disparo e âncoras mesmo com NULL', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*customer_communications_idempotency[\s\S]*NULLS NOT DISTINCT/i)
    expect(sql).toMatch(/customer_communications_idempotency[\s\S]*\([\s\S]*kind[\s\S]*customer_id[\s\S]*status[\s\S]*anchor_voyage_id[\s\S]*anchor_port[\s\S]*anchor_atracacao_id[\s\S]*anchor_invoice_id[\s\S]*dispatch_id[\s\S]*attempt_discriminator/i)
  })

  it('mantém âncoras como valores, sem FK para origens que podem ser editadas ou removidas', () => {
    for (const column of ['anchor_voyage_id', 'anchor_port', 'anchor_atracacao_id', 'anchor_invoice_id']) {
      expect(sql).not.toMatch(new RegExp(`${column}[^\\n]*REFERENCES`, 'i'))
    }
  })

  it('nasce desligada, com intervalo semanal e singleton protegido', () => {
    expect(sql).toMatch(/communications_enabled\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+false/i)
    expect(sql).toMatch(/demurrage_dunning_interval_days\s+INT(?:EGER)?\s+NOT NULL\s+DEFAULT\s+7/i)
    expect(sql).toMatch(/CHECK\s*\(\s*id\s*=\s*1\s*\)/i)
    expect(sql).toMatch(/app_settings[^\n]*administrativo|administrativo[^\n]*app_settings/i)
  })

  it('separa a natureza do modelo e cria as quatro preferências por contato', () => {
    expect(sql).toMatch(/nature\s+TEXT\s+NOT NULL/i)
    expect(sql).toMatch(/FOREIGN KEY\s*\(\s*kind\s*,\s*nature\s*\)\s*REFERENCES\s+public\.customer_communication_kinds\s*\(\s*kind\s*,\s*nature\s*\)/i)
    for (const kind of ['aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'ce_mercante_taxas', 'cobranca_demurrage', 'institucional', 'livre']) {
      expect(sql).toContain(`'${kind}'`)
    }
    for (const nature of ['avisos_gerais', 'avisos_operacionais', 'documentacao', 'demurrage']) {
      expect(sql).toContain(`'${nature}'`)
    }
    expect(sql).toMatch(/CROSS JOIN[\s\S]*avisos_gerais[\s\S]*avisos_operacionais[\s\S]*documentacao[\s\S]*demurrage/i)
  })

  it('restringe a chave global ao perfil administrativo no servidor', () => {
    expect(sql).toMatch(/CREATE POLICY[\s\S]*app_settings[\s\S]*administrativo/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_communications_enabled[\s\S]*IF v_role IS DISTINCT FROM 'administrativo'[\s\S]*42501/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_communications_enabled[\s\S]*INSERT INTO public\.audit_logs/i)
  })
})
