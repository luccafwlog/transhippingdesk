/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { portalGetSessionOverview, portalLogin, portalLogout, type PortalSessionOverview } from '../services/portalBilling'

const STORAGE_KEY = 'td.portal.session.token'

type PortalAuthContextValue = {
  sessionToken: string | null
  overview: PortalSessionOverview | null
  loading: boolean
  isAuthenticated: boolean
  signIn: (cnpjCpf: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshOverview: () => Promise<void>
}

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null)

function readStoredToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

function persistToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) {
    window.localStorage.setItem(STORAGE_KEY, token)
    return
  }
  window.localStorage.removeItem(STORAGE_KEY)
}

function isPortalSessionError(error: unknown) {
  const code = typeof error === 'object' && error ? String((error as { code?: string }).code ?? '') : ''
  const message = typeof error === 'object' && error ? String((error as { message?: string }).message ?? '') : ''
  return code === '28000' || message.toLowerCase().includes('sessao do portal')
}

export function PortalAuthProvider({ children }: PropsWithChildren) {
  const [sessionToken, setSessionToken] = useState<string | null>(() => readStoredToken())
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const loadOverview = useCallback(async (token: string) => {
    const nextOverview = await portalGetSessionOverview(token)
    setOverview(nextOverview)
  }, [])

  const clearSession = useCallback(() => {
    setSessionToken(null)
    setOverview(null)
    persistToken(null)
  }, [])

  useEffect(() => {
    let mounted = true

    async function hydrate() {
      if (!sessionToken) {
        if (mounted) setLoading(false)
        return
      }

      try {
        await loadOverview(sessionToken)
      } catch (error) {
        if (isPortalSessionError(error) && mounted) {
          clearSession()
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void hydrate()

    return () => {
      mounted = false
    }
  }, [clearSession, loadOverview, sessionToken])

  const signIn = useCallback(async (cnpjCpf: string, password: string) => {
    setLoading(true)
    try {
      const result = await portalLogin(cnpjCpf, password)
      persistToken(result.token)
      setSessionToken(result.token)
      await loadOverview(result.token)
    } finally {
      setLoading(false)
    }
  }, [loadOverview])

  const signOut = useCallback(async () => {
    const token = sessionToken
    clearSession()
    if (!token) return

    try {
      await portalLogout(token)
    } catch {
      // local session is already cleared
    }
  }, [clearSession, sessionToken])

  const refreshOverview = useCallback(async () => {
    if (!sessionToken) {
      clearSession()
      return
    }

    try {
      await loadOverview(sessionToken)
    } catch (error) {
      if (isPortalSessionError(error)) {
        clearSession()
      }
      throw error
    }
  }, [clearSession, loadOverview, sessionToken])

  const value = useMemo(
    () => ({
      sessionToken,
      overview,
      loading,
      isAuthenticated: Boolean(sessionToken && overview),
      signIn,
      signOut,
      refreshOverview,
    }),
    [loading, overview, refreshOverview, sessionToken, signIn, signOut],
  )

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>
}

export function usePortalAuth() {
  const context = useContext(PortalAuthContext)
  if (!context) {
    throw new Error('usePortalAuth deve ser usado dentro de PortalAuthProvider.')
  }
  return context
}
