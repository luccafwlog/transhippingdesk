/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { supabase } from '../services/supabase'
import { portalGetSessionOverview, portalLogin, portalLogout, type PortalSessionOverview } from '../services/portalBilling'

// Token legado (compatibilidade com contas sem auth_user_id provisionado)
const STORAGE_KEY = 'td.portal.session.token'

type AuthMethod = 'supabase_auth' | 'legacy_token'

type PortalAuthContextValue = {
  sessionToken: string | null
  overview: PortalSessionOverview | null
  loading: boolean
  isAuthenticated: boolean
  authMethod: AuthMethod | null
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

// Busca visão geral via Supabase Auth (RPC v2 sem token)
async function fetchOverviewViaSupabaseAuth(): Promise<PortalSessionOverview> {
  const { data, error } = await supabase.rpc('portal_get_session_overview_v2')
  if (error) throw error
  return data as PortalSessionOverview
}

// Verifica qual método de auth está disponível para o cnpj_cpf
async function checkAuthMethod(cnpjCpf: string): Promise<{ method: string; portal_email?: string }> {
  const { data, error } = await supabase.rpc('portal_check_auth_method', { p_cnpj_cpf: cnpjCpf })
  if (error) throw error
  return data as { method: string; portal_email?: string }
}

export function PortalAuthProvider({ children }: PropsWithChildren) {
  const [sessionToken, setSessionToken] = useState<string | null>(() => readStoredToken())
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null)

  const clearSession = useCallback(() => {
    setSessionToken(null)
    setOverview(null)
    setAuthMethod(null)
    persistToken(null)
  }, [])

  // Hidratação: detectar se há sessão Supabase Auth ativa primeiro
  useEffect(() => {
    let mounted = true

    async function hydrate() {
      try {
        // Tentar sessão Supabase Auth primeiro
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const ov = await fetchOverviewViaSupabaseAuth()
          if (mounted) {
            setOverview(ov)
            setAuthMethod('supabase_auth')
          }
          return
        }

        // Fallback: token legado em localStorage
        const token = readStoredToken()
        if (!token) return

        const ov = await portalGetSessionOverview(token)
        if (mounted) {
          setOverview(ov)
          setSessionToken(token)
          setAuthMethod('legacy_token')
        }
      } catch (error) {
        if (isPortalSessionError(error) && mounted) {
          clearSession()
          await supabase.auth.signOut()
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void hydrate()
    return () => { mounted = false }
  }, [clearSession])

  const signIn = useCallback(async (cnpjCpf: string, password: string) => {
    setLoading(true)
    try {
      const methodInfo = await checkAuthMethod(cnpjCpf)

      if (methodInfo.method === 'supabase_auth' && methodInfo.portal_email) {
        // Fluxo Supabase Auth
        const { error } = await supabase.auth.signInWithPassword({
          email: methodInfo.portal_email,
          password,
        })
        if (error) throw new Error(error.message)
        const ov = await fetchOverviewViaSupabaseAuth()
        setOverview(ov)
        setAuthMethod('supabase_auth')
        persistToken(null) // garantir que token legado não fica ativo
      } else if (methodInfo.method === 'legacy_token') {
        // Fluxo legado (token)
        const result = await portalLogin(cnpjCpf, password)
        persistToken(result.token)
        setSessionToken(result.token)
        const ov = await portalGetSessionOverview(result.token)
        setOverview(ov)
        setAuthMethod('legacy_token')
      } else if (methodInfo.method === 'inactive') {
        throw new Error('Acesso ao portal desativado. Entre em contato com o suporte.')
      } else {
        throw new Error('Credenciais invalidas.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    const token = sessionToken
    const method = authMethod
    clearSession()

    if (method === 'supabase_auth') {
      await supabase.auth.signOut()
    } else if (token) {
      try {
        await portalLogout(token)
      } catch {
        // local session already cleared
      }
    }
  }, [clearSession, sessionToken, authMethod])

  const refreshOverview = useCallback(async () => {
    if (authMethod === 'supabase_auth') {
      try {
        const ov = await fetchOverviewViaSupabaseAuth()
        setOverview(ov)
      } catch (error) {
        if (isPortalSessionError(error)) {
          clearSession()
          await supabase.auth.signOut()
        }
        throw error
      }
      return
    }

    if (!sessionToken) {
      clearSession()
      return
    }

    try {
      const ov = await portalGetSessionOverview(sessionToken)
      setOverview(ov)
    } catch (error) {
      if (isPortalSessionError(error)) {
        clearSession()
      }
      throw error
    }
  }, [authMethod, clearSession, sessionToken])

  const value = useMemo(
    () => ({
      sessionToken,
      overview,
      loading,
      isAuthenticated: Boolean(overview),
      authMethod,
      signIn,
      signOut,
      refreshOverview,
    }),
    [authMethod, loading, overview, refreshOverview, sessionToken, signIn, signOut],
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
