import { Navigate, Outlet } from 'react-router-dom'
import { usePortalAuth } from '../../hooks/usePortalAuth'

export function PortalProtectedRoute() {
  const { isAuthenticated, loading } = usePortalAuth()

  if (loading) {
    return <div className="app-shell grid min-h-screen place-items-center text-[var(--app-text-muted)]">Carregando portal...</div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />
  }

  return <Outlet />
}
