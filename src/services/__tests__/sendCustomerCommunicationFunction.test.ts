import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/functions', file), 'utf8')

describe('Edge Function send-customer-communication', () => {
  const source = read('send-customer-communication/index.ts')

  it('mantém autenticação interna, guarda de natureza e simulação sem Resend', () => {
    expect(source).toContain("caller.rpc('portal_current_role')")
    expect(source).toContain("if (!nature || !natureForKind(kind, nature))")
    expect(source).toContain("const enabled = Boolean")
    expect(source).toContain("resendApiKey: enabled ? resendApiKey : null")
    expect(source).toContain("status = sent.ok ? (enabled ? 'enviado' : 'simulado') : 'falha'")
    expect(source).toContain("replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO')")
    expect(source).not.toContain("replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO') ?? Deno.env.get('PORTAL_REPLY_TO')")
  })

  it('confere contato, preferência, bounce/complaint e grava a operação pelo RPC atômico', () => {
    expect(source).toContain("from('customer_contacts')")
    expect(source).toContain("from('customer_contact_preferences')")
    expect(source).toContain("from('customer_communication_suppressions')")
    expect(source).toContain("reason', 'bounce_permanente'")
    expect(source).toContain("admin.rpc('create_customer_communication_atomic'")
    expect(source).toContain("admin.from('customer_communication_attempts').insert")
    expect(source).toContain("admin.rpc('customer_local_charges_communication_payload'")
    expect(source).toContain('renderCeMercanteTaxasTemplate')
    expect(source).toContain('idempotencyKey: `comunicado:${communicationId}:${attemptDiscriminator}:${recipient}`')
    expect(source).toContain('Cobrança de Demurrage é enviada exclusivamente pela régua automática.')
  })

  it('persiste anexos de forma privada, limitada e idempotente antes do envio com compatibilidade de automação', () => {
    expect(source).toContain("from('customer_communication_attachments')")
    expect(source).toMatch(/from\('customer-communications'\)[\s\S]*\.upload\(/)
    expect(source).toMatch(/from\('customer-communications'\)[\s\S]*\.remove\(/)
    expect(source).toContain('existing.length + newAttachments.length > 3')
    expect(source).toContain('existingBytes + newBytes > 10 * 1024 * 1024')
    expect(source).toContain('uploadedBy: string | null')
    expect(source).toContain('callerUser.user?.id ?? null')
  })
})
