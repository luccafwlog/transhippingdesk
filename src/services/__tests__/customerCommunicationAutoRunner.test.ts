import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../../supabase/functions/customer-communication-auto-runner/index.ts', import.meta.url), 'utf8')

describe('contrato do runner automático de Comunicados', () => {
  it('suporta CE financeiro, simulação reprocessável e trata supressão permanente', () => {
    expect(source).toContain("kind: 'aviso_chegada_noa' | 'aviso_prontidao_nor' | 'aviso_atracacao_nob' | 'ce_mercante_taxas'")
    expect(source).toContain("customer_local_charges_communication_payload")
    expect(source).toContain("result?.status === 'enviado' || result?.status === 'simulado' || result?.status === 'parcial'")
    expect(source).toContain("response.status === 422 && Boolean(result?.suppressed)")
    expect(source).toContain('const shouldRelease = resolvedRecipients < recipients.length')
    expect(source).toContain("const { error } = await admin.rpc('release_customer_communication_automation_claim'")
    expect(source).toContain("timingSafeEqual(providedSecret, secret)")
    expect(source).toContain("if (req.method !== 'POST') return json(405")
  })

  it('repassa a identidade da Atracação exigida pelo NOB', () => {
    // assertCommunicationScope recusa o NOB sem terminal no comunicado E em cada
    // B/L: sem isto o candidato produzido pela migration 045 morreria no render.
    expect(source).toContain('terminalId: candidate.terminal_id ?? null')
    expect(source).toContain('terminalStateId: candidate.anchor_atracacao_id ?? null')
    expect(source).toContain('terminalName: candidate.terminal_name ?? null')
    // E a âncora precisa chegar ao registro, senão a idempotência por Atracação
    // não existe e o mesmo NOB sai de novo a cada passagem do cron.
    expect(source).toContain('anchor_atracacao_id: candidate.anchor_atracacao_id ?? null')
    expect(source).toContain('terminal_name: candidate.terminal_name ?? null')
  })
})
