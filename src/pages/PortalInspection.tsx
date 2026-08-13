import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { PortalLayout } from '../components/layout/PortalLayout'
import { PortalScopeProvider } from '../hooks/usePortalScope'
import { openPortalInspection, type PortalScope } from '../services/portalScope'
import { Button } from '../components/ui/Button'
import { formatCnpjCpf } from '../lib/utils'
import type { PortalSessionOverview } from '../services/portalBilling'

export function PortalInspection() {
  const { customerId } = useParams<{ customerId: string }>()
  const numericCustomerId = Number(customerId)
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [error, setError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const origin = new URLSearchParams(location.search).get('origem')
  useEffect(() => {
    if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) return
    void openPortalInspection(numericCustomerId, origin).then(setOverview).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a inspeção.'))
  }, [numericCustomerId, origin])
  if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) return <Navigate to="/painel" replace />
  if (error) return <main className="p-6"><div className="rounded-xl border border-red-400/40 p-4 text-red-200">{error}</div></main>
  if (!overview) return <main className="p-6 text-sm text-[var(--app-muted)]">Abrindo Modo Inspeção...</main>
  const scope: PortalScope = { mode: 'inspect', customerId: numericCustomerId, overview, basePath: `/clientes/portal/inspecao/${numericCustomerId}` }
  return <PortalScopeProvider scope={scope}><div className="border-b border-amber-400/40 bg-amber-950/30 px-4 py-2 text-sm text-amber-100"><div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3"><div><strong>Modo Inspeção</strong> · {overview.customer_name} · {formatCnpjCpf(overview.customer_cnpj_cpf)}{overview.account_active === false ? ' · Conta não ativa' : ''}</div><Button variant="ghost" onClick={() => navigate('/clientes/portal')}>Sair da inspeção</Button></div></div><PortalLayout /></PortalScopeProvider>
}
