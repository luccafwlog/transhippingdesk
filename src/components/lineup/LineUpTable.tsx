import type { Ref } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import type { LineUpRow } from '../../services/lineup'
import { getVoyagePodCeStatusLabel } from '../../services/voyageRouteSchedules'
import { formatShortDateSafe } from '../../lib/utils'

export function LineUpTable({
  rows,
  emptyTitle,
  emptyDescription,
  mode = 'app',
  rowHeight,
  fillSlots,
  containerRef,
  bodyStyle,
  getRowKey,
}: {
  rows: LineUpRow[]
  emptyTitle: string
  emptyDescription: string
  mode?: 'app' | 'display'
  rowHeight?: number
  fillSlots?: number
  containerRef?: Ref<HTMLDivElement>
  bodyStyle?: CSSProperties
  getRowKey?: (row: LineUpRow, index: number) => string
}) {
  const isDisplay = mode === 'display'
  const placeholderSlots = isDisplay && rows.length > 0 ? Math.max(0, (fillSlots ?? 0) - rows.length) : 0

  return (
    <div ref={containerRef} className={isDisplay ? 'app-lineup-display-scroll' : 'app-table-scroll'}>
      <table
        className={`app-table app-table--dense app-table--lineup ${isDisplay ? 'app-table--lineup-display' : ''} min-w-full table-fixed text-left`}
        style={isDisplay && rowHeight ? ({ ['--lineup-display-row-height' as string]: `${rowHeight}px` } as CSSProperties) : undefined}
      >
        <colgroup>
          <col className={isDisplay ? 'w-[18%]' : 'w-[22%]'} />
          <col className={isDisplay ? 'w-[4%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[7%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[7%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[5%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[7%]' : 'w-[10%]'} />
          <col className={isDisplay ? 'w-[11%]' : 'w-[7%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[6%]'} />
        </colgroup>
        <thead className={isDisplay ? 'bg-[#16325f] text-[13px] uppercase tracking-[0.18em] text-white' : 'bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500'}>
          <tr>
            <th scope="col" className="px-1 py-2 text-center">Vessel</th>
            <th scope="col" className="px-1 py-2 text-center">Voy</th>
            <th scope="col" className="px-1 py-2 text-center">POD</th>
            <th scope="col" className="px-1 py-2 text-center">ETA</th>
            <th scope="col" className="px-1 py-2 text-center">ETB</th>
            <th scope="col" className="px-1 py-2 text-center">VIN</th>
            <th scope="col" className="px-1 py-2 text-center">CAR</th>
            <th scope="col" className="px-1 py-2 text-center">CG</th>
            <th scope="col" className="px-1 py-2 text-center">Total</th>
            <th scope="col" className="px-1 py-2 text-center">MTY</th>
            <th scope="col" className="px-1 py-2 text-center">RTW</th>
            <th scope="col" className="px-1 py-2 text-center">BB</th>
            <th scope="col" className="px-1 py-2 text-center">CEs</th>
            <th scope="col" className="px-1 py-2 text-center">Linked</th>
          </tr>
        </thead>
        <tbody
          className={isDisplay ? 'divide-y divide-[#d6dfeb] bg-white' : 'divide-y divide-[#30363d]'}
          style={bodyStyle}
        >
          {rows.length === 0 ? (
            <tr>
              <td colSpan={14} className="p-0">
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : null}

          {rows.map((row, index) => {
            const isExport = row.rowType === 'export'
            return (
              <tr
                key={getRowKey ? getRowKey(row, index) : row.id}
                className={isExport ? (isDisplay ? 'app-lineup-export-row--display' : 'app-lineup-export-row') : undefined}
              >
                <td className={isDisplay ? 'px-1 py-1 font-black text-[#214b2f]' : 'px-2 py-2 font-semibold text-white'}>
                  {isDisplay ? row.vesselName : (
                    <Link
                      to={`/viagens?vessel=${encodeURIComponent(row.vesselName)}`}
                      className="hover:underline hover:text-[#58a6ff]"
                    >
                      {row.vesselName}
                    </Link>
                  )}
                </td>
                <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>{row.voyageNumber}</td>
                <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>
                  {row.pod}
                </td>
                <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{formatShortDate(row.eta)}</td>
                <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{formatShortDate(row.etb)}</td>
                {isExport ? (
                  <>
                    <td
                      colSpan={6}
                      className={isDisplay
                        ? 'px-2 py-1 text-center font-black text-[#7c4a00]'
                        : 'px-3 py-3 text-center font-semibold text-amber-400'}
                    >
                      {buildExportLabel(row)}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1' : 'px-3 py-3'} />
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay
                        ? renderDisplayCeStatus(row.exportCeStatus ?? 'waiting')
                        : renderCeStatus(row.exportCeStatus ?? 'waiting')}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? (
                        <span className={`app-lineup-display-status ${row.exportLinked ? 'app-lineup-display-status--green' : 'app-lineup-display-status--amber'}`}>
                          {row.exportLinked ? 'YES' : 'NO'}
                        </span>
                      ) : (
                        <Badge tone={row.exportLinked ? 'green' : 'yellow'}>{row.exportLinked ? 'YES' : 'NO'}</Badge>
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>{formatInteger(row.vin)}</td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{formatInteger(row.car)}</td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{formatInteger(row.cg)}</td>
                    <td className={isDisplay ? 'px-1 py-1 text-center font-semibold text-[#58a6ff]' : 'px-3 py-3 text-center font-semibold text-[#58a6ff]'}>{formatInteger(row.total)}</td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{formatInteger(row.mty)}</td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{row.rtw === null ? '-' : formatInteger(row.rtw)}</td>
                    <td className={isDisplay ? 'px-1 py-1' : 'px-3 py-3'}>
                      <div className="app-lineup-bb">
                        <span>{formatInteger(row.bbMachines)} MAQ</span>
                        <span>{formatInteger(row.bbPackages)} PACK</span>
                        <span>{formatInteger(row.bbTotal)} TOTAL</span>
                      </div>
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? renderDisplayCeStatus(row.ceStatus) : renderCeStatus(row.ceStatus)}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? (
                        <span className={`app-lineup-display-status ${row.linked ? 'app-lineup-display-status--green' : 'app-lineup-display-status--amber'}`}>
                          {row.linked ? 'YES' : 'NO'}
                        </span>
                      ) : (
                        <Badge tone={row.linked ? 'green' : 'yellow'}>{row.linked ? 'YES' : 'NO'}</Badge>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )
          })}

          {Array.from({ length: placeholderSlots }).map((_, index) => (
            <tr key={`lineup-placeholder-${index}`} className="app-lineup-placeholder-row" aria-hidden="true">
              <td colSpan={14} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function buildExportLabel(row: LineUpRow) {
  const parts: string[] = []
  if (row.exportHasGranite) parts.push('GRANITE')
  if (row.exportContainersQty !== null) {
    const moves = row.exportMovementsQty !== null ? ` - ${formatInteger(row.exportMovementsQty)} MOVES` : ''
    parts.push(`${formatInteger(row.exportContainersQty)} CNTRS${moves}`)
  }
  return parts.join(' | ')
}

function renderCeStatus(status: LineUpRow['ceStatus']) {
  if (status === 'approved') return <Badge tone="green">{getVoyagePodCeStatusLabel(status)}</Badge>
  if (status === 'received' || status === 'approving') return <Badge tone="blue">{getVoyagePodCeStatusLabel(status)}</Badge>
  if (status === 'launching' || status === 'partial') return <Badge tone="yellow">{getVoyagePodCeStatusLabel(status)}</Badge>
  if (status === 'waiting') return <Badge tone="slate">{getVoyagePodCeStatusLabel(status)}</Badge>
  return <Badge tone="red">{getVoyagePodCeStatusLabel(status)}</Badge>
}

function renderDisplayCeStatus(status: LineUpRow['ceStatus']) {
  if (status === 'approved') {
    return <span className="app-lineup-display-status app-lineup-display-status--green">{getVoyagePodCeStatusLabel(status)}</span>
  }
  if (status === 'received' || status === 'approving' || status === 'launching' || status === 'partial') {
    return <span className="app-lineup-display-status app-lineup-display-status--amber">{getVoyagePodCeStatusLabel(status)}</span>
  }
  return <span className="app-lineup-display-status app-lineup-display-status--red">{getVoyagePodCeStatusLabel(status)}</span>
}

function formatShortDate(value: string | null) {
  return formatShortDateSafe(value)
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value ?? 0))
}
