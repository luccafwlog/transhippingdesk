import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Em produção logamos apenas a mensagem; o componentStack fica fora
    // para não vazar estrutura interna de componentes no console do browser.
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Erro não capturado:', error, _info.componentStack)
    } else {
      console.error('[ErrorBoundary]', error.message)
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
            <pre className="mb-4 max-h-40 overflow-auto rounded-lg bg-[#0d1117] p-3 text-left text-xs text-slate-400">
              {this.state.error.message}
            </pre>
            <button
              className="rounded-lg bg-[#21262d] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-[#30363d]"
              onClick={() => window.location.reload()}
            >
              Recarregar página
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
