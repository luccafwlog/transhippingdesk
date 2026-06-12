import { supabase } from '../supabase'
import { assertUploadSize } from '../../lib/fileGuard'
import type { PixTransaction, RoeSource } from '../../types/database'

export type DemurrageKPIs = {
  overdueContainers: number
  draftInvoicesTotalUsd: number
  issuedInvoicesTotalBrl: number
}

export async function fetchDemurrageKPIs(): Promise<DemurrageKPIs> {
  const [contRes, draftRes, issuedRes] = await Promise.all([
    supabase.from('bl_containers').select('id', { count: 'exact', head: true }).eq('demurrage_status', 'overdue'),
    supabase.from('demurrage_invoices').select('total_usd').eq('status', 'draft'),
    supabase.from('demurrage_invoices').select('frozen_total_brl').eq('status', 'issued'),
  ])
  for (const res of [contRes, draftRes, issuedRes]) {
    if (res.error) throw res.error
  }
  return {
    overdueContainers: contRes.count ?? 0,
    draftInvoicesTotalUsd: (draftRes.data ?? []).reduce((s, r) => s + (r.total_usd ?? 0), 0),
    issuedInvoicesTotalBrl: (issuedRes.data ?? []).reduce((s, r) => s + (r.frozen_total_brl ?? 0), 0),
  }
}

export async function parsePixExtract(arrayBuffer: ArrayBuffer): Promise<PixTransaction[]> {
  const XLSX = await import('@e965/xlsx')

  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })

  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((cell) => String(cell).toLowerCase().trim() === 'identificador')) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) throw new Error('Formato não reconhecido. Coluna "identificador" não encontrada.')

  const headers = rows[headerRowIdx].map((h) => String(h).toLowerCase().trim())
  const colId = headers.indexOf('identificador')
  const colCnpj = headers.findIndex((h) => h.includes('cpf') || h.includes('cnpj'))
  const colDate = headers.findIndex((h) => h.includes('pago em'))
  const colValue = headers.findIndex((h) => h.includes('valor pago'))

  if (colId === -1) throw new Error('Coluna "identificador" não encontrada.')
  if (colValue === -1) throw new Error('Coluna "valor pago" não encontrada.')

  const transactions: PixTransaction[] = []
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const txid = String(row[colId] ?? '').trim()
    if (!txid) continue

    let date = ''
    if (colDate >= 0) {
      const raw = String(row[colDate] ?? '').trim()
      date = parsePixPaidDate(raw)
    }

    let amount = 0
    if (colValue >= 0) {
      amount = parseFloat(String(row[colValue] ?? '').trim().replace(/\./g, '').replace(',', '.')) || 0
    }
    if (amount <= 0) continue

    const cnpj = colCnpj >= 0 ? String(row[colCnpj] ?? '').trim() : ''
    transactions.push({ txid, cnpj, date, amount })
  }
  return transactions
}

function parsePixPaidDate(raw: string): string {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return ''

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return ''
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export async function parsePixExtractFile(file: File): Promise<PixTransaction[]> {
  assertUploadSize(file)
  return parsePixExtract(await file.arrayBuffer())
}

const ROE_CACHE_KEY = 'demurrage_roe_cache'

type RoeCache = { roe: number; fetchedAt: string }

function isRoeCache(v: unknown): v is RoeCache {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).roe === 'number' &&
    typeof (v as Record<string, unknown>).fetchedAt === 'string'
  )
}

function loadCachedROE(): RoeCache | null {
  try {
    const raw = localStorage.getItem(ROE_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRoeCache(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveROECache(roe: number) {
  try {
    const payload: RoeCache = { roe, fetchedAt: new Date().toISOString() }
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage unavailable — ignore
  }
}

export type FetchROEResult = { roe: number; offline: boolean; cachedAt: string | null; source: RoeSource }

export async function fetchROE(): Promise<FetchROEResult> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 10)
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial=%27${fmt(from)}%27&@dataFinalCotacao=%27${fmt(today)}%27&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`)
    const json = await resp.json()
    if (!json.value?.length || !json.value[0].cotacaoVenda) throw new Error('Sem cotações no BCB')
    const roe = parseFloat((parseFloat(json.value[0].cotacaoVenda) * 1.065).toFixed(4))
    saveROECache(roe)
    return { roe, offline: false, cachedAt: null, source: 'bcb_live' }
  } catch {
    const cached = loadCachedROE()
    if (cached) return { roe: cached.roe, offline: true, cachedAt: cached.fetchedAt, source: 'cached' }
    throw new Error('BCB offline e sem cache de PTAX disponivel. Informe a taxa manualmente.')
  }
}
