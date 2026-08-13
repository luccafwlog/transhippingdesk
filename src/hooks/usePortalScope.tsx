/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { usePortalAuth } from './usePortalAuth'
import { clientPortalScope, type PortalScope } from '../services/portalScope'

const PortalScopeContext = createContext<PortalScope | null>(null)

export function PortalScopeProvider({ scope, children }: PropsWithChildren<{ scope?: PortalScope }>) {
  const auth = usePortalAuth()
  const value = useMemo<PortalScope>(() => scope ?? { ...clientPortalScope, overview: auth.overview }, [auth.overview, scope])
  return <PortalScopeContext.Provider value={value}>{children}</PortalScopeContext.Provider>
}

export function usePortalScope() {
  const context = useContext(PortalScopeContext)
  if (context) return context
  try {
    const auth = usePortalAuth()
    return { ...clientPortalScope, overview: auth.overview }
  } catch {
    // Isolated component tests may render a Portal consumer without the app
    // provider; preserve the historical client-mode default there.
    return clientPortalScope
  }
}
