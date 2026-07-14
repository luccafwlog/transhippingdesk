# Plano 4 — Email transacional do Portal (Resend, templates, webhooks, supressão)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a camada de envio transacional do Portal: módulo compartilhado com idempotência/retries/supressão, templates HTML+texto sem rastreamento, webhook assinado do Resend com deduplicação, e resumo diário das 08:00.

**Architecture:** Um módulo Deno compartilhado (`_shared/portalEmail.ts`) concentra envio, templates, mascaramento e registro em `portal_email_attempts` (tabela do plano 1). O webhook chega numa Edge Function dedicada que valida assinatura Svix e janela de tempo, deduplica por `provider_event_id` e atualiza tentativas de forma idempotente; bounce permanente/complaint alimentam `portal_suppressed_emails` e alertam todos os CNPJs afetados. O resumo diário é uma Edge Function agendada.

**Tech Stack:** Deno/Edge Functions, Resend API, Svix (assinatura de webhook), pg_cron.

**Leitura obrigatória:** issue #370 seção "Email transacional — decisão desta frente"; `CONTEXT.md` ("Remetente transacional", "Email de Convite/Reenvio/Recuperação", "Tentativa de entrega transacional", "Email suprimido", "Template transacional", "Webhook de entrega", "Alerta interno"); `supabase/functions/notify-invoice-issued/index.ts` (uso atual do Resend no projeto).

**Regras que este plano implementa (não desviar):**
- Remetente: `Portal do Cliente — Transhipping <portal@dominio-proprio>`; `Reply-To: suporte@dominio-proprio`. Domínio ainda não decidido → variável de ambiente; sem domínio verificado, envios só em teste interno.
- Retries só para falhas transitórias (timeout/5xx/limite temporário), máximo 3, espera crescente; erro permanente não repete. Chave de idempotência por tentativa.
- Sem pixel de abertura nem rastreamento de clique; abertura não é rastreada.
- Nenhum email contém senha, token legível (fora do link), fatura ou dado financeiro; alertas internos mascaram o email do cliente.
- Webhook: assinatura válida + janela de tempo; `provider_event_id` deduplicado; persiste só metadados.
- Resumo diário 08:00 (America/Sao_Paulo) somente quando há pendências ou atividade; uma única mensagem consolidada.

---

### Task 1: Módulo compartilhado de envio

**Files:**
- Create: `supabase/functions/_shared/portalEmail.ts`
- Create: `supabase/functions/_shared/portalEmailTemplates.ts`
- Test: `src/lib/__tests__/maskEmail.test.ts` (helper espelhado testável em vitest — ver Step 1)

- [x] **Step 1: Helper de mascaramento (compartilhado front/back) com teste**

Create `src/lib/maskEmail.ts`:

```typescript
// Mascara emails para alertas, auditoria e logs (decisão #370: email completo
// nunca aparece fora do envio real).
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const dot = domain.lastIndexOf('.')
  const domainName = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${local[0]}***@${domainName[0]}***${tld}`
}
```

Test `src/lib/__tests__/maskEmail.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { maskEmail } from '../maskEmail'

describe('maskEmail', () => {
  it('preserva só a inicial do local e do domínio', () => {
    expect(maskEmail('financeiro@empresa.com.br')).toBe('f***@e***.br')
  })
  it('não explode com entrada inválida', () => {
    expect(maskEmail('sem-arroba')).toBe('***')
  })
})
```

Run: `npm test -- maskEmail` — deve passar após implementar.
A Edge Function importa a MESMA lógica: copie a função para
`_shared/portalEmail.ts` com comentário apontando `src/lib/maskEmail.ts`
como fonte (Deno não importa do src do Vite).

- [x] **Step 2: Implementar `_shared/portalEmail.ts`**

```typescript
// Envio transacional do Portal do Cliente (issue #370).
// Sem RESEND_API_KEY: modo dry-run — registra a tentativa e loga metadados
// (nunca o token/link), permitindo desenvolvimento sem envio real.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type PortalEmailKind =
  | 'convite' | 'reenvio' | 'recuperacao' | 'alteracao_email'
  | 'alerta_critico' | 'resumo_diario'

