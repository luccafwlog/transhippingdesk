import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { usePortalAuth } from '../../hooks/usePortalAuth'
import { usePortalMarkAllRead, usePortalMarkRead, usePortalNotifications } from '../../hooks/usePortalNotifications'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data: notifications, isLoading } = usePortalNotifications(open)
  const markRead = usePortalMarkRead()
  const markAllRead = usePortalMarkAllRead()
  const containerRef = useRef<HTMLDivElement>(null)
  const { overview } = usePortalAuth()

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead.mutateAsync()
  }, [markAllRead])

  if (!overview) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="relative flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-[var(--app-muted)] hover:bg-[var(--app-surface-hover)]"
        onClick={() => setOpen(!open)}
        aria-label={`Notificacoes${unreadCount > 0 ? ` (${unreadCount} nao lidas)` : ''}`}
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--app-red)] px-1 text-[10px] font-bold text-white leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
            <span className="text-sm font-semibold">Notificacoes</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="text-xs text-[var(--app-link)] hover:underline"
                onClick={handleMarkAllRead}
              >
                Marcar todas como lidas
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-6 text-center text-xs text-[var(--app-muted)]">Carregando...</div>
            ) : (notifications ?? []).length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[var(--app-muted)]">Nenhuma notificacao.</div>
            ) : (
              (notifications ?? []).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`flex w-full gap-3 border-b border-[var(--app-border)] px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--app-surface-hover)] ${
                    !n.read ? 'bg-[var(--app-surface-muted)]' : ''
                  }`}
                  onClick={() => {
                    if (!n.read) markRead.mutate(n.id)
                  }}
                >
                  <div className="mt-1 shrink-0">
                    {n.type === 'invoice_issued' || n.type === 'demurrage_issued' ? '📄' : n.type === 'dispute_responded' ? '💬' : '🔔'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{n.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--app-muted)] line-clamp-2">{n.message}</div>
                  </div>
                  {!n.read ? <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--app-blue)]" /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
