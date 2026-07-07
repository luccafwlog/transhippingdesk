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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
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
    due_date: string | null
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
      .select('id, invoice_number, status, total_brl, due_date, notes, customer_id')
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

    const portalUrl = Deno.env.get('PORTAL_URL') ?? ''
    const fmtBRL = (val: number | null) =>
      val != null ? val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
    const fmtDate = (d: string | null) =>
      d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—'

    // Todos os campos de BD são escapados antes de serem inseridos no HTML
    const safeCustomerName = escapeHtml(customer?.name ?? '—')
    const safeInvoiceNumber = escapeHtml(String(invoice.invoice_number ?? invoice.id))
    const safeNotes = invoice.notes ? escapeHtml(invoice.notes) : null

    const htmlBody = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:32px;">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:12px;padding:32px;">
    <h1 style="color:#38bdf8;margin:0 0 8px">Nova Fatura Emitida</h1>
    <p style="color:#94a3b8;margin:0 0 24px">Transhipping Desk</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr><td style="padding:8px 0;color:#94a3b8;width:40%">Cliente</td><td style="padding:8px 0;font-weight:600">${safeCustomerName}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Fatura nº</td><td style="padding:8px 0;font-weight:600;font-family:monospace">${safeInvoiceNumber}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Valor total</td><td style="padding:8px 0;font-weight:700;color:#4ade80;font-size:1.2em">${fmtBRL(invoice.total_brl)}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Vencimento</td><td style="padding:8px 0">${fmtDate(invoice.due_date)}</td></tr>
      ${safeNotes ? `<tr><td style="padding:8px 0;color:#94a3b8">Observações</td><td style="padding:8px 0">${safeNotes}</td></tr>` : ''}
    </table>

    ${portalUrl ? `
    <div style="text-align:center;margin:24px 0;">
      <a href="${portalUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">
        Acessar Portal e Pagar com PIX
      </a>
    </div>
    ` : ''}

    <p style="color:#64748b;font-size:0.85em;margin-top:24px;">
      Este é um email automático do Transhipping Desk. Em caso de dúvidas, entre em contato com nossa equipe.
    </p>
  </div>
</body>
</html>`

    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'noreply@transhipping.app'
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
        subject: `Fatura ${invoice.invoice_number ?? invoice.id} emitida — ${fmtBRL(invoice.total_brl)}`,
        html: htmlBody,
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
