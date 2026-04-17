import type { CSSProperties } from 'react'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import type { LineUpRow } from '../../services/lineup'

export function LineUpTable({
  rows,
  emptyTitle,
  emptyDescription,
  mode = 'app',
  rowHeight,
}: {
  rows: LineUpRow[]
  emptyTitle: string
  emptyDescription: string
  mode?: 'app' | 'display'
  rowHeight?: number
}) {
  const isDisplay = mode === 'display'

  return (
    <div className={isDisplay ? 'app-lineup-display-scroll' : 'app-table-scroll'}>
      <table
        className={`app-table app-table--dense app-table--lineup ${isDisplay ? 'app-table--lineup-display' : ''} min-w-full table-fixed text-left`}
        style={isDisplay && rowHeight ? ({ ['--lineup-display-row-height' as string]: `${rowHeight}px` } as CSSProperties) : undefined}
        >
        <colgroup>
          <col className={isDisplay ? 'w-[15.2%]' : 'w-[22%]'} />
          <col className={isDisplay ? 'w-[3.1%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[4.1%]' : 'w-[7%]'} />
          <col className={isDisplay ? 'w-[4.1%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[4.1%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[4%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[4%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[4%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[4.3%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[4%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[4%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[6.4%]' : 'w-[10%]'} />
          <col className={isDisplay ? 'w-[4.5%]' : 'w-[7%]'} />
          <col className={isDisplay ? 'w-[4.3%]' : 'w-[6%]'} />
        </colgroup>
        <thead className={isDisplay ? 'bg-[#16325f] text-[13px] uppercase tracking-[0.18em] text-white' : 'bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500'}>
          <tr>
            <th className="px-3 py-3">Vessel</th>
            <th className="px-3 py-3 text-center">Voy</th>
            <th className="px-3 py-3 text-center">POD</th>
            <th className="px-3 py-3 text-center">ETA</th>
            <th className="px-3 py-3 text-center">ETB</th>
            <th className="px-3 py-3 text-center">VIN</th>
            <th className="px-3 py-3 text-center">CAR</th>
            <th className="px-3 py-3 text-center">CG</th>
            <th className="px-3 py-3 text-center">Total</th>
            <th className="px-3 py-3 text-center">MTY</th>
            <th className="px-3 py-3 text-center">RTW</th>
            <th className="px-3 py-3">BB</th>
            <th className="px-3 py-3 text-center">CEs</th>
            <th className="px-3 py-3 text-center">Linked</th>
          </tr>
        </thead>
        <tbody className={isDisplay ? 'divide-y divide-[#d6dfeb] bg-white' : 'divide-y divide-[#30363d]'}>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={14} className="p-0">
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : null}

          {rows.map((row) => (
            <tr key={row.id}>
              <td className={isDisplay ? 'px-2 py-2 font-black text-[#214b2f]' : 'px-2 py-2 font-semibold text-white'}>{row.vesselName}</td>
              <td className={isDisplay ? 'px-2 py-2 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>{row.voyageNumber}</td>
              <td className={isDisplay ? 'px-2 py-2 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>{row.pod}</td>
              <td className="px-3 py-3 text-center">{formatShortDate(row.eta)}</td>
              <td className="px-3 py-3 text-center">{formatShortDate(row.etb)}</td>
              <td className={isDisplay ? 'px-2 py-2 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>{formatInteger(row.vin)}</td>
              <td className="px-3 py-3 text-center">{formatInteger(row.car)}</td>
              <td className="px-3 py-3 text-center">{formatInteger(row.cg)}</td>
              <td className="px-3 py-3 text-center font-semibold text-[#58a6ff]">{formatInteger(row.total)}</td>
              <td className="px-3 py-3 text-center">{formatInteger(row.mty)}</td>
              <td className="px-3 py-3 text-center">{row.rtw === null ? '-' : formatInteger(row.rtw)}</td>
              <td className="px-3 py-3">
                <div className="app-lineup-bb">
                  <span>{formatInteger(row.bbMachines)} MAQ</span>
                  <span>{formatInteger(row.bbPackages)} PACK</span>
                  <span>{formatInteger(row.bbTotal)} TOTAL</span>
                </div>
              </td>
              <td className="px-3 py-3 text-center">{renderCeStatus(row.ceStatus)}</td>
              <td className="px-3 py-3 text-center">
                <Badge tone={row.linked ? 'green' : 'yellow'}>{row.linked ? 'YES' : 'NO'}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderCeStatus(status: LineUpRow['ceStatus']) {
  if (status === 'approved') return <Badge tone="green">Approved</Badge>
  if (status === 'partial') return <Badge tone="yellow">Partial</Badge>
  return <Badge tone="red">Missing</Badge>
}

function formatShortDate(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(value))
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value ?? 0))
}
