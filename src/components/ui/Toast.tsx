/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'

type ToastType = 'success' | 'error' | 'info'
type Toast = { id: number; type: ToastType; message: string }
type ToastContextValue = { showToast: (message: string, type?: ToastType) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now()
    setToasts((current) => [...current, { id, type, message }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4200)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] grid w-[min(24rem,calc(100vw-2rem))] gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'rounded-xl border px-4 py-3 text-sm shadow-xl',
              toast.type === 'success' && 'border-emerald-400/30 bg-emerald-950 text-emerald-100',
              toast.type === 'error' && 'border-red-400/30 bg-red-950 text-red-100',
              toast.type === 'info' && 'border-blue-400/30 bg-blue-950 text-blue-100',
            )}
          >
            {toast.message}
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
