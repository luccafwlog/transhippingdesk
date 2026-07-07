import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import type { LocalChargeOperationalRow } from '../../services/charges/chargeOperationsService'

// Renderização incremental: a fila de pendências pode trazer até ~1200 linhas.
// Em vez de pintar todas de uma vez (custo de DOM/CPU), começamos com um lote e
// revelamos os demais sob demanda. Sem dependência de virtualização.
const INITIAL_VISIBLE = 100
const PAGE_STEP = 100

export function PendenciasTable({ rows }: { rows: LocalChargeOperationalRow[] }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const visibleRows = rows.slice(0, visibleCount)
  const remaining = rows.length - visibleRows.length

  return (
    <div>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[980px] text-left text-sm whitespace-nowrap">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">B/L</th>
              <th scope="col" className="px-4 py-3">Cliente</th>
              <th scope="col" className="px-4 py-3">Modo/POD</th>
              <th scope="col" className="px-4 py-3">Viagem</th>
              <th scope="col" className="px-4 py-3">Motivo</th>
              <th scope="col" className="px-4 py-3">Acesso</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--app-text-strong)]">{row.customer?.name ?? '-'}</div>
                  <div className="text-xs text-[var(--app-muted)]">{row.customer?.cnpj_cpf ?? '-'}</div>
                </td>
                <td className="px-4 py-3">
                  {(row.cargo_mode ?? '-').replace('_', ' ').toUpperCase()} / {row.pod ?? '-'}
                </td>
                <td className="px-4 py-3">
                  {row.voyage?.vessel?.name ?? 'Navio'} / {row.voyage?.voyage_number ?? '-'}
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-[360px] truncate" title={row.trail.last_event_message ?? row.billing_hold_reason ?? undefined}>
                    {row.trail.last_event_message ?? row.billing_hold_reason ?? 'Revisão requerida'}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link className="app-link" to={`/manifestos/${row.id}`}>
                    Ver B/L
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {remaining > 0 ? (
        <div className="mt-3 flex justify-center">
          <Button type="button" variant="secondary" onClick={() => setVisibleCount((count) => count + PAGE_STEP)}>
            Mostrar mais ({remaining} restantes)
          </Button>
        </div>
      ) : null}
    </div>
  )
}
