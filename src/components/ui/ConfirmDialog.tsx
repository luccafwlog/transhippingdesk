/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

type ConfirmOptions = {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

type ConfirmState = ConfirmOptions & { open: boolean }

type ConfirmContextValue = { confirm: (options: ConfirmOptions) => Promise<boolean> }

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

const CLOSED: ConfirmState = { open: false, message: '' }

export function ConfirmDialogProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<ConfirmState>(CLOSED)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ ...options, open: true })
    })
  }, [])

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={state.open}
        title={state.title ?? 'Confirmar ação'}
        onClose={() => settle(false)}
        className="w-[min(100%,440px)]"
      >
        <div className="grid gap-5">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--app-text)' }}>
            {state.message}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => settle(false)}>
              {state.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button variant={state.tone === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {state.confirmLabel ?? 'Confirmar'}
            </Button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const value = useContext(ConfirmContext)
  if (!value) throw new Error('useConfirm deve ser usado dentro de ConfirmDialogProvider')
  return value.confirm
}
