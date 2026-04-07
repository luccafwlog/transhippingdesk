import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const base =
  'w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#1f6feb] focus:ring-2 focus:ring-[#1f6feb]/30'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, className)} {...props} />
})

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'min-h-24', className)} {...props} />
}

export function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="grid gap-1.5 text-sm text-slate-300">
      <span>{label}</span>
      {children}
      {error ? <span className="text-xs text-[#f85149]">{error}</span> : null}
    </label>
  )
}
