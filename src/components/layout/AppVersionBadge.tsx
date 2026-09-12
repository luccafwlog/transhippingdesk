import { useState } from 'react'
import { APP_COMMIT_SHA, HAS_APP_COMMIT_SHA, formatAppVersion } from '../../lib/appVersion'

// Versão da build visível em toda tela, no canto direito da barra superior.
// Antes ficava escondida atrás do menu de usuário (numa zona com display:none,
// portanto inalcançável) e repetida na aba Métricas. Suporte começa por "qual
// versão você está vendo?" — a resposta precisa estar à vista, e o clique
// copia o SHA completo para colar num chamado.
export function AppVersionBadge() {
  const [copied, setCopied] = useState(false)

  if (!HAS_APP_COMMIT_SHA) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(APP_COMMIT_SHA)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sem permissão de clipboard o rótulo segue legível e selecionável:
      // o SHA completo continua no title.
    }
  }

  return (
    <button
      type="button"
      className="app-version-badge"
      onClick={() => void copy()}
      title={`Commit ${APP_COMMIT_SHA} — clique para copiar`}
      aria-label={`Versão da aplicação ${formatAppVersion()}. Clique para copiar o commit completo.`}
    >
      {copied ? 'copiado' : formatAppVersion()}
    </button>
  )
}
