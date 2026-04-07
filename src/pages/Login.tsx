import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Ship } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
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
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1f6feb]/20 text-[#58a6ff]">
            <Ship />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Transhipping Desk</h1>
            <p className="text-sm text-slate-400">Acesso interno por email e senha</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="Email">
            <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </Field>
          <Field label="Senha">
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
            />
          </Field>
          {error ? <div className="rounded-lg bg-[#f85149]/10 p-3 text-sm text-red-200">{error}</div> : null}
          <Button loading={submitting} type="submit">
            Entrar
          </Button>
        </form>

        <p className="mt-5 text-xs text-slate-500">Não há cadastro público. Usuários são provisionados pelo admin.</p>
      </Card>
    </main>
  )
}
