import { useState, type ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { AgencyReportDocument } from './AgencyReportDocument'
import { Info, MetricPanel } from '../shared/VoyageSectionCards'
import {
  useAddAgencyReportOccurrence,
  useAgencyReportDerived,
  useAgencyReportOwn,
  useCloseAgencyReport,
  useReopenAgencyReport,
  useSetAgencyReportSignoff,
  useSetAgencyReportTerminal,
} from '../../hooks/useAgencyReport'
import { AGENCY_REPORT_SECTIONS, buildContainerTypeMatrix, groupVehiclesByBrand, type AgencyReportSection } from '../../services/agencyDepartureReport'
import { formatDate } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'

type Props = {
  voyageId: number
  voyageLabel: string
  carrierName: string
  pods: string[]
  initialEscala?: string
}

const signoffLabels = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  nothing_to_declare: 'Nada a declarar',
} as const

function ReportSection({
  title,
  section,
  state,
  canSignoff,
  onSignoff,
  children,
}: {
  title: string
  section?: AgencyReportSection
  state?: keyof typeof signoffLabels
  canSignoff?: boolean
  onSignoff?: (section: AgencyReportSection, state: keyof typeof signoffLabels) => void
  children: ReactNode
}) {
  return (
    <section className="app-panel app-panel--padded grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="app-panel__title text-base">{title}</h3>
        {section && state ? <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--app-border)] px-2 py-1 text-xs font-semibold">{signoffLabels[state]}</span>
          {canSignoff ? (Object.entries(signoffLabels) as Array<[keyof typeof signoffLabels, string]>).filter(([next]) => next !== state).map(([next, label]) => (
            <button key={next} type="button" className="rounded border border-[var(--app-border)] px-2 py-1 text-xs" onClick={() => onSignoff?.(section, next)}>{label}</button>
          )) : null}
        </div> : null}
      </div>
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
  const [occurrence, setOccurrence] = useState('')
  const { data, isLoading, error } = useAgencyReportDerived(voyageId, port)
  const { data: ownData } = useAgencyReportOwn(voyageId, port)
  const { effectiveRole, isAdmin } = useAuth()
  const signoffMutation = useSetAgencyReportSignoff()
  const occurrenceMutation = useAddAgencyReportOccurrence()
  const terminalMutation = useSetAgencyReportTerminal()
  const closeMutation = useCloseAgencyReport()
  const reopenMutation = useReopenAgencyReport()
  const [printOpen, setPrintOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenJustification, setReopenJustification] = useState('')

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
  const signoffs = new Map((ownData?.signoffs ?? []).map((signoff) => [signoff.section, signoff.state]))
  const confirmedCount = [...signoffs.values()].filter((state) => state !== 'pending').length
  const sectionState = (section: AgencyReportSection) => signoffs.get(section) ?? 'pending'
  const canEditOperations = isAdmin || effectiveRole === 'operacoes'
  const canSignoff = (section: AgencyReportSection) => isAdmin || effectiveRole === AGENCY_REPORT_SECTIONS[section]
  const updateSignoff = (section: AgencyReportSection, state: keyof typeof signoffLabels) => {
    if (port) signoffMutation.mutate({ voyageId, port, section, state })
  }
  const snapshot = {
    header: { carrierName, voyageLabel, port, terminal: ownData?.terminal ?? null, schedule: data?.schedule ?? null },
    sections: {
      cargaDescarregada: dischargeMatrix,
      vaziosDescarregados: emptyDischargeMatrix,
      veiculos: vehicles,
      vaziosEmbarcados: emptyEmbarkMatrix,
      granito: data?.granite ?? [],
      storage: data?.storage ?? null,
      operation: data?.operation ?? null,
    },
    occurrences: ownData?.occurrences ?? [],
    signoffs: ownData?.signoffs ?? [],
  }
  const closedSnapshot = ownData?.closed_snapshot as typeof snapshot | null
  const isClosed = ownData?.status === 'closed' && closedSnapshot

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
        {isClosed ? <>
          <div className="app-panel app-panel--padded flex flex-wrap items-center justify-between gap-3" role="status"><span>Fechado em {formatDate(ownData?.closed_at)}</span><div className="flex gap-2"><button type="button" className="rounded border border-[var(--app-border)] px-3 py-2 text-sm font-semibold" onClick={() => setPrintOpen(true)}>Imprimir</button>{isAdmin ? <button type="button" className="rounded bg-[var(--app-blue-btn)] px-3 py-2 text-sm font-semibold text-white" onClick={() => setReopenOpen(true)}>Reabrir</button> : null}</div></div>
          <AgencyReportDocument snapshot={closedSnapshot} />
          <Modal open={printOpen} title="Agency Departure Report" onClose={() => setPrintOpen(false)}><div className="flex justify-end pb-3"><button type="button" onClick={() => window.print()}>Imprimir</button></div><AgencyReportDocument snapshot={closedSnapshot} /></Modal>
          <Modal open={reopenOpen} title="Reabrir ADR" onClose={() => setReopenOpen(false)}><label className="grid gap-2">Justificativa<textarea value={reopenJustification} onChange={(event) => setReopenJustification(event.target.value)} className="min-h-24 rounded border border-[var(--app-border)] bg-transparent p-2" /></label><button type="button" className="mt-3 rounded bg-[var(--app-blue-btn)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!reopenJustification.trim() || reopenMutation.isPending} onClick={() => { if (port) reopenMutation.mutate({ voyageId, port, justification: reopenJustification.trim() }, { onSuccess: () => { setReopenOpen(false); setReopenJustification('') } }) }}>Confirmar reabertura</button></Modal>
        </> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--app-muted)]">{confirmedCount}/7 confirmadas</div>
          <button type="button" className="rounded bg-[var(--app-blue-btn)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={confirmedCount !== 7 || closeMutation.isPending || !port} title={confirmedCount !== 7 ? 'Confirme as 7 seções (ou marque "Nada a declarar") para fechar o ADR.' : undefined} onClick={() => { if (port) closeMutation.mutate({ voyageId, port, snapshot }) }}>Fechar ADR</button>
        </div>
        <ReportSection title="Cabeçalho" section="datas" state={sectionState('datas')} canSignoff={canSignoff('datas')} onSignoff={updateSignoff}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Info label="Armador" value={carrierName} />
            <Info label="Navio / viagem" value={voyageLabel} />
            <Info label="Porto" value={port ?? '—'} />
            <label className="app-voyage-info">
              <span className="app-voyage-info__label">Terminal</span>
              {canEditOperations ? <input key={`${port}:${ownData?.terminal ?? ''}`} aria-label="Terminal" className="app-voyage-info__value border border-[var(--app-border)] bg-transparent px-2 py-1" defaultValue={ownData?.terminal ?? ''} onBlur={(event) => { if (port && event.target.value !== (ownData?.terminal ?? '')) terminalMutation.mutate({ voyageId, port, terminal: event.target.value }) }} /> : <span className="app-voyage-info__value">{ownData?.terminal ?? '—'}</span>}
            </label>
            <Info label="ATA" value={formatDate(data?.schedule?.ata)} />
            <Info label="ATB" value={formatDate(data?.schedule?.atb)} />
            <Info label="ATD" value={formatDate(data?.schedule?.atd)} />
            <Info label="Restow" value={String(data?.schedule?.rtw ?? 0)} />
          </div>
        </ReportSection>

        <ReportSection title="Carga solta" section="carga_carregada" state={sectionState('carga_carregada')} canSignoff={canSignoff('carga_carregada')} onSignoff={updateSignoff}><EmptyData /></ReportSection>
        <ReportSection title="Granito (carga carregada)">
          {data?.granite.length ? <MetricPanel title="Granito"><Info label="B/Ls" value={String(data.granite.length)} /><Info label="Blocos" value={String(data.granite.reduce((total, item) => total + (item.blocks_qty ?? 0), 0))} /><Info label="Peso" value={`${(data.granite.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} ton`} /></MetricPanel> : <EmptyData />}
        </ReportSection>

        <ReportSection title="Matriz de descarga (tipo × categoria)" section="carga_descarregada" state={sectionState('carga_descarregada')} canSignoff={canSignoff('carga_descarregada')} onSignoff={updateSignoff}>
          {containers.length ? <Matrix rows={dischargeMatrix.rows} /> : <EmptyData />}
        </ReportSection>
        <ReportSection title="Vazios descarregados (cama / cover plate)" section="vazios_descarregados" state={sectionState('vazios_descarregados')} canSignoff={canSignoff('vazios_descarregados')} onSignoff={updateSignoff}>
          {data?.vaziosImp.length ? <Matrix rows={emptyDischargeMatrix.rows} /> : <EmptyData />}
        </ReportSection>
        <ReportSection title="Container com veículo" section="veiculos" state={sectionState('veiculos')} canSignoff={canSignoff('veiculos')} onSignoff={updateSignoff}>
          {vehicles.length ? <div className="grid gap-2">{vehicles.map((vehicle) => <Info key={vehicle.brand} label={vehicle.brand || 'Marca não informada'} value={`${vehicle.blCount} ${vehicle.blCount === 1 ? 'BL' : 'BLs'} · ${vehicle.vinCount} ${vehicle.vinCount === 1 ? 'VIN' : 'VINs'} · ${vehicleLocations.get(vehicle.brand)?.join(', ') || 'local de desova não informado'}`} />)}</div> : <EmptyData />}
        </ReportSection>
        <ReportSection title="Embarque de vazios" section="vazios_embarcados" state={sectionState('vazios_embarcados')} canSignoff={canSignoff('vazios_embarcados')} onSignoff={updateSignoff}>
          {bookings.length ? <div className="grid gap-4 xl:grid-cols-2"><MetricPanel title="Matriz"><Matrix rows={emptyEmbarkMatrix.rows} /></MetricPanel><MetricPanel title="Operação"><Info label="OS" value={data?.operation?.os_number ?? 'Não informada'} /><Info label="Embarque direto" value={String(bookings.filter((booking) => !booking.depot).length)} /><Info label="Depots" value={depots.join(', ') || '—'} /></MetricPanel></div> : <EmptyData />}
          <div className="grid gap-4 xl:grid-cols-3">
            <MetricPanel title="Serviço extra">{data?.operation?.reorg.length ? data.operation.reorg.map((service) => <Info key={service.id} label={`${service.service} · ${service.container_type}`} value={String(service.qty)} />) : <Info label="Registros" value="0" />}</MetricPanel>
            <MetricPanel title="Storage"><Info label="Containers" value={String(data?.storage.containers ?? 0)} /><Info label="Dias" value={String(data?.storage.days ?? 0)} /></MetricPanel>
            <MetricPanel title="Overtime"><Info label="Handling" value={String(bookings.filter((booking) => booking.overtime_handling).length)} /><Info label="Transporte" value={String(bookings.filter((booking) => booking.overtime_transport).length)} />{data?.operation?.overtime.map((overtime) => <Info key={overtime.id} label={overtime.depot} value={`${overtime.percent}%`} />)}</MetricPanel>
          </div>
        </ReportSection>
        <ReportSection title="Ocorrências" section="ocorrencias" state={sectionState('ocorrencias')} canSignoff={canSignoff('ocorrencias')} onSignoff={updateSignoff}>
          {(ownData?.occurrences ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((item) => <div key={item.id} className="grid gap-1 text-sm"><span>{item.body}</span><span className="text-xs text-[var(--app-muted)]">{item.department} · {formatDate(item.created_at)}</span></div>)}
          {canEditOperations ? <div className="grid gap-2"><textarea aria-label="Nova ocorrência" value={occurrence} onChange={(event) => setOccurrence(event.target.value)} className="min-h-20 rounded border border-[var(--app-border)] bg-transparent p-2" /><button type="button" className="w-fit rounded bg-[var(--app-blue-btn)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!occurrence.trim()} onClick={() => { if (port && occurrence.trim()) occurrenceMutation.mutate({ voyageId, port, body: occurrence.trim() }, { onSuccess: () => setOccurrence('') }) }}>Lançar</button></div> : null}
          {!ownData?.occurrences.length ? <EmptyData /> : null}
        </ReportSection>
        </>}
      </> : null}
    </div>
  )
}

function Matrix({ rows }: { rows: Record<string, Record<string, number>> }) {
  return <div className="grid gap-2">{Object.entries(rows).map(([type, categories]) => <Info key={type} label={type} value={Object.entries(categories).map(([category, total]) => `${category}: ${total}`).join(' · ')} />)}</div>
}
