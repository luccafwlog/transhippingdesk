import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLineUpSnapshot, type LineUpRow } from '../services/lineup'
import { LineUpTable } from '../components/lineup/LineUpTable'

const DISPLAY_VISIBLE_ROWS = 8
const DISPLAY_MIN_ROW_HEIGHT = 74

export function LineUpTVDisplay() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState(DISPLAY_MIN_ROW_HEIGHT)
  const rowHeightRef = useRef(DISPLAY_MIN_ROW_HEIGHT)

  const { data, isLoading, error } = useQuery({
    queryKey: ['lineup-tv-display-v2'],
    queryFn: fetchLineUpSnapshot,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const rows = useMemo(() => [...(data?.rows ?? [])].sort(compareDisplayRows), [data?.rows])
  const firstRoute = rows[0] ?? null
  const lastUpdate = data?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(data.lastChangedAt),
      )
    : '-'
  const firstRouteLabel = firstRoute ? buildDisplayLeadLabel(firstRoute) : '-'

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [])

  useEffect(() => {
    const element = document.documentElement
    const requestFullScreen = async () => {
      try {
        if (document.fullscreenElement) return
        if (element.requestFullscreen) {
          await element.requestFullscreen()
        }
      } catch {
        // Browser may require explicit user gesture; keep display usable without blocking.
      }
    }

    void requestFullScreen()
  }, [])

  // Keep ref in sync so the scroll interval always reads the latest rowHeight
  // without needing to restart when rowHeight changes
  useEffect(() => {
    rowHeightRef.current = rowHeight
  }, [rowHeight])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    container.scrollTop = 0

    const collectScrollStops = () => {
      const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
      if (maxScrollTop <= 0) return [0]

      const headerHeight = Math.ceil(container.querySelector('thead')?.getBoundingClientRect().height ?? 0)
      const visibleBodyHeight = Math.max(container.clientHeight - headerHeight, rowHeightRef.current)
      const bodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.app-lineup-placeholder-row)'))
      const stops = new Set<number>([0])

      for (const row of bodyRows) {
        const top = Math.max(Math.min(row.offsetTop - headerHeight, maxScrollTop), 0)
        const bottom = top + row.getBoundingClientRect().height
        if (bottom > visibleBodyHeight + 1) stops.add(top)
      }

      return Array.from(stops).sort((left, right) => left - right)
    }

    let scrollStops = collectScrollStops()
    if (scrollStops.length <= 1) return

    let currentIndex = 0
    const interval = window.setInterval(() => {
      scrollStops = collectScrollStops()
      if (scrollStops.length <= 1) {
        currentIndex = 0
        container.scrollTop = 0
        return
      }

      currentIndex = currentIndex >= scrollStops.length - 1 ? 0 : currentIndex + 1
      container.scrollTo({
        top: scrollStops[currentIndex],
        behavior: 'smooth',
      })
    }, 4200)

    return () => window.clearInterval(interval)
  }, [data?.lastChangedAt, rows.length])

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const recalculate = () => {
      const headerRow = container.querySelector('thead')
      const headerHeight = Math.ceil(headerRow?.getBoundingClientRect().height ?? 38)
      const availableHeight = Math.max(container.clientHeight - headerHeight, DISPLAY_MIN_ROW_HEIGHT * DISPLAY_VISIBLE_ROWS)
      const next = Math.max(DISPLAY_MIN_ROW_HEIGHT, Math.floor(availableHeight / DISPLAY_VISIBLE_ROWS))
      setRowHeight(next)
    }

    const observer = new ResizeObserver(recalculate)
    observer.observe(container)
    const headerRow = container.querySelector('thead')
    if (headerRow) observer.observe(headerRow)

    requestAnimationFrame(recalculate)

    return () => observer.disconnect()
  }, [rows.length])

  return (
    <main className="app-lineup-display-shell">
      <header className="app-lineup-display-header">
        <div className="app-lineup-display-brand">
          <img
            src="/branding/transhipping-logo-cropped.png"
            alt="Transhipping"
            className="app-lineup-display-brand__logo"
          />
        </div>
        <div className="app-lineup-display-meta">
          <div className="app-lineup-display-meta__group">
            <span className="app-lineup-display-meta__label">Inicio do ciclo</span>
            <strong className="app-lineup-display-meta__value app-lineup-display-meta__value--route">{firstRouteLabel}</strong>
          </div>
          <div className="app-lineup-display-meta__group">
            <span className="app-lineup-display-meta__label">Ultima alteracao</span>
            <strong className="app-lineup-display-meta__value">{lastUpdate}</strong>
          </div>
        </div>
      </header>

      <section className="app-lineup-display-body">
        {error ? (
          <div className="app-lineup-display-error">Falha ao carregar o quadro da TV.</div>
        ) : null}

        {isLoading ? (
          <div className="app-lineup-display-loading">Carregando line up...</div>
        ) : (
          <div className="app-lineup-display-table-frame">
            <LineUpTable
              rows={rows}
              emptyTitle="Nenhuma escala disponivel."
              emptyDescription="Aguarde o proximo ciclo de atualizacao."
              mode="display"
              rowHeight={rowHeight}
              fillSlots={DISPLAY_VISIBLE_ROWS}
              containerRef={scrollRef}
            />
          </div>
        )}
      </section>
    </main>
  )
}

function compareDisplayRows(left: LineUpRow, right: LineUpRow) {
  const etaComparison = compareDateValues(left.eta, right.eta)
  if (etaComparison !== 0) return etaComparison

  const etbComparison = compareDateValues(left.etb, right.etb)
  if (etbComparison !== 0) return etbComparison

  if (left.vesselName !== right.vesselName) return left.vesselName.localeCompare(right.vesselName, 'pt-BR')
  if (left.voyageNumber !== right.voyageNumber) return left.voyageNumber.localeCompare(right.voyageNumber, 'pt-BR')
  return left.pod.localeCompare(right.pod, 'pt-BR')
}

function compareDateValues(left: string | null, right: string | null) {
  return toSortableDateValue(left) - toSortableDateValue(right)
}

function toSortableDateValue(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

function buildDisplayLeadLabel(row: LineUpRow) {
  const etaLabel = formatDisplayLeadDate('ETA', row.eta)
  if (etaLabel) return `${etaLabel} | ${row.vesselName} | ${row.pod}`

  const etbLabel = formatDisplayLeadDate('ETB', row.etb)
  if (etbLabel) return `${etbLabel} | ${row.vesselName} | ${row.pod}`

  return `${row.vesselName} | ${row.pod}`
}

function formatDisplayLeadDate(label: 'ETA' | 'ETB', value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `${label} ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(parsed)}`
}
