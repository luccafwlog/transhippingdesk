import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderCustomerCommunicationTemplate } from '../_shared/customerCommunicationTemplates.ts'

type Candidate = {
  claim_key?: string
  kind: 'aviso_chegada_noa' | 'aviso_prontidao_nor'
  customer_id: number
  customer_name: string
  customer_cnpj: string
  voyage_id: number
  vessel_name: string
  voyage_number: string
  port: string
  milestone_at: string
  bl_ids: string[]
  emails: string[]
}

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function releaseClaimSafely(admin: ReturnType<typeof createClient>, claimKey?: string): Promise<void> {
  if (!claimKey) return
  try {
    await admin.rpc('release_customer_communication_automation_claim', { p_claim_key: claimKey })
  } catch (error) {
    console.error('[customer-communication-auto-runner] falha ao liberar claim', claimKey, error)
  }
}

async function handler(req: Request): Promise<Response> {
  const secret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
  const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
  if (!secret || !timingSafeEqual(providedSecret, secret)) return json(401, { error: 'Não autorizado.' })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' })
  const admin = createClient(url, serviceKey)
  const { data, error } = await admin.rpc('evaluate_and_dispatch_automatic_communications', { p_as_of: new Date().toISOString() })
  if (error) return json(500, { error: error.message })
  const candidates = (data ?? []) as Candidate[]
  const sent: Array<{ kind: string; customerId: number; emails: number }> = []
  for (const candidate of candidates) {
    let count = 0
    try {
      const rendered = renderCustomerCommunicationTemplate(candidate.kind, {
        customerId: candidate.customer_id,
        customerName: candidate.customer_name,
        vesselName: candidate.vessel_name,
        voyageNumber: candidate.voyage_number,
        port: candidate.port,
        milestoneAt: candidate.milestone_at,
        bls: candidate.bl_ids.map((id) => ({ id, customerId: candidate.customer_id })),
      })
      const recipients = candidate.emails ?? []
      if (!recipients.length) {
        await releaseClaimSafely(admin, candidate.claim_key)
        continue
      }
      for (const recipient of recipients) {
        try {
          const response = await fetch(`${url}/functions/v1/send-customer-communication`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', 'X-Communication-Automation-Secret': secret },
            body: JSON.stringify({
              customer_id: candidate.customer_id, kind: candidate.kind, nature: 'avisos_operacionais', recipient,
              subject: rendered.subject, html: rendered.html, text: rendered.text, bl_ids: candidate.bl_ids,
              anchor_voyage_id: candidate.voyage_id, anchor_port: candidate.port, attempt_discriminator: 0,
              vessel_name: candidate.vessel_name, voyage_number: candidate.voyage_number, origin: 'automatico',
            }),
          })
          if (response.ok) count += 1
        } catch (dispatchError) {
          console.error('[customer-communication-auto-runner] falha de requisição', candidate.customer_id, recipient, dispatchError)
        }
      }
      if (count === 0) {
        await releaseClaimSafely(admin, candidate.claim_key)
      }
    } catch (candidateError) {
      console.error('[customer-communication-auto-runner] candidato com erro', candidate.customer_id, candidateError)
      await releaseClaimSafely(admin, candidate.claim_key)
    }
    sent.push({ kind: candidate.kind, customerId: candidate.customer_id, emails: count })
  }
  return json(200, { candidates: candidates.length, sent })
}

if (import.meta.main) Deno.serve(handler)
