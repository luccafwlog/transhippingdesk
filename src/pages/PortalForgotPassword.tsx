import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'
import { normalizeCnpj } from '../lib/cnpj'

export function PortalForgotPassword() {
  const [cnpj, setCnpj] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const { data, error: resetError } = await supabasePortal.functions.invoke('portal-password-recovery', { body: { cnpj } })
      if (resetError) throw resetError
      setSent(data?.account_found === true && data?.email_sent === true)
      if (data?.account_found === null) setError('Não foi possível verificar o CNPJ agora. Aguarde alguns minutos e tente novamente.')
      else if (data?.account_found !== true) setError('Não existe uma conta do Portal vinculada a este CNPJ.')
      else if (data?.email_sent !== true) setError('Existe uma conta vinculada, mas não foi possível enviar o email de recuperação. Solicite atendimento à Transhipping.')
    } catch (err: unknown) {
      void err
      setError('Se o CNPJ informado estiver cadastrado, enviaremos um link para redefinir sua senha.')
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
              <h1 className="app-auth__title">Conta encontrada</h1>
            </div>
          </div>
          <p className="text-sm text-[var(--app-muted)]">
            Existe uma conta do Portal vinculada ao CNPJ informado. Enviamos um link para redefinir sua senha ao email cadastrado.
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
            <p className="app-auth__subtitle">Informe seu CNPJ cadastrado para receber o link de redefinicao.</p>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="CNPJ">
            <Input
              required
              type="text"
              inputMode="numeric"
              autoComplete="username"
              value={cnpj}
              onChange={(event) => setCnpj(normalizeCnpj(event.target.value))}
              placeholder="00000000000000"
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
