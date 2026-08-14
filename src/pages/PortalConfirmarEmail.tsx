import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, InlineError } from '../components/ui/Card'
import { supabasePortal } from '../services/supabase'

const INVALID_LINK_MESSAGE = 'Link de confirmacao invalido ou expirado. Peca a troca novamente pelo Portal.'

// Rota publica, como `/portal/ativar` e `/portal/recuperar-senha`. A troca de
// email ja foi autorizada no pedido, que exigiu sessao ativa E senha atual; a
// confirmacao so precisa provar posse da caixa nova, e o token e essa prova.
// Exigir sessao aqui nao acrescentava barreira e trancava justamente quem le o
// Email de Recuperacao -- em geral o contato financeiro, que nao tem a senha.
export function PortalConfirmarEmail() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [token] = useState(() => searchParams.get('confirm_email') ?? searchParams.get('token'))
  const [state, setState] = useState<'confirmando' | 'ok' | 'erro'>(token ? 'confirmando' : 'erro')
  const [error, setError] = useState(token ? '' : INVALID_LINK_MESSAGE)
  const requested = useRef(false)

  // Espelha o achado 3.3: o token sai da barra de enderecos assim que lido,
  // para nao vazar na telemetria; o valor fica em estado para o submit.
  useEffect(() => {
    if (!searchParams.get('confirm_email') && !searchParams.get('token')) return
    searchParams.delete('confirm_email')
    searchParams.delete('token')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!token || requested.current) return
    requested.current = true
    void supabasePortal.functions
      .invoke('portal-recovery-email-change', { body: { action: 'confirm', token } })
      .then(({ error: invokeError }) => {
        if (invokeError) {
          setError(INVALID_LINK_MESSAGE)
          setState('erro')
          return
        }
        setState('ok')
      })
      .catch(() => {
        setError('Nao foi possivel confirmar agora. Tente novamente em instantes.')
        setState('erro')
      })
  }, [token])

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Transhipping" className="app-auth__logo app-auth__logo--on-light" src="/branding/transhipping-logo.png" />
          <div>
            <h1 className="app-auth__title">
              {state === 'ok' ? 'Email confirmado' : state === 'erro' ? 'Confirmacao de email' : 'Confirmando seu email...'}
            </h1>
          </div>
        </div>

        {state === 'confirmando' ? (
          <p className="text-sm text-[var(--app-muted)]">Estamos confirmando o novo Email de Recuperacao.</p>
        ) : null}

        {state === 'ok' ? (
          <p className="text-sm text-[var(--app-muted)]">
            O novo Email de Recuperacao passou a valer e o endereco anterior deixou de valer. As sessoes abertas em
            outros dispositivos foram encerradas — entre novamente no Portal.
          </p>
        ) : null}

        {state === 'erro' ? <InlineError message={error} /> : null}

        <div className="mt-4 text-center">
          <Link to="/portal/login" className="text-sm text-[var(--app-link)] hover:underline">
            Ir para o login
          </Link>
        </div>
      </Card>
    </main>
  )
}
