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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#30363d] bg-[#161b22] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <Button variant="ghost" className="h-8 w-8 p-0" onClick={onClose} aria-label="Fechar modal">
            <X size={18} />
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
