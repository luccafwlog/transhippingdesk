import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'

export type VisualTheme = 'current' | 'dark' | 'light' | 'editorial'

const storageKey = 'transhipping_visual_theme'

type VisualThemeContextValue = {
  theme: VisualTheme
  setTheme: (theme: VisualTheme) => void
}

const VisualThemeContext = createContext<VisualThemeContextValue | null>(null)

function isVisualTheme(value: string | null): value is VisualTheme {
  return value === 'current' || value === 'dark' || value === 'light' || value === 'editorial'
}

export function VisualThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<VisualTheme>(() => {
    if (typeof window === 'undefined') return 'current'
    const stored = window.localStorage.getItem(storageKey)
    return isVisualTheme(stored) ? stored : 'current'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-visual-theme', theme)
    window.localStorage.setItem(storageKey, theme)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme],
  )

  return createElement(VisualThemeContext.Provider, { value }, children)
}

export function useVisualTheme() {
  const context = useContext(VisualThemeContext)
  if (!context) {
    throw new Error('useVisualTheme must be used within VisualThemeProvider')
  }
  return context
}
