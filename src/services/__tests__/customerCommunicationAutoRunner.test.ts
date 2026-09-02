import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../../supabase/functions/customer-communication-auto-runner/index.ts', import.meta.url), 'utf8')

describe('contrato do runner automático de Comunicados', () => {
  it('suporta CE financeiro, simulação reprocessável e trata supressão permanente', () => {
    expect(source).toContain("kind: 'aviso_chegada_noa' | 'aviso_prontidao_nor' | 'ce_mercante_taxas'")
    expect(source).toContain("customer_local_charges_communication_payload")
    expect(source).toContain("result?.status === 'enviado' || result?.status === 'simulado'")
    expect(source).toContain("response.status === 422 && Boolean(result?.suppressed)")
    expect(source).toContain('const shouldRelease = resolvedRecipients < recipients.length || simulatedRecipients > 0')
    expect(source).toContain("const { error } = await admin.rpc('release_customer_communication_automation_claim'")
    expect(source).toContain("timingSafeEqual(providedSecret, secret)")
    expect(source).toContain("if (req.method !== 'POST') return json(405")
  })
})
