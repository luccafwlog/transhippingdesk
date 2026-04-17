import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { formatCnpjCpf, onlyDigits } from '../lib/utils'
import { isSupabaseConfigured } from '../services/supabase'

export function PortalLogin() {
  const navigate = useNavigate()
  const { isAuthenticated, loading, signIn } = usePortalAuth()
  const [cnpjCpf, setCnpjCpf] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && isAuthenticated) {
    return <Navigate to="/portal/billing" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(onlyDigits(cnpjCpf), password)
      navigate('/portal/billing', { replace: true })
    } catch {
      setError('Credenciais invalidas para o portal do cliente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Transhipping" className="app-auth__logo" src="/branding/transhipping-logo.png" />
          <div>
            <h1 className="app-auth__title">Portal do cliente</h1>
            <p className="app-auth__subtitle">Consulte invoices emitidas e consolide B/Ls prontos para faturamento.</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="CNPJ/CPF">
            <Input
              required
              value={cnpjCpf ? formatCnpjCpf(cnpjCpf) : ''}
              onChange={(event) => setCnpjCpf(onlyDigits(event.target.value))}
            />
          </Field>

          <Field label="Senha">
            <Input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

          <Button loading={submitting} type="submit">
            Entrar no portal
          </Button>
        </form>

        <p className="text-xs text-slate-500">Acesso provisionado internamente por cliente. Nao ha cadastro publico.</p>
      </Card>
    </main>
  )
}
