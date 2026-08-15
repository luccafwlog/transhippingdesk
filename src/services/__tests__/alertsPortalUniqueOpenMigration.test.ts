import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/303_alerts_portal_unique_open.sql', 'utf8')
const helper = readFileSync('supabase/functions/_shared/portalAlerts.ts', 'utf8')

describe('Unicidade dos alertas abertos do Portal (303)', () => {
  // `openAlertOnce` consulta e depois insere; entre os dois passos não há nada
  // segurando a linha, e os dois chamadores chegam em rajada (um evento do
  // Resend por destinatário; um disparo por tentativa da rajada que bloqueou o
  // login). A consulta estreitava a janela, não a fechava.
  it('cria o índice único parcial sobre tipo e entidade', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_portal_aberto_por_entidade')
    expect(sql).toContain('ON public.alerts (type, entity_type, entity_id)')
  })

  // O predicado é o mesmo do helper: um alerta apenas reconhecido continua
  // segurando o duplicado, e um fechado não impede a abertura do próximo.
  it('repete o predicado do helper, e não `status = open`', () => {
    expect(sql).toContain("WHERE status <> 'closed'")
    expect(sql).not.toContain("status = 'open'")
    expect(helper).toContain(".neq('status', 'closed')")
  })

  // `alerts` serve o sistema inteiro e outros tipos abrem legitimamente mais de
  // um alerta não fechado para a mesma entidade.
  it('restringe a unicidade aos tipos que passam pelo helper', () => {
    expect(sql).toContain("AND type IN ('portal_abuso_login','portal_email_suprimido')")
    for (const type of ['portal_abuso_login', 'portal_email_suprimido']) {
      expect(helper.length && sql.includes(type)).toBe(true)
    }
  })

  it('fecha os duplicados existentes mantendo o mais antigo de cada par', () => {
    expect(sql).toContain('row_number() OVER (PARTITION BY type, entity_type, entity_id ORDER BY id)')
    expect(sql).toContain('WHERE d.id = a.id AND d.posicao > 1;')
  })

  // Perder a corrida é desfecho normal, não erro a propagar; qualquer outro
  // erro do INSERT continua subindo.
  it('o helper trata o conflito de unicidade como alerta já aberto', () => {
    expect(helper).toContain("const CONFLITO_DE_UNICIDADE = '23505'")
    expect(helper).toContain("if ((error as { code?: string }).code === CONFLITO_DE_UNICIDADE) return 'ja_aberto'")
    expect(helper).toContain('throw error')
  })
})
