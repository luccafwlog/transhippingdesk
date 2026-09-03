import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Teste de contrato SQL da 007 (ADR 0063). O gate estático
// `scripts/security/verificar_guardas.py` só faz replay de `public`, então a
// superfície em `ops` fica fora do alcance dele por construção: este arquivo é
// a contrapartida no repositório, e a verificação executável dentro da própria
// migration é a contrapartida no banco.
const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/007_cron_secrets_no_vault.sql'),
  'utf8',
)

describe('007 — segredos dos jobs pg_cron no Vault', () => {
  it('agenda os quatro jobs HTTP pelo dispatcher, sem valor no comando', () => {
    for (const [jobname, chamada] of [
      ['portal-daily-digest', "ops.dispatch_edge_job('portal-daily-digest', 'PORTAL_DIGEST_SECRET')"],
      ['alerts-foundation-detectors', "ops.dispatch_edge_job('alerts-detector', 'ALERTS_DETECTOR_SECRET')"],
      ['demurrage-dunning', "ops.dispatch_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET')"],
      [
        'customer-communication-auto-runner',
        "ops.dispatch_edge_job('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '')",
      ],
    ] as const) {
      expect(sql).toContain(`'${jobname}'`)
      expect(sql).toContain(chamada)
    }

    // Nenhum comando agendado pode voltar a montar o header no próprio texto.
    const comandosAgendados = [...sql.matchAll(/\$cmd\$(.*?)\$cmd\$/gs)].map((m) => m[1])
    expect(comandosAgendados).toHaveLength(4)
    for (const comando of comandosAgendados) {
      expect(comando).toContain('ops.dispatch_edge_job(')
      expect(comando).not.toContain('net.http_post')
      expect(comando).not.toMatch(/Bearer/i)
    }
  })

  it('lê o cofre sem emprestar privilégio e fora do alcance do cliente', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION ops\.dispatch_edge_job\(/)
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).not.toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = pg_catalog, pg_temp')
    expect(sql).toContain('FROM vault.decrypted_secrets')

    // O schema não pode nascer alcançável pelo browser.
    expect(sql).toContain('REVOKE ALL ON SCHEMA ops FROM PUBLIC')
    expect(sql).toContain('REVOKE ALL ON SCHEMA ops FROM anon, authenticated')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION ops\.dispatch_edge_job\([^)]*\) FROM PUBLIC/)

    // `ops` é superfície operacional: tabela de domínio continua em `public`.
    expect(sql).not.toMatch(/CREATE TABLE\s+ops\./i)
  })

  it('não gera segredo novo e aborta se a extração do literal for parcial', () => {
    // A semeadura move o que já existe; um valor inventado aqui divergiria do
    // Edge Function Secret e derrubaria o job em silêncio.
    expect(sql).toContain('vault.create_secret')
    expect(sql).toMatch(/CONTINUE WHEN EXISTS \(SELECT 1 FROM vault\.secrets WHERE name = r\.secret_name\)/)
    expect(sql).toMatch(/IF v_pos = 0 OR v_next NOT IN \(',', '\)'\) THEN/)
    expect(sql).toMatch(/RAISE EXCEPTION '007: nao foi possivel extrair com seguranca/)
  })

  it('carrega a verificação executável que trava o contrato no banco', () => {
    expect(sql).toMatch(/RAISE EXCEPTION '007: jobs ainda expoem segredo literal no comando/)
    expect(sql).toMatch(/RAISE EXCEPTION '007: jobs HTTP ausentes, inativos ou fora do dispatcher/)
  })
})
