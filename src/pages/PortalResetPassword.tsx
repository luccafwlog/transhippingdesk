import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'

const INVALID_LINK_MESSAGE = 'Link de recuperacao invalido ou expirado.'

function parseRecoveryTokens() {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(rawHash)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const type = params.get('type')

  if (type !== 'recovery' || !accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

export function PortalResetPassword() {
  const navigate = useNavigate()
  // O cliente do portal usa detectSessionInUrl: false (para nao competir com a
  // sessao do app interno no mesmo dominio), entao a sessao de recuperacao nao e
  // estabelecida automaticamente. Com o fluxo implicito (padrao), o link de
  // recuperacao traz os tokens no hash da URL; estabelecemos a sessao manualmente.
  const [recoveryTokens] = useState(parseRecoveryTokens)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(() => (recoveryTokens ? '' : INVALID_LINK_MESSAGE))
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!recoveryTokens) return
    let active = true

    supabasePortal.auth
      .setSession({ access_token: recoveryTokens.accessToken, refresh_token: recoveryTokens.refreshToken })
      .then(({ error: sessionError }) => {
        if (!active) return
        if (sessionError) {
          setError(INVALID_LINK_MESSAGE)
          return
        }
        // Remove os tokens do hash para nao reprocessar nem vazar na navegacao.
        window.history.replaceState(null, '', window.location.pathname)
        setReady(true)
      })

    return () => {
      active = false
    }
  }, [recoveryTokens])

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
          {error ? (
            <InlineError message={error} />
          ) : (
            <p className="text-sm text-[var(--app-muted)]">Verificando link de recuperacao...</p>
          )}
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
