import { useState, type ReactNode } from 'react'
import { Info, MetricPanel } from '../shared/VoyageSectionCards'
import { useAgencyReportDerived } from '../../hooks/useAgencyReport'
import { buildContainerTypeMatrix, groupVehiclesByBrand } from '../../services/agencyDepartureReport'
import { formatDate } from '../../lib/utils'

type Props = {
  voyageId: number
  voyageLabel: string
  carrierName: string
  pods: string[]
  initialEscala?: string
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="app-panel app-panel--padded grid gap-4">
      <h3 className="app-panel__title text-base">{title}</h3>
      {children}
    </section>
  )
}

function EmptyData() {
  return <p className="text-sm text-[var(--app-muted)]">Nenhum dado informado para esta escala.</p>
}

export function VoyageAgencyReportTab({ voyageId, voyageLabel, carrierName, pods, initialEscala }: Props) {
  const initialPort = initialEscala && pods.includes(initialEscala) ? initialEscala : (pods[0] ?? null)
  const [port, setPort] = useState<string | null>(initialPort)
  const { data, isLoading, error } = useAgencyReportDerived(voyageId, port)

  if (!pods.length) {
    return <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Nenhuma escala ativa para compor o ADR.</div>
  }

  const containers = data?.containers ?? []
  const dischargeMatrix = buildContainerTypeMatrix(containers.map((container) => ({
    type: container.size_type ?? '—',
    category: container.is_imo ? 'imo' : 'carga_geral',
  })))
  const emptyDischargeMatrix = buildContainerTypeMatrix((data?.vaziosImp ?? []).map((container) => ({
    type: container.container_type ?? '—',
    category: container.natureza === 'cama' ? 'vazio_cama' : 'vazio_cover_plate',
  })))
  const emptyEmbarkMatrix = buildContainerTypeMatrix((data?.vaziosExp ?? []).map((booking) => ({
    type: booking.container_type ?? '—',
    category: 'carga_geral',
  })))
  const vehicles = groupVehiclesByBrand(data?.vehicles ?? [])
  const vehicleLocations = new Map<string, string[]>()
  for (const vehicle of data?.vehicles ?? []) {
    const locations = vehicleLocations.get(vehicle.brand) ?? []
    const location = vehicle.container?.unpacking_location
    if (location && !locations.includes(location)) locations.push(location)
    vehicleLocations.set(vehicle.brand, locations)
  }
  const bookings = data?.vaziosExp ?? []
  const depots = [...new Set(bookings.map((booking) => booking.depot).filter(Boolean))]

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" aria-label="Selecionar escala ADR">
        {pods.map((pod) => (
          <button key={pod} type="button" aria-pressed={port === pod} onClick={() => setPort(pod)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${port === pod ? 'border-[var(--app-blue-btn)] bg-[var(--app-blue-btn)] text-white' : 'border-[var(--app-border)] text-[var(--app-muted)]'}`}>
            {pod}
          </button>
        ))}
      </div>

      {isLoading ? <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando dados do ADR…</div> : null}
      {error ? <div className="app-panel app-panel--padded text-sm text-red-400">Não foi possível carregar os dados do ADR.</div> : null}
      {!isLoading && !error ? <>
        <ReportSection title="Cabeçalho">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Info label="Armador" value={carrierName} />
            <Info label="Navio / viagem" value={voyageLabel} />
            <Info label="Porto" value={port ?? '—'} />
            <Info label="Terminal" value="—" />
            <Info label="ATA" value={formatDate(data?.schedule?.ata)} />
            <Info label="ATB" value={formatDate(data?.schedule?.atb)} />
            <Info label="ATD" value={formatDate(data?.schedule?.atd)} />
            <Info label="Restow" value={String(data?.schedule?.rtw ?? 0)} />
          </div>
        </ReportSection>

        <ReportSection title="Carga solta"><EmptyData /></ReportSection>
        <ReportSection title="Granito (carga carregada)">
          {data?.granite.length ? <MetricPanel title="Granito"><Info label="B/Ls" value={String(data.granite.length)} /><Info label="Blocos" value={String(data.granite.reduce((total, item) => total + (item.blocks_qty ?? 0), 0))} /><Info label="Peso" value={`${(data.granite.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} ton`} /></MetricPanel> : <EmptyData />}
        </ReportSection>

        <ReportSection title="Matriz de descarga (tipo × categoria)">
          {containers.length ? <Matrix rows={dischargeMatrix.rows} /> : <EmptyData />}
        </ReportSection>
        <ReportSection title="Vazios descarregados (cama / cover plate)">
          {data?.vaziosImp.length ? <Matrix rows={emptyDischargeMatrix.rows} /> : <EmptyData />}
        </ReportSection>
        <ReportSection title="Container com veículo">
          {vehicles.length ? <div className="grid gap-2">{vehicles.map((vehicle) => <Info key={vehicle.brand} label={vehicle.brand || 'Marca não informada'} value={`${vehicle.blCount} BLs · ${vehicle.vinCount} VINs · ${vehicleLocations.get(vehicle.brand)?.join(', ') || 'local de desova não informado'}`} />)}</div> : <EmptyData />}
        </ReportSection>
        <ReportSection title="Embarque de vazios">
          {bookings.length ? <div className="grid gap-4 xl:grid-cols-2"><MetricPanel title="Matriz"><Matrix rows={emptyEmbarkMatrix.rows} /></MetricPanel><MetricPanel title="Operação"><Info label="OS" value={data?.operation?.os_number ?? 'Não informada'} /><Info label="Embarque direto" value={String(bookings.filter((booking) => !booking.depot).length)} /><Info label="Depots" value={depots.join(', ') || '—'} /></MetricPanel></div> : <EmptyData />}
          <div className="grid gap-4 xl:grid-cols-3">
            <MetricPanel title="Serviço extra">{data?.operation?.reorg.length ? data.operation.reorg.map((service) => <Info key={service.id} label={`${service.service} · ${service.container_type}`} value={String(service.qty)} />) : <Info label="Registros" value="0" />}</MetricPanel>
            <MetricPanel title="Storage"><Info label="Containers" value={String(data?.storage.containers ?? 0)} /><Info label="Dias" value={String(data?.storage.days ?? 0)} /></MetricPanel>
            <MetricPanel title="Overtime"><Info label="Handling" value={String(bookings.filter((booking) => booking.overtime_handling).length)} /><Info label="Transporte" value={String(bookings.filter((booking) => booking.overtime_transport).length)} /></MetricPanel>
          </div>
        </ReportSection>
        <ReportSection title="Ocorrências"><EmptyData /></ReportSection>
      </> : null}
    </div>
  )
}

function Matrix({ rows }: { rows: Record<string, Record<string, number>> }) {
  return <div className="grid gap-2">{Object.entries(rows).map(([type, categories]) => <Info key={type} label={type} value={Object.entries(categories).map(([category, total]) => `${category}: ${total}`).join(' · ')} />)}</div>
}
