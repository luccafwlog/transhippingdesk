// Edge Function: notify-invoice-issued
//
// Disparada via Database Webhook quando uma fatura muda para status='issued'.
// Envia email ao cliente com resumo da fatura e QR Code PIX (quando disponível).
//
// Configuração necessária no Supabase:
//   Database Webhooks → tabela: invoices → evento: UPDATE
//   Filtro: new.status = 'issued' AND old.status != 'issued'
//   Endpoint: https://<project>.supabase.co/functions/v1/notify-invoice-issued
//   Secret Header: Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>
//
// Env vars necessárias:
//   RESEND_API_KEY — chave de API Resend para envio de email
//   FROM_EMAIL — remetente (ex: "Transhipping Desk <noreply@...>")
//   PORTAL_URL  — URL base do portal do cliente
//   NOTIFY_WEBHOOK_SECRET — segredo dedicado do Database Webhook
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { invoiceCriticalPendencyTemplate, invoiceIssuedTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'

function maskCnpj(value: string | null): string {
  const digits = (value ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  return digits.length === 14 ? `${digits.slice(0, 2)}.***.***/${digits.slice(8, 12)}-${digits.slice(12)}` : '***'
}

// Webhook interno: não há origem de browser legítima.
// Aceita apenas requisições sem Origin (server-to-server) ou do próprio projeto.
const ALLOWED_ORIGIN = Deno.env.get('SUPABASE_URL') ?? ''

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = !origin || origin === ALLOWED_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowed ? (origin ?? '') : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

type WebhookPayload = {
  type: 'UPDATE' | 'INSERT'
  table: string
  schema: string
  record: {
    id: number
    invoice_number: string | null
    status: string
    total_brl: number | null
    notes: string | null
    customer_id: number | null
  }
  old_record: {
    status: string
  } | null
}

// Comparação em tempo constante para evitar timing attacks no bearer secret.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i]
  return diff === 0
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const webhookSecret =
    Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  // Autenticação do webhook: o Database Webhook envia
  // `Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>` como secret header.
  // Sem essa verificação, qualquer um que conheça a URL podia disparar emails
  // forjados para clientes reais (spoofing / email bombing).
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!webhookSecret || !timingSafeEqual(bearer, webhookSecret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload: WebhookPayload = await req.json()

    // Only process invoice -> issued transitions
    if (
      payload.table !== 'invoices' ||
      payload.record.status !== 'issued' ||
      payload.old_record?.status === 'issued'
    ) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    )

    // Re-buscar a fatura do banco em vez de confiar no payload do request:
    // o conteúdo do email (valor, número, observações) passa a vir de fonte
    // confiável, não de um corpo POST potencialmente forjado.
    const { data: dbInvoice } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total_brl, notes, customer_id')
      .eq('id', payload.record.id)
      .single()

    if (!dbInvoice || dbInvoice.status !== 'issued') {
      return new Response(JSON.stringify({ skipped: true, reason: 'invoice not issued in db' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const invoice = dbInvoice

    if (!invoice.customer_id) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no customer_id' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // Fetch customer contact email
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, cnpj_cpf')
      .eq('id', invoice.customer_id)
      .single()

    const portalUrl = Deno.env.get('PORTAL_URL') ?? ''
    const supportEmail = Deno.env.get('PORTAL_SUPPORT_EMAIL') ?? 'suporte@transhippingdesk.com.br'
    const companyName = customer?.name ?? 'cliente'
    const cnpjMasked = maskCnpj(customer?.cnpj_cpf ?? null)
    const invoiceNumber = String(invoice.invoice_number ?? invoice.id)

    const { data: portalAccount } = await supabase
      .from('customer_portal_accounts')
      .select('account_situation, recovery_email')
      .eq('customer_id', invoice.customer_id)
      .maybeSingle()

    if (!portalAccount || portalAccount.account_situation !== 'ativo' || !portalAccount.recovery_email) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, role, active')
        .in('role', ['admin', 'administrativo', 'documentacao'])
        .eq('active', true)
      const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const internalEmails = (profiles ?? [])
        .map((profile) => users.data.users.find((user) => user.id === profile.id)?.email)
        .filter((email): email is string => Boolean(email))
      const consoleUrl = `${portalUrl}/clientes/portal?cliente=${invoice.customer_id}`
      const criticalTemplate = invoiceCriticalPendencyTemplate({ companyName, cnpjMasked, invoiceNumber, consoleUrl, portalUrl, supportEmail })
      for (const email of [...new Set(internalEmails)]) {
        await sendPortalEmail({
          admin: supabase,
          kind: 'alerta_critico',
          to: email,
          subject: criticalTemplate.subject,
          html: criticalTemplate.html,
          text: criticalTemplate.text,
          idempotencyKey: `critico:fatura:${invoice.id}:${email.toLowerCase()}`,
        })
      }
    }

    const { data: contacts } = await supabase
      .from('customer_contacts')
      .select('email, name, is_primary')
      .eq('customer_id', invoice.customer_id)
      .order('is_primary', { ascending: false })
      .limit(3)

    const recipients = (contacts ?? [])
      .map((c) => c.email)
      .filter((email): email is string => Boolean(email))

    if (!recipients.length) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no recipient emails' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const fmtBRL = (val: number | null) =>
      val != null ? val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'

    const invoiceTemplate = invoiceIssuedTemplate({
      companyName,
      cnpjMasked,
      invoiceNumber,
      totalFormatted: fmtBRL(invoice.total_brl),
      notes: invoice.notes,
      portalUrl,
      supportEmail,
    })

    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'noreply@transhippingdesk.com.br'
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!resendKey) {
      console.warn('RESEND_API_KEY not configured — email not sent.')
      return new Response(JSON.stringify({ sent: false, reason: 'resend_api_key_not_configured' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject: invoiceTemplate.subject,
        html: invoiceTemplate.html,
        text: invoiceTemplate.text,
      }),
    })

    if (!resendResp.ok) {
      const errText = await resendResp.text()
      throw new Error(`Resend API error: ${errText}`)
    }

    return new Response(JSON.stringify({ sent: true, recipients, via: 'resend' }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('notify-invoice-issued error:', message)
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }
})
