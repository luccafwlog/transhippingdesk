// Edge Function: recalc-demurrage-ptax
//
// Recalcula diariamente o valor em BRL de todas as faturas de Demurrage emitidas e
// não pagas, usando a PTAX mais recente do BCB (ver ADR 0014). Deve ser agendada em
// dias úteis, após ~14h (BRT), quando a PTAX de fechamento já foi divulgada.
//
// Política de busca da PTAX (igual ao sistema antigo demurrage-manager):
//   CotacaoDolarPeriodo dos últimos ~10 dias, $top=1 & $orderby=dataHoraCotacao desc,
//   selecionando cotacaoVenda + dataHoraCotacao. Nunca pede "a de hoje" — pega a
//   cotação mais recente disponível. Fim de semana / feriado / "ainda não divulgada"
//   NÃO causam falha (retornam a última cotação). "Indisponível" só em erro HTTP/rede
//   ou período vazio → aborta e loga (o caminho manual em /demurrage cobre esse caso).
//
// A PTAX bruta (cotacaoVenda) é passada à RPC; o markup 1,065 é aplicado no banco.
//
// Configuração no Supabase:
//   Schedule (cron) → dias úteis ~14h BRT (ex.: "0 17 * * 1-5" em UTC)
//   Endpoint: https://<project>.supabase.co/functions/v1/recalc-demurrage-ptax
//   Header: Authorization: Bearer <RECALC_CRON_SECRET>
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RECALC_CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function fmtBcbDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
}

type BcbQuote = { cotacaoVenda: number; dataHoraCotacao: string }

async function fetchLatestPtax(): Promise<BcbQuote> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 10)
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
    `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial=%27${fmtBcbDate(from)}%27&@dataFinalCotacao=%27${fmtBcbDate(today)}%27` +
    `&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao`

  const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`)
  const json = await resp.json()
  const row = json?.value?.[0]
  if (!row || !row.cotacaoVenda) throw new Error('Periodo vazio no BCB (API com problema).')
  return { cotacaoVenda: Number(row.cotacaoVenda), dataHoraCotacao: String(row.dataHoraCotacao) }
}

Deno.serve(async (req: Request) => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = Deno.env.get('RECALC_CRON_SECRET') ?? ''
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!cronSecret || !timingSafeEqual(bearer, cronSecret)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'internal_configuration_error' }), { status: 500 })
  }

  let quote: BcbQuote
  try {
    quote = await fetchLatestPtax()
  } catch (error) {
    console.error('recalc-demurrage-ptax: PTAX indisponivel', error)
    return new Response(JSON.stringify({ error: 'ptax_unavailable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)
  const quoteDate = quote.dataHoraCotacao.slice(0, 10) // dataHoraCotacao = "YYYY-MM-DD HH:mm:ss.SSS"

  const { data, error } = await supabase.rpc('recalculate_demurrage_invoices', {
    p_ptax: quote.cotacaoVenda,
    p_quote_date: quoteDate,
    p_source: 'bcb_live',
  })
  if (error) {
    console.error('recalc-demurrage-ptax: RPC falhou', error)
    return new Response(JSON.stringify({ error: 'recalc_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, ptax: quote.cotacaoVenda, quote_date: quoteDate, result: data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
