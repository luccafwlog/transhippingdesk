import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ship, Anchor } from 'lucide-react'
import { useVesselSchedules } from '../../hooks/useVesselSchedules'
import { supabasePortal } from '../../services/supabase'

function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === 'X') return null
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10) - 1
    const year = parseInt(parts[2], 10)
    return new Date(year, month, day)
  }
  if (parts.length === 2) {
    const day = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10) - 1
    return new Date(new Date().getFullYear(), month, day)
  }
  return null
}

function isDateInPast(dateStr: string): boolean {
  const date = parseDate(dateStr)
  if (!date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

function DateCell({ value }: { value: string }) {
  const isX = value === 'X'
  const isPast = isDateInPast(value)
  return (
    <td className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${isX ? 'text-[var(--app-muted-soft)]' : isPast ? 'text-[var(--app-blue)] font-semibold' : 'text-[var(--app-text)]'}`}>
      {value}
    </td>
  )
}

export function ShipScheduleWidget() {
  const { data: vessels, isLoading } = useVesselSchedules()
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabasePortal.channel('vessel_schedules_widget')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vessel_schedules' }, () => {
        queryClient.invalidateQueries({ queryKey: ['portal-vessel-schedules'] })
      })
      .subscribe()
    return () => { supabasePortal.removeChannel(channel) }
  }, [queryClient])

  if (isLoading) {
    return (
      <div className="app-surface app-surface--padded text-sm text-[var(--app-muted)] text-center">
        Carregando programação de navios...
      </div>
    )
  }

  const showPecem = (vessels ?? []).some((v) => v.pecem_eta && v.pecem_eta !== 'X')

  return (
    <div className="w-full overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[var(--app-shadow)]">
      <div className="bg-[var(--app-navy)] px-4 py-3 flex items-center gap-3">
        <Ship className="w-5 h-5 text-white" />
        <h2 className="text-base font-bold text-white tracking-wide">
          CSSC Container Liner Service Schedule - ECSA
        </h2>
        <Anchor className="w-4 h-4 text-white/70 ml-auto" />
      </div>

      {!vessels || vessels.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--app-muted)]">
          Nenhum navio programado no momento.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-[var(--app-navy)]">
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10 min-w-[160px]">
                    Vessel Name
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10 w-14">
                    VOY
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10">
                    <div>QINGDAO</div>
                    <div className="text-[10px] font-normal opacity-80">ETD</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10">
                    <div>SHANGHAI</div>
                    <div className="text-[10px] font-normal opacity-80">ETD</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10">
                    <div>TAICANG</div>
                    <div className="text-[10px] font-normal opacity-80">ETD</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10">
                    <div>NINGBO</div>
                    <div className="text-[10px] font-normal opacity-80">ETD</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10">
                    <div>NANSHA</div>
                    <div className="text-[10px] font-normal opacity-80">ETD</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/10">
                    <div>SALVADOR</div>
                    <div className="text-[10px] font-normal opacity-80">ETA</div>
                  </th>
                  <th className={`px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider ${showPecem ? 'border-r border-white/10' : ''}`}>
                    <div>VITÓRIA</div>
                    <div className="text-[10px] font-normal opacity-80">ETA</div>
                  </th>
                  {showPecem && (
                    <th className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider">
                      <div>PECÉM</div>
                      <div className="text-[10px] font-normal opacity-80">ETA</div>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {vessels.map((vessel, index) => {
                  const rowBg = index % 2 === 0 ? 'bg-[var(--app-surface)]' : 'bg-[var(--app-surface-muted)]'
                  return (
                    <tr key={vessel.id} className={`${rowBg} hover:bg-[var(--app-blue-soft)] transition-colors duration-150 border-b border-[var(--app-border)] last:border-b-0`}>
                      <td className="px-3 py-2.5 text-center border-r border-[var(--app-border)] text-sm font-semibold text-[var(--app-blue)]">
                        {vessel.imo_number ? (
                          <a
                            href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${vessel.imo_number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80"
                          >
                            {vessel.vessel_name}
                          </a>
                        ) : (
                          vessel.vessel_name
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center border-r border-[var(--app-border)] text-sm font-medium text-[var(--app-text)]">
                        {vessel.voyage}
                      </td>
                      <DateCell value={vessel.qingdao_etd} />
                      <DateCell value={vessel.shanghai_etd} />
                      <DateCell value={vessel.taicang_etd} />
                      <DateCell value={vessel.ningbo_etd} />
                      <DateCell value={vessel.nansha_etd} />
                      <DateCell value={vessel.salvador_eta} />
                      {showPecem ? (
                        <>
                          <DateCell value={vessel.vitoria_eta} />
                          <td className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${isDateInPast(vessel.pecem_eta || '') ? 'text-[var(--app-blue)] font-semibold' : (!vessel.pecem_eta || vessel.pecem_eta === 'X') ? 'text-[var(--app-muted-soft)]' : 'text-[var(--app-text)]'}`}>
                            {vessel.pecem_eta || 'X'}
                          </td>
                        </>
                      ) : (
                        <td className={`px-3 py-2.5 text-center text-sm ${isDateInPast(vessel.vitoria_eta || '') ? 'text-[var(--app-blue)] font-semibold' : 'text-[var(--app-text)]'}`}>
                          {vessel.vitoria_eta}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-[var(--app-surface-muted)] px-4 py-2 text-xs text-[var(--app-muted)] flex flex-wrap items-center justify-between gap-y-1 border-t border-[var(--app-border)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>ETD = Estimated Time of Departure &nbsp; ETA = Estimated Time of Arrival</span>
              <span className="font-medium">X = Não programado</span>
              <span className="font-medium"><span className="text-[var(--app-blue)]">Datas em azul</span> = Evento confirmado</span>
            </div>
            <span className="font-medium">Atualização diária às 09:00.</span>
          </div>
        </>
      )}
    </div>
  )
}
