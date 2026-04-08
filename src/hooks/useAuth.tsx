/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import type { UserProfile } from '../types/database'

type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  isAdmin: boolean
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

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

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

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      isAdmin: profile?.role === 'admin',
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },
    }),
    [loading, profile, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }

  return value
}
