import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLineUpSnapshot, type LineUpRow } from '../services/lineup'
import { LineUpTable } from '../components/lineup/LineUpTable'

const DISPLAY_VISIBLE_ROWS = 8
const DISPLAY_MIN_ROW_HEIGHT = 74
const DISPLAY_ROW_TRAVEL_MS = 6000

export function LineUpTVDisplay() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState(DISPLAY_MIN_ROW_HEIGHT)
  const [{ startIndex, offset }, setRotation] = useState({ startIndex: 0, offset: 0 })
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['lineup-tv-display-v2'],
    queryFn: fetchLineUpSnapshot,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const rows = useMemo(() => [...(data?.rows ?? [])].sort(compareDisplayRows), [data?.rows])
  const firstRoute = rows[0] ?? null
  const hasAnimatedLoop = rows.length > DISPLAY_VISIBLE_ROWS
  const lastUpdate = data?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(data.lastChangedAt),
      )
    : '-'
  const firstRouteLabel = firstRoute ? buildDisplayLeadLabel(firstRoute) : '-'
  const displayRows = useMemo(() => {
    if (!hasAnimatedLoop) return rows

    return Array.from({ length: DISPLAY_VISIBLE_ROWS + 1 }, (_, slotIndex) => {
      const baseRow = rows[(startIndex + slotIndex) % rows.length]
      return {
        ...baseRow,
        id: `${baseRow.id}::display-slot-${startIndex}-${slotIndex}`,
      }
    })
  }, [hasAnimatedLoop, rows, startIndex])
  const bodyStyle = useMemo<CSSProperties | undefined>(() => {
    if (!hasAnimatedLoop) return undefined

    return {
      transform: `translateY(-${offset}px)`,
      transition: 'none',
      willChange: 'transform',
    }
  }, [hasAnimatedLoop, offset])

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

  useEffect(() => {
    setRotation({ startIndex: 0, offset: 0 })
    lastFrameTimeRef.current = null
  }, [data?.lastChangedAt, rows.length])

  useEffect(() => {
    if (!hasAnimatedLoop || rowHeight <= 0) return

    const pixelsPerMs = rowHeight / DISPLAY_ROW_TRAVEL_MS
    const tick = (frameTime: number) => {
      const previousFrameTime = lastFrameTimeRef.current ?? frameTime
      const elapsedMs = frameTime - previousFrameTime
      lastFrameTimeRef.current = frameTime

      setRotation((current) => {
        let nextOffset = current.offset + elapsedMs * pixelsPerMs
        let consumedRows = 0
        while (nextOffset >= rowHeight) {
          nextOffset -= rowHeight
          consumedRows += 1
        }

        if (!consumedRows && Math.abs(nextOffset - current.offset) < 0.1) return current

        return {
          startIndex: consumedRows ? (current.startIndex + consumedRows) % rows.length : current.startIndex,
          offset: nextOffset,
        }
      })

      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameTimeRef.current = null
    }
  }, [hasAnimatedLoop, rowHeight, rows.length])

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
              rows={displayRows}
              emptyTitle="Nenhuma escala disponivel."
              emptyDescription="Aguarde o proximo ciclo de atualizacao."
              mode="display"
              rowHeight={rowHeight}
              fillSlots={hasAnimatedLoop ? undefined : DISPLAY_VISIBLE_ROWS}
              containerRef={scrollRef}
              bodyStyle={bodyStyle}
              getRowKey={(row) => row.id}
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
