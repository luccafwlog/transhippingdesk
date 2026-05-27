/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { supabase } from '../services/supabase'
import { portalGetSessionOverview, portalLogin, portalLogout, type PortalSessionOverview } from '../services/portalBilling'

// Token legado (compatibilidade com contas sem auth_user_id provisionado).
// Usa sessionStorage em vez de localStorage para limitar exposição: tokens não
// persistem entre sessões do browser e ficam isolados por aba.
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
  return window.sessionStorage.getItem(STORAGE_KEY)
}

function persistToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) {
    window.sessionStorage.setItem(STORAGE_KEY, token)
    return
  }
  window.sessionStorage.removeItem(STORAGE_KEY)
}

function isPortalSessionError(error: unknown) {
  const code = typeof error === 'object' && error ? String((error as { code?: string }).code ?? '') : ''
  const message = typeof error === 'object' && error ? String((error as { message?: string }).message ?? '') : ''
  return code === '28000' || message.toLowerCase().includes('sessao do portal')
}

function normalizePortalOverview(payload: Record<string, unknown>) {
  return {
    customer_id: Number(payload.customer_id ?? 0),
    customer_name: String(payload.customer_name ?? ''),
    customer_cnpj_cpf: String(payload.customer_cnpj_cpf ?? payload.cnpj_cpf ?? ''),
    pending_balance: payload.pending_balance == null ? null : Number(payload.pending_balance),
    contact_email: payload.contact_email == null ? null : String(payload.contact_email),
  } as PortalSessionOverview
}

async function fetchOverviewViaSupabaseAuth(): Promise<PortalSessionOverview> {
  const { data, error } = await supabase.rpc('portal_get_session_overview_v2')
  if (error) throw error
  return normalizePortalOverview((data ?? {}) as Record<string, unknown>)
}

// Aceita apenas CPF (11 dígitos) ou CNPJ (14 dígitos). Remove qualquer
// formatação enviada pelo usuário antes de mandar para a RPC, evitando
// que strings arbitrárias atravessem o cliente para o Postgres.
function sanitizeCnpjCpf(input: string): string {
  const digits = (input ?? '').replace(/\D/g, '')
  if (digits.length !== 11 && digits.length !== 14) {
    throw new Error('CNPJ/CPF inválido.')
  }
  return digits
}

async function checkAuthMethod(cnpjCpf: string): Promise<{ method: string; portal_email?: string }> {
  const { data, error } = await supabase.rpc('portal_check_auth_method', { p_cnpj_cpf: cnpjCpf })
  if (error) throw error
  return (data ?? { method: 'none' }) as { method: string; portal_email?: string }
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

  useEffect(() => {
    let mounted = true

    async function hydrate() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          try {
            const ov = await fetchOverviewViaSupabaseAuth()
            if (mounted) {
              setOverview(ov)
              setAuthMethod('supabase_auth')
            }
          } catch (error) {
            // Sessão interna pode existir sem perfil de portal; não encerrar auth global.
            if (isPortalSessionError(error) && mounted) {
              clearSession()
            } else {
              throw error
            }
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
          return
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
      const sanitized = sanitizeCnpjCpf(cnpjCpf)
      const methodInfo = await checkAuthMethod(sanitized)

      if (methodInfo.method === 'supabase_auth' && methodInfo.portal_email) {
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
        const result = await portalLogin(sanitized, password)
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
        // portalLogout is best-effort; local session already cleared above
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
