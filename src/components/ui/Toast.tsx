/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../../lib/utils'

type ToastType = 'success' | 'error' | 'info'
type Toast = { id: number; type: ToastType; message: string }
type ToastContextValue = { showToast: (message: string, type?: ToastType) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 4500

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Date.now()
      setToasts((current) => [...current, { id, type, message }])
      // Errors stay until manually dismissed; success/info auto-dismiss
      if (type !== 'error') {
        window.setTimeout(() => removeToast(id), AUTO_DISMISS_MS)
      }
    },
    [removeToast],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="app-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={cn(
              'app-toast',
              toast.type === 'success' && 'app-toast--success',
              toast.type === 'error' && 'app-toast--error',
              toast.type === 'info' && 'app-toast--info',
            )}
          >
            <span className="app-toast__icon" aria-hidden="true">
              {toast.type === 'success' ? <CheckCircle2 size={18} /> : null}
              {toast.type === 'error' ? <AlertTriangle size={18} /> : null}
              {toast.type === 'info' ? <Info size={18} /> : null}
            </span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Fechar notificação"
              className="app-toast__close"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast deve ser usado dentro de ToastProvider')
  return value
}
