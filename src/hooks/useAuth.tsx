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

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)

      if (data.session?.user) {
        try {
          setProfile(await loadProfile(data.session.user.id))
        } catch {
          setProfile(null)
        }
      }

      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession)

      if (nextSession?.user) {
        try {
          setProfile(await loadProfile(nextSession.user.id))
        } catch {
          setProfile(null)
        }
      } else {
        setProfile(null)
      }

      setLoading(false)
    })

    return () => {
      mounted = false
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
