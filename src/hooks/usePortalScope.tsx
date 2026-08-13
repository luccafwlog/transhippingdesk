/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { PortalAuthContext } from './usePortalAuth'
import { clientPortalScope, type PortalScope } from '../services/portalScope'

const PortalScopeContext = createContext<PortalScope | null>(null)

export function PortalScopeProvider({ scope, children }: PropsWithChildren<{ scope?: PortalScope }>) {
  const auth = useContext(PortalAuthContext)
  const overview = auth?.overview ?? null
  const value = useMemo<PortalScope>(() => scope ?? { ...clientPortalScope, overview }, [overview, scope])
  return <PortalScopeContext.Provider value={value}>{children}</PortalScopeContext.Provider>
}

export function usePortalScope(): PortalScope {
  // Os dois `useContext` sao incondicionais de proposito: a versao anterior
  // chamava `usePortalAuth()` depois de um early return, o que viola
  // `react-hooks/rules-of-hooks`. Ler o contexto de auth direto (em vez do
  // hook, que lanca sem provider) preserva o fallback de teste isolado sem
  // ordem de hooks variavel.
  const scope = useContext(PortalScopeContext)
  const auth = useContext(PortalAuthContext)
  const overview = auth?.overview ?? null
  return useMemo<PortalScope>(() => scope ?? { ...clientPortalScope, overview }, [overview, scope])
}
