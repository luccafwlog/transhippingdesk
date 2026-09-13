import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportCaughtException } from '../lib/telemetry'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/** Error boundary da superfície Fwlog. Mantém o bundle do Portal livre do
 * catálogo de rotas internas usado pelo ErrorBoundary operacional. */
export class PortalErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/portal'
    reportCaughtException(
      error,
      'PortalErrorBoundary',
      { pathname, componentStack: info.componentStack },
      { surface: 'portal', tarefa: 'Renderizar tela', categoria_falha: 'Quebra de Renderização (React Error Boundary)' },
    )
    if (import.meta.env.DEV) {
      console.error('[PortalErrorBoundary] Erro não capturado:', error, info.componentStack)
    } else {
      console.error('[PortalErrorBoundary]', error.message)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0d1117] p-8">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
            <h1 className="mb-2 text-lg font-semibold text-red-300">Erro inesperado</h1>
            <p className="mb-4 text-sm text-slate-400">
              Algo deu errado. Recarregue a página para continuar.
            </p>
            <details className="mb-4 rounded-lg bg-[#0d1117] p-3 text-left text-xs text-slate-400">
              <summary className="cursor-pointer font-semibold">Detalhe técnico</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{this.state.error.message}</pre>
            </details>
            <div className="flex justify-center gap-3">
              <a
                href="/portal/login"
                className="rounded-lg bg-[#21262d] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-[#30363d]"
              >
                Ir para o login
              </a>
              <button
                type="button"
                className="rounded-lg bg-[#21262d] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-[#30363d]"
                onClick={() => window.location.reload()}
              >
                Recarregar página
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
