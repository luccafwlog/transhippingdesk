import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const base = 'app-input'

function hasWidthOverride(className?: string) {
  return /\b(?:w|min-w|max-w)-[^\s]+/.test(className ?? '')
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, !hasWidthOverride(className) && 'app-input--full', className)} {...props} />
})

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, 'app-select', !hasWidthOverride(className) && 'app-input--full', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'app-input--full', 'app-textarea', className)} {...props} />
}

export function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="app-field">
      <span className="app-field__label">{label}</span>
      {children}
      {error ? <span className="app-field__error">{error}</span> : null}
    </label>
  )
}
