import { useEffect, useId, useRef, useState } from 'react'

export type ComboOption = {
  value: string
  label: string
  meta?: string
}

type ComboboxProps = {
  label: string
  /** Texto inicial exibido no campo (semeado uma vez). */
  initialValue?: string
  placeholder?: string
  /** Disparado (com debounce de 300ms) a cada digitacao — usado para filtrar. */
  onValueChange: (value: string) => void
  /** Carrega sugestoes em tempo real conforme o texto digitado. */
  fetchOptions: (query: string) => Promise<ComboOption[]>
  /** Disparado ao escolher uma sugestao da lista. */
  onSelectOption?: (option: ComboOption) => void
  /** Minimo de caracteres antes de buscar sugestoes. */
  minChars?: number
}

const DEBOUNCE_MS = 300

// Campo de busca preditiva (combobox / typeahead). Auto-controlado: mantem o texto
// internamente e propaga as mudancas ja com debounce, evitando refazer a query a
// cada tecla.
export function Combobox({
  label,
  initialValue = '',
  placeholder,
  onValueChange,
  fetchOptions,
  onSelectOption,
  minChars = 1,
}: ComboboxProps) {
  const [text, setText] = useState(initialValue)
  const [touched, setTouched] = useState(false)
  const [options, setOptions] = useState<ComboOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const justSelectedRef = useRef(false)
  const onValueChangeRef = useRef(onValueChange)
  const fetchOptionsRef = useRef(fetchOptions)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    onValueChangeRef.current = onValueChange
    fetchOptionsRef.current = fetchOptions
  })

  // Debounce unico: propaga o filtro e busca as sugestoes 300ms apos a ultima tecla.
  // Ignora o disparo inicial (estado semeado via initialValue/URL) para nao
  // sobrescrever filtros ja aplicados antes do usuario interagir.
  useEffect(() => {
    if (!touched) return
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    const handle = window.setTimeout(() => {
      onValueChangeRef.current(text)
      const term = text.trim()
      if (term.length < minChars) {
        setOptions([])
        setLoading(false)
        return
      }
      setLoading(true)
      fetchOptionsRef
        .current(term)
        .then((result) => setOptions(result))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [text, minChars, touched])

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function handleSelect(option: ComboOption) {
    justSelectedRef.current = true
    setText(option.label)
    setOpen(false)
    setOptions([])
    setHighlight(-1)
    onSelectOption?.(option)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((current) => Math.min(current + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      if (open && highlight >= 0 && options[highlight]) {
        event.preventDefault()
        handleSelect(options[highlight])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="app-field" ref={containerRef} style={{ position: 'relative' }}>
      <span className="app-field__label">{label}</span>
      <input
        className="app-input app-input--full"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setTouched(true)
          setText(event.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => {
          if (options.length > 0) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (text.trim().length >= minChars) ? (
        <ul
          id={listId}
          role="listbox"
          className="app-combobox__list"
        >
          {loading ? (
            <li className="app-combobox__empty">Buscando…</li>
          ) : options.length === 0 ? (
            <li className="app-combobox__empty">Nenhuma sugestão</li>
          ) : (
            options.map((option, index) => (
              <li key={`${option.value}-${index}`} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={`app-combobox__option${index === highlight ? ' app-combobox__option--active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    handleSelect(option)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="app-combobox__option-label">{option.label}</span>
                  {option.meta ? <span className="app-combobox__option-meta">{option.meta}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
