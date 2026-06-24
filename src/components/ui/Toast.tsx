/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, useRef, useEffect, type PropsWithChildren } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../../lib/utils'

type ToastType = 'success' | 'error' | 'info'

interface ToastOptions {
  message: string
  type?: ToastType
  duration?: number
}

interface ToastData {
  id: number
  type: ToastType
  message: string
  duration: number
  createdAt: number
}

type ToastContextValue = { showToast: (messageOrOpts: string | ToastOptions, type?: ToastType) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 4500,
  error: 8000,
  info: 4500,
}

const MAX_TOASTS = 5
const EXIT_ANIMATION_MS = 250

function ToastItem({ toast, onRemove }: { toast: ToastData; onRemove: (id: number) => void }) {
  const barRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const remainingRef = useRef(toast.duration)
  const createdAtRef = useRef(Date.now())
  const [exiting, setExiting] = useState(false)

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    const bar = barRef.current
    if (bar) {
      bar.style.animation = `toast-progress ${toast.duration}ms linear forwards`
    }
    timerRef.current = window.setTimeout(() => setExiting(true), toast.duration)
    return cleanup
  }, [toast.duration, cleanup])

  useEffect(() => {
    if (exiting) {
      const id = window.setTimeout(() => onRemove(toast.id), EXIT_ANIMATION_MS)
      return () => clearTimeout(id)
    }
  }, [exiting, toast.id, onRemove])

  const handleMouseEnter = useCallback(() => {
    const bar = barRef.current
    if (!bar) return

    const elapsed = Date.now() - createdAtRef.current
    remainingRef.current = Math.max(0, toast.duration - elapsed)

    if (remainingRef.current <= 0) {
      setExiting(true)
      return
    }

    bar.style.animationPlayState = 'paused'
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [toast.duration])

  const handleMouseLeave = useCallback(() => {
    const bar = barRef.current
    if (!bar) return

    bar.style.animation = 'none'
    void bar.offsetHeight
    bar.style.animation = `toast-progress ${remainingRef.current}ms linear forwards`

    timerRef.current = window.setTimeout(() => setExiting(true), remainingRef.current)
  }, [])

  const handleClose = useCallback(() => {
    cleanup()
    setExiting(true)
  }, [cleanup])

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={cn(
        'app-toast',
        toast.type === 'success' && 'app-toast--success',
        toast.type === 'error' && 'app-toast--error',
        toast.type === 'info' && 'app-toast--info',
        exiting && 'app-toast--exit',
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="app-toast__icon" aria-hidden="true">
        {toast.type === 'success' ? <CheckCircle2 size={18} /> : null}
        {toast.type === 'error' ? <AlertTriangle size={18} /> : null}
        {toast.type === 'info' ? <Info size={18} /> : null}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Fechar notificação"
        className="app-toast__close"
      >
        <X size={14} />
      </button>
      <div ref={barRef} className="app-toast__progress" />
    </div>
  )
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (messageOrOpts: string | ToastOptions, type?: ToastType) => {
      let message: string
      let toastType: ToastType
      let duration: number

      if (typeof messageOrOpts === 'string') {
        message = messageOrOpts
        toastType = type ?? 'info'
        duration = DEFAULT_DURATIONS[toastType]
      } else {
        message = messageOrOpts.message
        toastType = messageOrOpts.type ?? 'info'
        duration = messageOrOpts.duration ?? DEFAULT_DURATIONS[toastType]
      }

      const id = nextId++

      setToasts((current) => {
        const next = [...current, { id, type: toastType, message, duration, createdAt: Date.now() }]
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS)
        }
        return next
      })
    },
    [],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="app-toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onRemove={removeToast} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast deve ser usado dentro de ToastProvider')
  return value
}
