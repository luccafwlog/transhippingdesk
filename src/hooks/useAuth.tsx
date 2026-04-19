/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import type { UserProfile, UserProfileRole } from '../types/database'

export type Permission =
  | 'admin_panel'
  | 'manage_users'
  | 'charge_tables'
  | 'charge_overrides'
  | 'demurrage_edit'
  | 'faturamento_edit'
  | 'reconciliacao_edit'
  | 'voyages_edit'
  | 'manifests_upload'

function roleHasPermission(role: UserProfileRole | undefined, permission: Permission): boolean {
  if (!role) return false
  // Legacy roles: admin = administrativo, operator = documentacao
  const effectiveRole: UserProfileRole =
    role === 'admin' ? 'administrativo' : role === 'operator' ? 'documentacao' : role

  switch (effectiveRole) {
    case 'administrativo':
      return true
    case 'financeiro':
      return ['charge_tables', 'charge_overrides', 'demurrage_edit', 'faturamento_edit', 'reconciliacao_edit'].includes(permission)
    case 'operacoes':
      return ['voyages_edit', 'manifests_upload'].includes(permission)
    case 'documentacao':
      return ['voyages_edit', 'manifests_upload', 'demurrage_edit', 'faturamento_edit', 'reconciliacao_edit'].includes(permission)
    default:
      return false
  }
}

type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  isAdmin: boolean
  can: (permission: Permission) => boolean
  effectiveRole: UserProfileRole | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .eq('active', true)
    .single()

  if (error) {
    throw error
  }

  return data
}

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 horas

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let lastActivity = Date.now()

    function onActivity() {
      lastActivity = Date.now()
    }

    const activityEvents = ['mousemove', 'keydown', 'click', 'touchstart'] as const
    for (const event of activityEvents) {
      window.addEventListener(event, onActivity, { passive: true })
    }

    const idleInterval = window.setInterval(() => {
      if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        void supabase.auth.signOut()
      }
    }, 60_000)

    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, onActivity)
      }
      window.clearInterval(idleInterval)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const fallbackTimer = window.setTimeout(() => {
      if (mounted) {
        setLoading(false)
      }
    }, 8000)

    async function hydrateSession(nextSession: Session | null) {
      if (!mounted) return

      setSession(nextSession)

      try {
        if (nextSession?.user) {
          setProfile(await loadProfile(nextSession.user.id))
        } else {
          setProfile(null)
        }
      } catch {
        if (mounted) {
          setProfile(null)
        }
      } finally {
        if (mounted) {
          window.clearTimeout(fallbackTimer)
          setLoading(false)
        }
      }
    }

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        await hydrateSession(data.session)
      } catch {
        if (mounted) {
          setProfile(null)
          setLoading(false)
        }
      }
    })()

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void hydrateSession(nextSession)
    })

    return () => {
      mounted = false
      window.clearTimeout(fallbackTimer)
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const role = profile?.role
    const effectiveRole: UserProfileRole | null = !role ? null :
      role === 'admin' ? 'administrativo' :
      role === 'operator' ? 'documentacao' :
      role
    return {
      user: session?.user ?? null,
      session,
      profile,
      loading,
      isAdmin: role === 'admin' || role === 'administrativo',
      effectiveRole,
      can: (permission: Permission) => roleHasPermission(role, permission),
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },
    }
  }, [loading, profile, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }

  return value
}
