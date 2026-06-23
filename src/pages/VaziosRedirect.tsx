import { Navigate, useLocation } from 'react-router-dom'

export function VaziosRedirect() {
  const location = useLocation()
  return <Navigate to={`/embarquevazios${location.search}`} replace />
}
