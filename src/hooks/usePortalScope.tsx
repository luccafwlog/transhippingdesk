/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { Outlet } from 'react-router-dom'
import { PortalAuthContext } from './usePortalAuth'
import { clientPortalScope, type PortalScope } from '../services/portalScope'

const PortalScopeContext = createContext<PortalScope | null>(null)

export function PortalScopeProvider({ scope, children }: PropsWithChildren<{ scope?: PortalScope }>) {
  const auth = useContext(PortalAuthContext)
  const overview = auth?.overview ?? null
  const value = useMemo<PortalScope>(() => scope ?? { ...clientPortalScope, overview }, [overview, scope])
  // App.tsx uses this as a layout route (`<Route element={<PortalScopeProvider />}>`),
  // which passes no `children` — without the `<Outlet/>` fallback, every nested
  // /portal route renders nothing.
  return <PortalScopeContext.Provider value={value}>{children ?? <Outlet />}</PortalScopeContext.Provider>
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
