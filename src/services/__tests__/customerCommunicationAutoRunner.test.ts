import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../../supabase/functions/customer-communication-auto-runner/index.ts', import.meta.url), 'utf8')

describe('contrato do runner automático de Comunicados', () => {
  it('não consome claim em simulação, libera falhas parciais e expõe falha de release', () => {
    expect(source).toContain("result?.status === 'enviado'")
    expect(source).toContain('if (count < recipients.length)')
    expect(source).toContain("const { error } = await admin.rpc('release_customer_communication_automation_claim'")
    expect(source).toContain("if (req.method !== 'POST') return json(405")
  })
})
