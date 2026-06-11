import { useEffect, useRef, useState } from 'react'

export interface ExchangeRates {
  usd: number | null
  cny: number | null
  fetchedAt: string | null
}

const CACHE_KEY = 'header_ptax_display'
const CNY_PER_USD = 7.25

type PtaxResponse = { value?: { cotacaoVenda?: string | number }[] }

function loadCache(): ExchangeRates | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'usd' in parsed &&
      'cny' in parsed &&
      'fetchedAt' in parsed
    ) {
      return parsed as ExchangeRates
    }
    return null
  } catch {
    return null
  }
}

function saveCache(rates: ExchangeRates) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rates))
  } catch {
    // localStorage unavailable
  }
}

function buildRates(cotacaoVenda: string | number): ExchangeRates {
  const usd = parseFloat(String(cotacaoVenda))
  const cny = parseFloat((usd / CNY_PER_USD).toFixed(4))
  return { usd, cny, fetchedAt: new Date().toISOString() }
}

async function fetchPtax(): Promise<ExchangeRates> {
  const today = new Date()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const yyyy = today.getFullYear()
  const dateStr = `${mm}-${dd}-${yyyy}`

  const dayUrl =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
    `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao=%27${dateStr}%27` +
    `&$format=json&$select=cotacaoCompra,cotacaoVenda`

  const resp = await fetch(dayUrl, { signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) throw new Error(`BCB ${resp.status}`)
  const json = (await resp.json()) as PtaxResponse

  if (json.value?.length && json.value[0].cotacaoVenda != null) {
    return buildRates(json.value[0].cotacaoVenda)
  }

  // Weekend/holiday — fall back to last 10 days
  const from = new Date(today)
  from.setDate(from.getDate() - 10)
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`

  const periodUrl =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
    `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial=%27${fmt(from)}%27&@dataFinalCotacao=%27${fmt(today)}%27` +
    `&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda`

  const resp2 = await fetch(periodUrl, { signal: AbortSignal.timeout(10_000) })
  if (!resp2.ok) throw new Error(`BCB period ${resp2.status}`)
  const json2 = (await resp2.json()) as PtaxResponse

  if (!json2.value?.length || json2.value[0].cotacaoVenda == null) {
    throw new Error('No PTAX data available')
  }

  return buildRates(json2.value[0].cotacaoVenda)
}

function cacheIsFromToday(): boolean {
  const cached = loadCache()
  if (!cached?.fetchedAt) return false
  return new Date(cached.fetchedAt).toDateString() === new Date().toDateString()
}

export function useExchangeRates(): ExchangeRates & { loading: boolean } {
  const fetchStarted = useRef(false)
  const [rates, setRates] = useState<ExchangeRates>(
    () => loadCache() ?? { usd: null, cny: null, fetchedAt: null },
  )
  // Já nasce true quando o cache não cobre o dia (o effect abaixo vai buscar),
  // evitando setState síncrono dentro do effect.
  const [loading, setLoading] = useState(() => !cacheIsFromToday())

  useEffect(() => {
    if (fetchStarted.current) return
    fetchStarted.current = true

    if (cacheIsFromToday()) return

    fetchPtax()
      .then((result) => {
        saveCache(result)
        setRates(result)
      })
      .catch(() => {
        // Keep existing state (cached or null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  return { ...rates, loading }
}
