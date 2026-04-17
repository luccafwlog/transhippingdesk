import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLineUpSnapshot } from '../services/lineup'
import { LineUpTable } from '../components/lineup/LineUpTable'
const DISPLAY_ROW_HEIGHT = 46

export function LineUpTVDisplay() {
  const scrollRef = useRef<HTMLDivElement | null>(null)

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
    const maxScroll = container.scrollHeight - container.clientHeight
    if (maxScroll <= 24) return

    let direction: 'down' | 'up' = 'down'
    const interval = window.setInterval(() => {
      const nextStep = Math.max(Math.floor(container.clientHeight * 0.82), 240)
      if (direction === 'down') {
        const next = Math.min(container.scrollTop + nextStep, maxScroll)
        container.scrollTo({ top: next, behavior: 'smooth' })
        if (next >= maxScroll) direction = 'up'
        return
      }

      const next = Math.max(container.scrollTop - nextStep, 0)
      container.scrollTo({ top: next, behavior: 'smooth' })
      if (next <= 0) direction = 'down'
    }, 7000)

    return () => window.clearInterval(interval)
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

      <section ref={scrollRef} className="app-lineup-display-body">
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
              rowHeight={DISPLAY_ROW_HEIGHT}
            />
          </div>
        )}
      </section>
    </main>
  )
}
