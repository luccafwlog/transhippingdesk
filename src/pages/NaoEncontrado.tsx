import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { PageHeader } from '../components/ui/Card'

// Antes, qualquer rota desconhecida caía em /painel com `replace`: o usuário
// era realocado sem aviso e o Back nem devolvia a URL digitada. Um link velho,
// um typo ou um bookmark de rota removida viravam "o sistema me jogou no
// Painel". Agora a rota inexistente se identifica e mostra o caminho de volta.
export function NaoEncontrado() {
  const { pathname } = useLocation()

  return (
    <>
      <PageHeader
        title="Página não encontrada"
        description="O endereço acessado não corresponde a nenhuma tela do Desk operacional."
      />

      <div className="app-panel app-panel--padded max-w-2xl">
        <div className="flex items-start gap-3">
          <span className="app-workspace-nav__icon" aria-hidden="true">
            <Compass size={18} />
          </span>
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-[var(--app-muted)]">
              Endereço solicitado:{' '}
              <code className="font-[family-name:var(--app-font-mono)] text-[var(--app-text-strong)]">{pathname}</code>
            </p>
            <p className="text-sm text-[var(--app-muted)]">
              Se você chegou aqui por um link salvo, ele pode apontar para uma tela que mudou de endereço.
              Use o menu superior para navegar ou volte ao Painel.
            </p>
            <Link to="/painel" className="app-btn app-btn--primary">
              Voltar para o Painel
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
