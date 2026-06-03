/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { supabase } from '../services/supabase'
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

function normalizePortalOverview(payload: Record<string, unknown>) {
  return {
    customer_id: Number(payload.customer_id ?? 0),
    customer_name: String(payload.customer_name ?? ''),
    customer_cnpj_cpf: String(payload.customer_cnpj_cpf ?? payload.cnpj_cpf ?? ''),
    pending_balance: payload.pending_balance == null ? null : Number(payload.pending_balance),
    contact_email: payload.contact_email == null ? null : String(payload.contact_email),
  } as PortalSessionOverview
}

async function fetchOverview(): Promise<PortalSessionOverview> {
  const { data, error } = await supabase.rpc('portal_get_session_overview_v2')
  if (error) throw error
  return normalizePortalOverview((data ?? {}) as Record<string, unknown>)
}

export function PortalAuthProvider({ children }: PropsWithChildren) {
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const clearSession = useCallback(() => {
    setOverview(null)
  }, [])

  useEffect(() => {
    let mounted = true

    async function hydrate() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const ov = await fetchOverview()
        if (mounted) setOverview(ov)
      } catch (error) {
        // Sessão Supabase pode existir sem perfil de portal (ex.: usuário interno);
        // nesse caso apenas não autentica no portal, sem derrubar a sessão global.
        if (isPortalSessionError(error) && mounted) clearSession()
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void hydrate()
    return () => { mounted = false }
  }, [clearSession])

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw new Error(error.message)
      const ov = await fetchOverview()
      setOverview(ov)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    clearSession()
    await supabase.auth.signOut()
  }, [clearSession])

  const refreshOverview = useCallback(async () => {
    try {
      const ov = await fetchOverview()
      setOverview(ov)
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
