import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLineUpSnapshot } from '../services/lineup'
import { LineUpTable } from '../components/lineup/LineUpTable'

const DISPLAY_VISIBLE_ROWS = 8
const DISPLAY_MIN_ROW_HEIGHT = 58

export function LineUpTVDisplay() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState(DISPLAY_MIN_ROW_HEIGHT)

  const { data, isLoading, error } = useQuery({
    queryKey: ['lineup-tv-display-v2'],
    queryFn: fetchLineUpSnapshot,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const rows = data?.rows ?? []
  const lastUpdate = data?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(data.lastChangedAt),
      )
    : '-'

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
    const container = scrollRef.current
    if (!container) return

    container.scrollTop = 0
    if (rows.length <= DISPLAY_VISIBLE_ROWS) return

    const maxIndex = rows.length - DISPLAY_VISIBLE_ROWS
    let currentIndex = 0
    const interval = window.setInterval(() => {
      currentIndex = currentIndex >= maxIndex ? 0 : currentIndex + 1
      container.scrollTo({
        top: currentIndex * rowHeight,
        behavior: 'smooth',
      })
    }, 4200)

    return () => window.clearInterval(interval)
  }, [rowHeight, rows.length])

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
          <span className="app-lineup-display-meta__label">Ultima alteracao</span>
          <strong className="app-lineup-display-meta__value">{lastUpdate}</strong>
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