export type SendPortalEmailInput = {
  admin: SupabaseClient
  kind: PortalEmailKind
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string        // ex.: `convite:${inviteId}` | `critico:${invoiceId}:emitida`
  accountId?: number
  inviteId?: number
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const dot = domain.lastIndexOf('.')
  const domainName = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${local[0]}***@${domainName[0]}***${tld}`
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [1000, 3000, 9000]

export async function sendPortalEmail(input: SendPortalEmailInput): Promise<{ ok: boolean }> {
  const { admin } = input

  // Supressão: bounce permanente/complaint bloqueiam qualquer novo envio.
  const { data: suppressed } = await admin
    .from('portal_suppressed_emails')
    .select('id')
    .eq('email', input.to.toLowerCase())
    .maybeSingle()
  if (suppressed) return { ok: false }

  // Idempotência: tentativa já registrada não reenvia.
  const { data: attempt, error: insertError } = await admin
    .from('portal_email_attempts')
    .insert({
      account_id: input.accountId ?? null,
      invite_id: input.inviteId ?? null,
      kind: input.kind,
      idempotency_key: input.idempotencyKey,
      recipient_masked: maskEmail(input.to),
      status: 'aceito',
    })
    .select('id')
    .single()
  if (insertError) {
    // 23505 = chave idempotente já usada: sucesso silencioso (não duplica).
    if (insertError.code === '23505') return { ok: true }
    throw insertError
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    console.log(`[dry-run] ${input.kind} para ${maskEmail(input.to)} (attempt ${attempt.id})`)
    return { ok: true }
  }

  const from = Deno.env.get('PORTAL_FROM_EMAIL')!      // "Portal do Cliente — Transhipping <portal@...>"
  const replyTo = Deno.env.get('PORTAL_REPLY_TO')!     // "suporte@..."

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from, to: [input.to], reply_to: replyTo,
        subject: input.subject, html: input.html, text: input.text,
      }),
    })

    if (res.ok) {
      const body = await res.json()
      await admin.from('portal_email_attempts')
        .update({ provider_message_id: body.id, retry_count: i })
        .eq('id', attempt.id)
      return { ok: true }
    }

    const transient = TRANSIENT_STATUS.has(res.status)
    const errorText = `HTTP ${res.status}`
    if (!transient || i === MAX_ATTEMPTS - 1) {
      await admin.from('portal_email_attempts')
        .update({
          status: transient ? 'falha_transitoria' : 'falha_permanente',
          retry_count: i, last_error: errorText,
        })
        .eq('id', attempt.id)
      return { ok: false }
    }
    await new Promise((r) => setTimeout(r, BACKOFF_MS[i]))
  }
  return { ok: false }
}
```

- [x] **Step 3: Implementar `_shared/portalEmailTemplates.ts`**

Templates com HTML responsivo + texto puro equivalente, sem pixel/rastreio.
Assuntos exatos decididos no mapa:

```typescript
import { maskCnpjDisplay } from './portalEmail.ts' // reexporte maskCnpj de src/lib/cnpj.ts (mesma lógica)

type InviteTemplateInput = {
  companyName: string
  cnpjMasked: string       // já no formato 12.***.***/0001-90
  activationUrl: string    // único lugar onde o token bruto aparece
  supportEmail: string
}

export function inviteTemplate(i: InviteTemplateInput) {
  return {
    subject: `Ative o acesso da ${i.companyName} ao Portal do Cliente`,
    text: [
      `A ${i.companyName} (CNPJ ${i.cnpjMasked}) foi convidada para o Portal do Cliente.`,
      ``,
      `Ative o acesso e crie a sua própria senha (o link vale por 48 horas):`,
      i.activationUrl,
      ``,
      `Se você não é a pessoa autorizada, ignore este email e avise a Transhipping em ${i.supportEmail}.`,
    ].join('\n'),
    html: `<!-- HTML responsivo equivalente ao texto acima: um título com a empresa,
      o CNPJ mascarado, um único botão "Ativar acesso" apontando para activationUrl,
      a validade de 48 horas e a instrução para não-autorizados. Sem imagens
      remotas, sem pixel, sem link de rastreamento. Use tabela 600px máx,
      fonte system-ui, botão com contraste AA. -->`,
  }
}

export function resendTemplate(i: InviteTemplateInput) {
  return {
    subject: 'Novo convite para ativar seu acesso ao Portal do Cliente',
    text: [
      `Enviamos um novo link de ativação para a ${i.companyName} (CNPJ ${i.cnpjMasked}).`,
      `Os links anteriores deixaram de funcionar.`,
      ``,
      `Ative o acesso (o novo link vale por 48 horas):`,
      i.activationUrl,
      ``,
      `Se você não é a pessoa autorizada, ignore este email e avise a Transhipping em ${i.supportEmail}.`,
    ].join('\n'),
    html: `<!-- mesmo padrão do inviteTemplate, avisando que links anteriores
      foram invalidados; NÃO expõe motivo interno, operador ou histórico -->`,
  }
}

export function recoveryTemplate(i: Omit<InviteTemplateInput, 'activationUrl'> & { recoveryUrl: string }) {
  return {
    subject: 'Recuperação de acesso ao Portal do Cliente',
    text: [
      `Recebemos um pedido de recuperação de acesso da ${i.companyName} (CNPJ ${i.cnpjMasked}).`,
      ``,
      `O link abaixo é de uso único e expira em 1 hora:`,
      i.recoveryUrl,
      ``,
      `Se você não fez este pedido, ignore esta mensagem.`,
    ].join('\n'),
    html: `<!-- mesmo padrão; uso único, 1 hora; sem senha/token legível/fatura -->`,
  }
}
```

Escreva o HTML completo de cada template na execução (o comentário descreve o
contrato); mantenha texto e HTML com o MESMO conteúdo informacional.

- [x] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ src/lib/maskEmail.ts src/lib/__tests__/maskEmail.test.ts
git commit -m "feat(portal): módulo de email transacional com idempotência e supressão"
```

---

### Task 2: Webhook do Resend (assinatura, janela, dedup, supressão)

**Files:**
- Create: `supabase/functions/portal-email-webhook/index.ts`

- [x] **Step 1: Implementar**

```typescript
// Edge Function: portal-email-webhook
// Recebe eventos do Resend (email.sent, email.delivered, email.bounced,
// email.complained). Aceita SOMENTE com assinatura Svix válida e timestamp
// dentro da janela de 5 minutos. Deduplica por svix-id. Idempotente.
//
// Env vars: RESEND_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1'

const TOLERANCE_SECONDS = 300

const STATUS_BY_EVENT: Record<string, string> = {
  'email.delivered': 'entregue',
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')!
  const payload = await req.text()
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }

  let event: { type: string; data: { email_id: string; to: string[] } }
  try {
    // Svix valida assinatura E janela de tempo (tolerância padrão 5 min).
    const wh = new Webhook(secret)
    event = wh.verify(payload, headers, { tolerance: TOLERANCE_SECONDS }) as typeof event
  } catch {
    return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Dedup por ID do evento: replays retornam 200 sem alterar nada.
  const { error: dedupError } = await admin
    .from('portal_email_events')
    .insert({ provider_event_id: headers['svix-id'], event_type: event.type })
  if (dedupError?.code === '23505') return new Response(null, { status: 200 })
  if (dedupError) return new Response(null, { status: 500 })

  const newStatus = STATUS_BY_EVENT[event.type]
  if (!newStatus) return new Response(null, { status: 200 }) // evento não mapeado: só registra

  const { data: attempt } = await admin
    .from('portal_email_attempts')
    .select('id, account_id, kind')
    .eq('provider_message_id', event.data.email_id)
    .maybeSingle()
  if (!attempt) return new Response(null, { status: 200 })

  await admin.from('portal_email_attempts')
    .update({ status: newStatus })
    .eq('id', attempt.id)
  await admin.from('portal_email_events')
    .update({ attempt_id: attempt.id })
    .eq('provider_event_id', headers['svix-id'])

  if (newStatus === 'bounce' || newStatus === 'complaint') {
    const email = (event.data.to?.[0] ?? '').toLowerCase()
    if (email) {
      // Supressão (não apaga histórico); ON CONFLICT mantém o registro original.
      await admin.from('portal_suppressed_emails')
        .upsert(
          { email, reason: newStatus === 'bounce' ? 'bounce_permanente' : 'complaint' },
          { onConflict: 'email', ignoreDuplicates: true },
        )

      // Alerta para TODOS os CNPJs que usam esse Email de Recuperação.
      const { data: affected } = await admin
        .from('customer_portal_accounts')
        .select('customer_id')
        .ilike('recovery_email', email)
      for (const acc of affected ?? []) {
        await admin.from('alerts').insert({
          type: 'portal_email_suprimido',
          entity_type: 'customer',
          entity_id: String(acc.customer_id),
          message: 'Email de Recuperação indisponível (bounce/complaint). Informe ou valide outro endereço.',
          status: 'open',
        })
      }
      // Se o email pertencia a um convite pendente, o plano 5 trata a
      // transição para Falha no envio via portal_register_send_failure.
    }
  }

  return new Response(null, { status: 200 })
})
```

Verifique na execução (via context7/docs do Resend) o shape exato do payload
de eventos (`data.email_id`, `data.to`) e ajuste. Bounce transitório vs
permanente: se o payload distinguir (`bounce.type`), suprima apenas o
permanente; o transitório conta como `falha_transitoria`.

- [x] **Step 2: Commit**

```bash
git add supabase/functions/portal-email-webhook/
git commit -m "feat(portal): webhook resend com assinatura, janela e dedup"
```

---

### Task 3: Resumo diário das 08:00

**Files:**
- Create: `supabase/functions/portal-daily-digest/index.ts`
- Create: `supabase/migrations/183_portal_daily_digest_schedule.sql`

- [x] **Step 1: Implementar a função**

Consulta consolidada: falhas de envio, bounces, complaints, expirações,
pendências de ativação (Aguardando ativação) e contagens de
enviados/entregues/ativados das últimas 24h + encerramentos automáticos de
exceção crítica. Se TUDO zerado, não envia nada. Uma única mensagem para os
usuários internos ativos de Documentação e Administrativo
(`user_profiles.active = true`, papéis mapeados como no `_portal_actor_role`),
via `sendPortalEmail` com `kind: 'resumo_diario'` e
`idempotencyKey: 'resumo:' + dataISO` (garante 1 envio/dia mesmo com retrigger).

- [x] **Step 2: Agendar**

```sql
-- 183: Resumo diário do Portal às 08:00 America/Sao_Paulo (11:00 UTC).
SELECT cron.schedule(
  'portal-daily-digest',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/portal-daily-digest',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.digest_secret'))
  );
  $$
);
```

Se `pg_net`/settings não estiverem disponíveis no projeto, use o agendador de
Edge Functions do Dashboard do Supabase e registre isso no runbook — o
resultado exigido é: 1 invocação diária às 08:00 de Brasília.

- [x] **Step 3: Commit**

```bash
git add supabase/functions/portal-daily-digest/ supabase/migrations/183_portal_daily_digest_schedule.sql
git commit -m "feat(portal): resumo diário consolidado das 08:00"
```

---

### Task 4: Documentação viva e variáveis de ambiente

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/modules/portal-cliente.md`, `docs/RASTREABILIDADE.md`
- Modify: `WORKFLOW.md` (novas env vars de functions)

- [x] **Step 1: Documentar** as três functions novas, o módulo compartilhado,
as env vars (`RESEND_API_KEY`, `PORTAL_FROM_EMAIL`, `PORTAL_REPLY_TO`,
`RESEND_WEBHOOK_SECRET`) e o comportamento dry-run sem chave. Deixar explícito:
domínio próprio verificado é gate para envios reais (decisão #370, ainda
`Not yet specified` o domínio final).

- [x] **Step 2: Verificar e commitar**

Run: `npm run docs:check`
Expected: PASS

```bash
git add docs/ WORKFLOW.md
git commit -m "docs(portal): camada de email transacional"
```
