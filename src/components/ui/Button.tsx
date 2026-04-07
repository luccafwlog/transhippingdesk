import { type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
}

const variants = {
  primary: 'bg-[#1f6feb] text-white hover:bg-blue-500 disabled:bg-blue-950',
  secondary: 'bg-[#21262d] text-slate-100 hover:bg-[#30363d] disabled:bg-[#161b22]',
  danger: 'bg-[#f85149] text-white hover:bg-red-500 disabled:bg-red-950',
  ghost: 'bg-transparent text-slate-300 hover:bg-[#21262d] disabled:bg-transparent',
}

export function Button({ className, variant = 'primary', loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/70 disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? 'Carregando...' : children}
    </button>
  )
}
