import { useState } from 'react'
import { Bell, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useInternalNotifications, useMarkInternalNotificationRead } from '../../hooks/useInternalNotifications'
import { alertEntityLink, type InternalNotification } from '../../services/alerts'

export function InternalNotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data = [], isLoading } = useInternalNotifications()
  const markRead = useMarkInternalNotificationRead()
  const unreadCount = data.filter((notification: InternalNotification) => !notification.read_at).length

  return (
    <div className="relative">
      <button
        type="button"
        className="app-header__icon-button"
        aria-label={`Notificações internas${unreadCount ? ` (${unreadCount} não lidas)` : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={16} />
        {unreadCount ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[var(--app-red)] px-1 text-center text-[10px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-50 w-[min(92vw,380px)] rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2 shadow-2xl" role="menu" aria-label="Notificações internas">
          <div className="border-b border-[var(--app-border)] px-3 py-2 text-sm font-semibold">Notificações internas</div>
          {isLoading ? <div className="px-3 py-5 text-sm text-[var(--app-muted)]">Carregando…</div> : null}
          {!isLoading && !data.length ? <div className="px-3 py-5 text-sm text-[var(--app-muted)]">Nenhuma pendência nova.</div> : null}
          <div className="max-h-96 overflow-auto">
            {data.map((notification: InternalNotification) => {
              const destination = alertEntityLink({
                type: notification.item_type ?? notification.type,
                entity_type: notification.entity_type,
                entity_id: notification.entity_id,
                metadata: notification.payload ?? {},
              }) ?? notification.destination ?? '/alertas'
              return (
                <button
                  key={notification.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full gap-3 rounded-lg px-3 py-3 text-left hover:bg-white/5"
                  onClick={() => {
                    if (!notification.read_at) void markRead.mutateAsync(notification.id).catch(() => undefined)
                    navigate(destination)
                    setOpen(false)
                  }}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.read_at ? 'bg-slate-600' : notification.severity === 'critical' ? 'bg-red-400' : 'bg-amber-300'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{notification.title}</span>
                    <span className="mt-1 block text-xs text-[var(--app-muted)]">{notification.message}</span>
                  </span>
                  <ExternalLink size={13} className="mt-1 shrink-0 text-[var(--app-muted)]" />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
