/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { supabasePortal } from '../services/supabase'
import { signOutSupabaseClient } from '../services/supabaseAuth'
import { portalResolveLogin } from '../services/portalBilling'
import type { PortalSessionOverview } from '../services/portalBilling'

type PortalAuthContextValue = {
  overview: PortalSessionOverview | null
  loading: boolean
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshOverview: () => Promise<void>
}

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null)

function isPortalSessionError(error: unknown) {
  const code = typeof error === 'object' && error ? String((error as { code?: string }).code ?? '') : ''
  const message = typeof error === 'object' && error ? String((error as { message?: string }).message ?? '') : ''
  return code === '28000' || message.toLowerCase().includes('sessao do portal')
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error ? String((error as { code?: string }).code ?? '') : ''
}

function normalizePortalOverview(payload: Record<string, unknown>) {
  return {
    customer_id: Number(payload.customer_id ?? 0),
    customer_name: String(payload.customer_name ?? ''),
    customer_cnpj_cpf: String(payload.customer_cnpj_cpf ?? payload.cnpj_cpf ?? ''),
    pending_balance: payload.pending_balance == null ? null : Number(payload.pending_balance),
    contact_email: payload.contact_email == null ? null : String(payload.contact_email),
    login_cnpj: payload.login_cnpj == null ? null : String(payload.login_cnpj),
  } as PortalSessionOverview
}

async function fetchOverview(): Promise<PortalSessionOverview> {
  const { data, error } = await supabasePortal.rpc('portal_get_session_overview_v2')
  if (error) throw error
  return normalizePortalOverview((data ?? {}) as Record<string, unknown>)
}

function setPortalTelemetryUser(overview: PortalSessionOverview) {
  Sentry.setUser({ id: String(overview.customer_id) })
  Sentry.setTag('area', 'portal')
}

export function PortalAuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const clearPortalQueries = useCallback(() => {
    queryClient.removeQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith('portal-'),
    })
  }, [queryClient])

  const clearSession = useCallback(() => {
    setOverview(null)
    Sentry.setUser(null)
    clearPortalQueries()
  }, [clearPortalQueries])

  useEffect(() => {
    let mounted = true
    let hydrating = true

    async function hydrate() {
      try {
        const { data: { session } } = await supabasePortal.auth.getSession()
        if (!session) return

        const ov = await fetchOverview()
        if (mounted) {
          setOverview(ov)
          setPortalTelemetryUser(ov)
        }
      } catch (error) {
        // Sessão Supabase pode existir sem perfil de portal (ex.: usuário interno);
        // nesse caso apenas não autentica no portal, sem derrubar a sessão global.
        if (isPortalSessionError(error) && mounted) clearSession()
      } finally {
        if (mounted) setLoading(false)
        hydrating = false
      }
    }

    void hydrate()
    const { data: { subscription } } = supabasePortal.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearSession()
        return
      }

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && !hydrating) {
        void fetchOverview()
          .then((ov) => {
            if (mounted) setOverview((current) => current ?? ov)
            if (mounted) setPortalTelemetryUser(ov)
          })
          .catch((error) => {
            if (isPortalSessionError(error) && mounted) clearSession()
          })
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [clearSession])

  function isDocument(value: string): boolean {
    const digits = value.replace(/\D/g, '')
    return digits.length === 11 || digits.length === 14
  }

  const signIn = useCallback(async (login: string, password: string) => {
    setLoading(true)
    try {
      let email = login.trim()

      // Se não parece um email, tenta resolver como CNPJ/CPF
      if (!email.includes('@')) {
        if (isDocument(email)) {
          try {
            email = await portalResolveLogin(email)
          } catch (error) {
            if (errorCode(error) === 'P0429') throw error
            throw new Error('Credenciais invalidas para o portal do cliente.', { cause: error })
          }
        }
      }

      const { error } = await supabasePortal.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw new Error(error.message)
      const ov = await fetchOverview()
      setOverview(ov)
      setPortalTelemetryUser(ov)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    clearSession()
    await signOutSupabaseClient(supabasePortal)
  }, [clearSession])

  const refreshOverview = useCallback(async () => {
    try {
      const ov = await fetchOverview()
      setOverview(ov)
      setPortalTelemetryUser(ov)
    } catch (error) {
      if (isPortalSessionError(error)) clearSession()
      throw error
    }
  }, [clearSession])

  const value = useMemo(
    () => ({
      overview,
      loading,
      isAuthenticated: Boolean(overview),
      signIn,
      signOut,
      refreshOverview,
    }),
    [loading, overview, refreshOverview, signIn, signOut],
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
