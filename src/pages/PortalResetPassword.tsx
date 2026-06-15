import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'

export function PortalResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(
    () => window.location.hash.includes('type=recovery'),
  )

  useEffect(() => {
    const { data: listener } = supabasePortal.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })
    return () => listener?.subscription.unsubscribe()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A senha deve ter no minimo 8 caracteres.')
      return
    }

    if (password !== confirm) {
      setError('As senhas nao conferem.')
      return
    }

    setSubmitting(true)

    try {
      const { error: updateError } = await supabasePortal.auth.updateUser({ password })
      if (updateError) throw updateError
      navigate('/portal/login', { replace: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao redefinir senha.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) {
    return (
      <main className="app-auth">
        <Card className="app-auth__card">
          <p className="text-sm text-[var(--app-muted)]">Verificando link de recuperacao...</p>
        </Card>
      </main>
    )
  }

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Transhipping" className="app-auth__logo" src="/branding/transhipping-logo.png" />
          <div>
            <h1 className="app-auth__title">Redefinir senha</h1>
            <p className="app-auth__subtitle">Escolha uma nova senha para acessar o portal.</p>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="Nova senha">
            <Input
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimo 8 caracteres"
            />
          </Field>

          <Field label="Confirmar senha">
            <Input
              required
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repita a senha"
            />
          </Field>

          {error ? <InlineError message={error} /> : null}

          <Button loading={submitting} type="submit">
            Redefinir senha
          </Button>
        </form>
      </Card>
    </main>
  )
}
