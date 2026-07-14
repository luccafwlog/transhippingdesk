import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type PortalEmailKind = 'convite' | 'reenvio' | 'recuperacao' | 'alteracao_email' | 'alerta_critico' | 'resumo_diario'
export type SendPortalEmailInput = {
  admin: SupabaseClient
  kind: PortalEmailKind
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
  accountId?: number
  inviteId?: number
}

// Mantém a mesma regra de src/lib/maskEmail.ts; Deno não importa o bundle Vite.
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const dot = domain.lastIndexOf('.')
  const domainName = dot > 0 ? domain.slice(0, dot) : domain
  return `${local[0]}***@${domainName[0]}***${dot > 0 ? domain.slice(dot) : ''}`
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])
const BACKOFF_MS = [1000, 3000, 9000]

export async function sendPortalEmail(input: SendPortalEmailInput): Promise<{ ok: boolean }> {
  const { admin } = input
  const { data: suppressed } = await admin.from('portal_suppressed_emails').select('id').eq('email', input.to.toLowerCase()).maybeSingle()
  if (suppressed) return { ok: false }
  const { data: attempt, error: insertError } = await admin.from('portal_email_attempts').insert({
    account_id: input.accountId ?? null, invite_id: input.inviteId ?? null, kind: input.kind,
    idempotency_key: input.idempotencyKey, recipient_masked: maskEmail(input.to), status: 'aceito',
  }).select('id').single()
  if (insertError) {
    if (insertError.code === '23505') return { ok: true }
    throw insertError
  }
  const apiKey = typeof Deno !== 'undefined' ? Deno.env.get('RESEND_API_KEY') : null
  if (!apiKey) {
    console.log(`[dry-run] ${input.kind} para ${maskEmail(input.to)} (attempt ${attempt.id})`)
    return { ok: true }
  }
  const from = Deno.env.get('PORTAL_FROM_EMAIL')
  const replyTo = Deno.env.get('PORTAL_REPLY_TO')
  if (!from || !replyTo) throw new Error('PORTAL_FROM_EMAIL e PORTAL_REPLY_TO são obrigatórios para envio real')
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ from, to: [input.to], reply_to: replyTo, subject: input.subject, html: input.html, text: input.text }),
    })
    if (response.ok) {
      const body = await response.json() as { id?: string }
      await admin.from('portal_email_attempts').update({ provider_message_id: body.id ?? null, retry_count: index, status: 'aceito' }).eq('id', attempt.id)
      return { ok: true }
    }
    const transient = TRANSIENT_STATUS.has(response.status)
    if (!transient || index === 2) {
      await admin.from('portal_email_attempts').update({ status: transient ? 'falha_transitoria' : 'falha_permanente', retry_count: index, last_error: `HTTP ${response.status}` }).eq('id', attempt.id)
      return { ok: false }
    }
    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[index]))
  }
  return { ok: false }
}
