import { type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
}

const variants = {
  primary: 'app-btn--primary',
  secondary: 'app-btn--secondary',
  danger: 'app-btn--danger',
  ghost: 'app-btn--ghost',
}

export function Button({ className, variant = 'primary', loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'app-btn',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          Carregando...
        </>
      ) : (
        children
      )}
    </button>
  )
}
