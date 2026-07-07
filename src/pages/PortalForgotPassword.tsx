import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'
import { portalResolveLogin } from '../services/portalBilling'

export function PortalForgotPassword() {
  const [login, setLogin] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const value = login.trim()
      let email = value

      // Se não parece um email, tenta resolver como CNPJ/CPF
      if (!value.includes('@')) {
        const digits = value.replace(/\D/g, '')
        if (digits.length === 11 || digits.length === 14) {
          email = await portalResolveLogin(value)
        }
      }

      const { error: resetError } = await supabasePortal.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/portal/recuperar-senha`,
      })

      if (resetError) throw resetError
      setSent(true)
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null ? String((err as { code?: string }).code ?? '') : ''
      if (code === 'P0429') {
        setError('Muitas tentativas de recuperacao. Aguarde alguns minutos antes de tentar novamente.')
      } else {
        setError('Se o CNPJ ou email informado estiver cadastrado, enviaremos um link para redefinir sua senha.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <main className="app-auth">
        <Card className="app-auth__card">
          <div className="app-auth__brand">
            <img alt="Transhipping" className="app-auth__logo app-auth__logo--on-light" src="/branding/transhipping-logo.png" />
            <div>
              <h1 className="app-auth__title">Email enviado</h1>
            </div>
          </div>
          <p className="text-sm text-[var(--app-muted)]">
            Se o CNPJ ou email informado estiver cadastrado, voce recebera um link para redefinir sua senha.
          </p>
          <div className="mt-4 text-center">
            <Link to="/portal/login" className="text-sm text-[var(--app-link)] hover:underline">
              Voltar para o login
            </Link>
          </div>
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
            <h1 className="app-auth__title">Recuperar senha</h1>
            <p className="app-auth__subtitle">Informe seu CNPJ ou email cadastrado para receber o link de redefinicao.</p>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="CNPJ ou Email">
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

          {error ? <InlineError message={error} /> : null}

          <Button loading={submitting} type="submit">
            Enviar link de recuperacao
          </Button>
        </form>

        <div className="mt-3 text-center text-sm">
          <Link to="/portal/login" className="text-[var(--app-link)] hover:underline">
            Voltar para o login
          </Link>
        </div>

        <p className="app-auth__meta">
          O link sera enviado para o email cadastrado na sua conta de portal.
          <br />
          Problemas? Solicite um novo acesso ao seu contato comercial na Transhipping.
        </p>
      </Card>
    </main>
  )
}
