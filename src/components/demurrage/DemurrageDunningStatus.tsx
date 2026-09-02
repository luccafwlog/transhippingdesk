import type { DemurrageDunningDisplay } from '../../services/demurrageDunning'

type Props = {
  display?: DemurrageDunningDisplay
  loading?: boolean
  error?: boolean
}

export function DemurrageDunningStatus({ display, loading = false, error = false }: Props) {
  if (loading) {
    return <div data-testid="demurrage-dunning-status" className="text-slate-400">Verificando régua...</div>
  }
  if (error || !display) {
    return <div data-testid="demurrage-dunning-status" className="text-amber-300">Régua indisponível</div>
  }

  return (
    <div data-testid="demurrage-dunning-status" className={display.pauseReason ? 'text-amber-300' : 'text-slate-300'}>
      <div className="font-medium">{display.statusLabel}</div>
      {display.lastAttemptAt && !display.pauseReason ? (
        <div className="text-xs text-slate-500">Último envio: {new Date(display.lastAttemptAt).toLocaleDateString('pt-BR')}</div>
      ) : null}
    </div>
  )
}
