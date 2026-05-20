import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { isSupabaseConfigured } from '../services/supabase'
import { useAuth } from '../hooks/useAuth'

export function Login() {
  const navigate = useNavigate()
  const { user, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to="/painel" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(email, password)
      navigate('/painel', { replace: true })
    } catch {
      setError('Credenciais inválidas ou usuário sem permissão ativa.')
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
            <h1 className="app-auth__title">Acesso interno</h1>
            <p className="app-auth__subtitle">Entre com email e senha provisionados pelo administrador.</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="app-callout app-callout--warning">
            Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="Email">
            <Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
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
            Entrar
          </Button>
        </form>

        <p className="app-auth__meta">Não há cadastro público. Usuários são provisionados pelo admin.</p>
      </Card>
    </main>
  )
}
