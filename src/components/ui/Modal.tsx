import { X } from 'lucide-react'
import { Button } from './Button'

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="app-modal-backdrop">
      <div className="app-modal">
        <div className="app-modal__header">
          <h2 className="app-modal__title">{title}</h2>
          <Button variant="ghost" className="app-modal__close" onClick={onClose} aria-label="Fechar modal">
            <X size={18} />
          </Button>
        </div>
        <div className="app-modal__body">{children}</div>
      </div>
    </div>
  )
}
