import type { DemurrageDunningDisplay } from '../../services/demurrageDunning'

export function DemurrageDunningStatus({ display }: { display: DemurrageDunningDisplay }) {
  return (
    <div data-testid="demurrage-dunning-status" className={display.pauseReason ? 'text-amber-300' : 'text-slate-300'}>
      <div className="font-medium">{display.statusLabel}</div>
      {display.lastAttemptAt && !display.pauseReason ? (
        <div className="text-xs text-slate-500">Último envio: {new Date(display.lastAttemptAt).toLocaleDateString('pt-BR')}</div>
      ) : null}
    </div>
  )
}
