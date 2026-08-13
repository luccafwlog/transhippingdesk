import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'
import { portalErrorMessage } from '../lib/portalErrorMessage'

const INVALID_LINK_MESSAGE = 'Link de recuperacao invalido ou expirado.'

export function PortalResetPassword() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token] = useState(() => searchParams.get('token'))
  // Achado 3.3 (auditoria 2026-08-12): o token vaza para a telemetria via
  // event.request.url se permanecer na URL. Removido da barra de enderecos
  // assim que lido, mantido em estado para o submit (espelha PortalProfile).
  useEffect(() => {
    if (!searchParams.get('token')) return
    searchParams.delete('token')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(() => (token ? '' : INVALID_LINK_MESSAGE))
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setError('A senha deve ter no minimo 8 caracteres, com letra maiuscula, minuscula e numero.')
      return
    }

    if (password !== confirm) {
      setError('As senhas nao conferem.')
      return
    }

    setSubmitting(true)

    try {
      if (!token) throw new Error(INVALID_LINK_MESSAGE)
      const { error: updateError } = await supabasePortal.functions.invoke('portal-password-reset', { body: { token, password } })
      if (updateError) throw updateError
      setDone(true)
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao redefinir senha. Tente novamente em instantes.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className="app-auth">
        <Card className="app-auth__card">
          <div className="app-auth__brand">
            <img alt="Transhipping" className="app-auth__logo app-auth__logo--on-light" src="/branding/transhipping-logo.png" />
            <div>
              <h1 className="app-auth__title">Senha redefinida</h1>
            </div>
          </div>
          <p className="text-sm text-[var(--app-muted)]">
            Sua senha foi alterada com sucesso e as sessoes anteriores foram encerradas. Entre novamente com a nova senha.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate('/portal/login', { replace: true })}>Ir para o login</Button>
          </div>
        </Card>
      </main>
    )
  }

  if (!token) {
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
          <img alt="Transhipping" className="app-auth__logo app-auth__logo--on-light" src="/branding/transhipping-logo.png" />
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
