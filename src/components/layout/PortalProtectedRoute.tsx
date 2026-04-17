import { Navigate, Outlet } from 'react-router-dom'
import { usePortalAuth } from '../../hooks/usePortalAuth'

export function PortalProtectedRoute() {
  const { isAuthenticated, loading } = usePortalAuth()

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#0d1117] text-slate-300">Carregando portal...</div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />
  }

  return <Outlet />
}
