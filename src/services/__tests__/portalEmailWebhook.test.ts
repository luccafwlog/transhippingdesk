import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webhook = readFileSync(resolve(process.cwd(), 'supabase/functions/portal-email-webhook/index.ts'), 'utf8')

describe('webhook de email para Portal e Comunicados', () => {
  it('resolve as duas trilhas e aponta o evento para apenas uma tentativa', () => {
    expect(webhook).toContain("from('portal_email_attempts')")
    expect(webhook).toContain("from('customer_communication_attempts')")
    expect(webhook).toContain('if (!portalAttempt && !communicationAttempt) return new Response(null, { status: 200 })')
    expect(webhook).toContain(".update({ attempt_id: portalAttempt.id })")
    expect(webhook).toContain(".update({ communication_attempt_id: communicationAttempt.id })")
    expect(webhook).not.toContain('ignoreDuplicates')
  })

  it('separa complaint por canal e compartilha somente bounce permanente sem abortar em caso de erro transiente', () => {
    expect(webhook).toContain("const permanentBounce = status === 'bounce' && event.data.bounce?.type?.toLowerCase() === 'permanent'")
    expect(webhook).toContain("recordPortalSuppression(admin, email, 'bounce_permanente')")
    expect(webhook).toContain("recordPortalSuppression(admin, email, 'complaint')")
    expect(webhook).toContain('recordCommunicationComplaint(admin, email)')
    expect(webhook).toContain("const { data: existing, error: lookupError } = await admin")
    expect(webhook).toContain("if (existing) return")
    expect(webhook).toMatch(/try\s*\{\s*if\s*\(permanentBounce\)/)
    expect(webhook).toContain(".ilike('recovery_email', email)")
  })

  it('aplica cascata, alerta sem alternativa e trava anti-loop', () => {
    expect(webhook).toContain("kind: BOUNCE_NOTIFICATION_KIND")
    expect(webhook).toContain("permanentBounce && portalAttempt?.kind !== BOUNCE_NOTIFICATION_KIND")
    expect(webhook).toContain("p_type: 'cliente_contato_bounced_sem_alternativa'")
    expect(webhook).toContain("admin.rpc('upsert_alert_item'")
    expect(webhook).toContain('resolveBounceCascade({')
    expect(webhook).toContain('idempotencyKey: `${BOUNCE_NOTIFICATION_KIND}:')
  })
})
