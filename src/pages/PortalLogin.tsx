import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { isSupabaseConfigured } from '../services/supabase'

function isCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === 14
}

function isCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11
}

export function PortalLogin() {
  const navigate = useNavigate()
  const { isAuthenticated, loading, signIn } = usePortalAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && isAuthenticated) {
    return <Navigate to="/portal" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(login, password)
      navigate('/portal', { replace: true })
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null ? String((err as { code?: string }).code ?? '') : ''
      if (code === 'P0429') {
        setError('Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.')
      } else {
        setError('Credenciais inválidas para o portal do cliente.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const isCnpjInput = isCnpj(login)
  const isCpfInput = isCpf(login)

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img
            alt="Transhipping"
            className="app-auth__logo"
            src="/branding/transhipping-logo-cropped.png"
            onError={(event) => {
              event.currentTarget.onerror = null
              event.currentTarget.src = '/branding/tr-logo.png'
            }}
          />
          <div>
            <h1 className="app-auth__title">Portal do cliente</h1>
            <p className="app-auth__subtitle">Consulte faturas emitidas e consolide B/Ls prontos para faturamento.</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="app-callout app-callout--warning">
            Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label={isCnpjInput ? 'CNPJ' : isCpfInput ? 'CPF' : 'Login'}>
            <Input
              required
              type="text"
              inputMode="email"
              autoComplete="username"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              placeholder="CNPJ ou email cadastrado"
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

          {error ? <InlineError message={error} /> : null}

          <Button loading={submitting} type="submit">
            Entrar no portal
          </Button>
        </form>

        <div className="mt-3 text-center text-sm">
          <Link to="/portal/esqueci-senha" className="text-[var(--app-link)] hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <p className="app-auth__meta">
          Acesso provisionado internamente por cliente. Não há cadastro público.
          <br />
          Problemas para acessar? Solicite um novo acesso ao seu contato comercial na Transhipping.
        </p>
      </Card>
    </main>
  )
}
