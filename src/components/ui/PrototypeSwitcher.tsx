// PROTÓTIPO — descartável. Barra flutuante para alternar variantes de UI via
// `?variant=`. Não faz parte do design avaliado e não aparece em produção.
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type PrototypeSwitcherProps = {
  variants: readonly string[]
  labels?: Record<string, string>
  current: string
  paramName?: string
}

export function PrototypeSwitcher({
  variants,
  labels,
  current,
  paramName = 'variant',
}: PrototypeSwitcherProps) {
  const [searchParams, setSearchParams] = useSearchParams()

  const index = Math.max(0, variants.indexOf(current))

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = variants[(index + delta + variants.length) % variants.length]
      const params = new URLSearchParams(searchParams)
      params.set(paramName, next)
      setSearchParams(params, { replace: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, paramName, searchParams, setSearchParams, variants])

  if (import.meta.env.PROD) return null

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length]
    const params = new URLSearchParams(searchParams)
    params.set(paramName, next)
    setSearchParams(params, { replace: true })
  }

  return (
    <div
      className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-black/70 bg-black px-2 py-1.5 text-white shadow-2xl"
      style={{ fontFamily: 'ui-monospace, monospace' }}
    >
      <button
        type="button"
        onClick={() => go(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/20"
        aria-label="Variante anterior"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="px-2 text-xs font-semibold tracking-wide">
        PROTÓTIPO · {current}
        {labels?.[current] ? ` — ${labels[current]}` : ''}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/20"
        aria-label="Próxima variante"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
