import { useState, type ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AgencyReportDocument } from './AgencyReportDocument'
import { Info, MetricPanel } from '../shared/VoyageSectionCards'
import { SignoffControl } from './SignoffControl'
import { DepartmentSignoffControl } from './DepartmentSignoffControl'
import {
  useAgencyReportDerived,
  useAgencyReportOwn,
  useAgencyReportSignoffEvents,
  useCloseAgencyReport,
  useReopenAgencyReport,
  useSetAgencyReportDepartmentSignoff,
  useSetAgencyReportSectionObservation,
  useSetAgencyReportSignoff,
  useSetAgencyReportTerminal,
} from '../../hooks/useAgencyReport'
import {
  AGENCY_REPORT_SECTIONS,
  AGENCY_REPORT_SECTION_ORDER,
  AGENCY_REPORT_DEPARTMENT_LABELS,
  buildContainerTypeMatrix,
  groupVehiclesByBrand,
  signoffLabels,
  type AgencyReportSection,
  type AgencyReportSignoffEvent,
  type SignoffState,
} from '../../services/agencyDepartureReport'
import type { AgencyReportDepartmentKey } from '../../types/database'
import { formatBRL, formatDate } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'

const DEPARTMENTS: AgencyReportDepartmentKey[] = ['operacoes', 'documentacao', 'equipamentos']

type Props = {
  voyageId: number
  voyageLabel: string
  carrierName: string
  pods: string[]
  initialEscala?: string
}

function ReportSection({
  title,
  section,
  state,
  attribution,
  canSignoff,
  events,
  actorNames,
  isPending,
  onSignoff,
  observation,
  onObservationChange,
  children,
}: {
  title: string
  section?: AgencyReportSection
  state?: SignoffState
  attribution?: string | null
  canSignoff?: boolean
  events?: AgencyReportSignoffEvent[]
  actorNames?: Record<string, string>
  isPending?: boolean
  onSignoff?: (section: AgencyReportSection, state: SignoffState, justification?: string) => void
  observation?: string | null
  onObservationChange?: (section: AgencyReportSection, observation: string) => void
  children: ReactNode
}) {
  return (
    <section className="app-panel app-panel--padded grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="app-panel__title text-base">{title}</h3>
        {section && state ? (
          <SignoffControl
            section={section}
            state={state}
            attribution={attribution}
            canSignoff={Boolean(canSignoff)}
            events={events ?? []}
            actorNames={actorNames ?? {}}
            isPending={isPending}
            onChange={(nextSection, nextState, justification) => onSignoff?.(nextSection, nextState, justification)}
          />
        ) : null}
      </div>
      {children}
      {section ? (
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-semibold text-[var(--app-muted)]">ObservaÃ§Ã£o (opcional)</span>
          {canSignoff ? (
            <textarea
              key={`${section}:${observation ?? ''}`}
              aria-label={`ObservaÃ§Ã£o â€” ${title}`}
              defaultValue={observation ?? ''}
              className="min-h-16 rounded border border-[var(--app-border)] bg-transparent p-2 text-sm"
              onBlur={(event) => {
                if (event.target.value !== (observation ?? '')) onObservationChange?.(section, event.target.value)
              }}
            />
          ) : (
            <p className="text-[var(--app-muted)]">{observation || 'â€”'}</p>
          )}
        </label>
      ) : null}
    </section>
  )
}

function ReportPhase({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--app-muted)]">{title}</h2>
      <div className="grid gap-4">{children}</div>
    </div>
  )
}

function Hero({ value, unit }: { value: string; unit?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-2xl font-bold text-[var(--app-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {unit ? <span className="text-sm text-[var(--app-muted)]">{unit}</span> : null}
    </div>
  )
}

function EmptyData() {
  return <p className="text-sm text-[var(--app-muted)]">Nenhum dado informado para esta escala.</p>
}

export function VoyageAgencyReportTab({ voyageId, voyageLabel, carrierName, pods, initialEscala }: Props) {
  const initialPort = initialEscala && pods.includes(initialEscala) ? initialEscala : (pods[0] ?? null)
  const [port, setPort] = useState<string | null>(initialPort)
  const { data, isLoading, error } = useAgencyReportDerived(voyageId, port)
  const { data: ownData } = useAgencyReportOwn(voyageId, port)
  const { data: signoffEvents } = useAgencyReportSignoffEvents(voyageId, port)
  const { effectiveRole, isAdmin } = useAuth()
  const signoffMutation = useSetAgencyReportSignoff()
  const departmentSignoffMutation = useSetAgencyReportDepartmentSignoff()
  const observationMutation = useSetAgencyReportSectionObservation()
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
  const imoCount = containers.filter((container) => container.is_imo).length
  const dischargeMatrix = buildContainerTypeMatrix(containers.map((container) => ({
    type: container.size_type ?? 'â€”',
    category: container.is_imo ? 'imo' : 'carga_geral',
  })))
  const emptyDischargeMatrix = buildContainerTypeMatrix((data?.vaziosImp ?? []).map((container) => ({
    type: container.container_type ?? 'â€”',
    category: container.natureza === 'cama' ? 'vazio_cama' : 'vazio_cover_plate',
  })))
  const emptyEmbarkMatrix = buildContainerTypeMatrix((data?.vaziosExp ?? []).map((booking) => ({
    type: booking.container_type ?? 'â€”',
    category: 'carga_geral',
  })))
  const vehicles = groupVehiclesByBrand(data?.vehicles ?? [])
  const vehicleVinTotal = vehicles.reduce((total, vehicle) => total + vehicle.vinCount, 0)
  const vehicleLocations = new Map<string, string[]>()
  for (const vehicle of data?.vehicles ?? []) {
    const locations = vehicleLocations.get(vehicle.brand) ?? []
    const location = vehicle.container?.unpacking_location
    if (location && !locations.includes(location)) locations.push(location)
    vehicleLocations.set(vehicle.brand, locations)
  }
  const bookings = data?.vaziosExp ?? []
  const depots = [...new Set(bookings.map((booking) => booking.depot).filter(Boolean))]
  const directEmbarkCount = bookings.filter((booking) => !booking.depot).length
  const granite = {
    bls: data?.granite.length ?? 0,
    blocks: (data?.granite ?? []).reduce((total, item) => total + (item.blocks_qty ?? 0), 0),
    weightTon: (data?.granite ?? []).reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000,
  }
  const signoffs = new Map((ownData?.signoffs ?? []).map((signoff) => [signoff.section, signoff.state]))
  const sectionState = (section: AgencyReportSection) => signoffs.get(section) ?? 'pending'
  const actorNames = ownData?.actor_names ?? {}
  const signoffRows = new Map((ownData?.signoffs ?? []).map((signoff) => [signoff.section, signoff]))
  const sectionAttribution = (section: AgencyReportSection): string | null => {
    const signoff = signoffRows.get(section)
    if (!signoff || signoff.state === 'pending' || !signoff.signed_at) return null
    const name = (signoff.signed_by && actorNames[signoff.signed_by]) || null
    return `${signoffLabels[signoff.state]} por ${name ?? 'â€”'} em ${formatDate(signoff.signed_at)}`
  }
  const canEditOperations = isAdmin || effectiveRole === 'operacoes'
  const canSignoff = (section: AgencyReportSection) => isAdmin || effectiveRole === AGENCY_REPORT_SECTIONS[section]
  const updateSignoff = (section: AgencyReportSection, state: SignoffState, justification?: string) => {
    if (port) signoffMutation.mutate({ voyageId, port, section, state, justification })
  }
  const updateObservation = (section: AgencyReportSection, observation: string) => {
    if (port) observationMutation.mutate({ voyageId, port, section, observation })
  }
  const eventsBySection = (section: AgencyReportSection) => (signoffEvents ?? []).filter((event) => event.section === section)

  const departmentSignoffs = new Map((ownData?.departmentSignoffs ?? []).map((row) => [row.department, row]))
  const sectionsOf = (department: AgencyReportDepartmentKey) =>
    AGENCY_REPORT_SECTION_ORDER.filter((section) => AGENCY_REPORT_SECTIONS[section] === department)
  const departmentSectionsPending = (department: AgencyReportDepartmentKey) =>
    sectionsOf(department).some((section) => sectionState(section) === 'pending')
  const isDepartmentSigned = (department: AgencyReportDepartmentKey) => Boolean(departmentSignoffs.get(department)?.signed_at)
  const departmentAttribution = (department: AgencyReportDepartmentKey): string | null => {
    const row = departmentSignoffs.get(department)
    if (!row?.signed_at) return null
    const name = (row.signed_by && actorNames[row.signed_by]) || null
    return `Assinado por ${name ?? 'â€”'} em ${formatDate(row.signed_at)}`
  }
  const canSignDepartment = (department: AgencyReportDepartmentKey) => isAdmin || effectiveRole === department
  const updateDepartmentSignoff = (department: AgencyReportDepartmentKey, signed: boolean, justification?: string) => {
    if (port) departmentSignoffMutation.mutate({ voyageId, port, department, signed, justification })
  }
  const signedDepartmentsCount = DEPARTMENTS.filter(isDepartmentSigned).length

  const snapshot = {
    header: { carrierName, voyageLabel, port, terminal: ownData?.terminal ?? null, schedule: data?.schedule ?? null },
    sections: {
      cargaDescarregada: dischargeMatrix,
      cargaSolta: data?.cargaSolta ?? null,
      vaziosDescarregados: emptyDischargeMatrix,
      veiculos: vehicles,
      vaziosEmbarcados: emptyEmbarkMatrix,
      vehicleLocations: Object.fromEntries(vehicleLocations),
      depots,
      directEmbarkCount,
      granito: granite,
      storage: data?.storage ?? null,
      operation: data?.operation ?? null,
      costs: data?.costs ?? null,
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

      {isLoading ? <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando dados do ADRâ€¦</div> : null}
      {error ? <div className="app-panel app-panel--padded text-sm text-[var(--app-red)]">NÃ£o foi possÃ­vel carregar os dados do ADR.</div> : null}
      {!isLoading && !error ? <>
        {isClosed ? <>
          <div className="app-panel app-panel--padded flex flex-wrap items-center justify-between gap-3" role="status"><span>Fechado em {formatDate(ownData?.closed_at)} por {ownData?.closed_by_name ?? ownData?.closed_by ?? 'â€”'}</span><div className="flex gap-2"><Button variant="secondary" onClick={() => setPrintOpen(true)}>Imprimir</Button>{isAdmin ? <Button variant="primary" onClick={() => setReopenOpen(true)}>Reabrir</Button> : null}</div></div>
          <AgencyReportDocument snapshot={closedSnapshot} />
          <Modal open={printOpen} title="Agency Departure Report" onClose={() => setPrintOpen(false)}><div className="flex justify-end pb-3"><Button variant="secondary" onClick={() => window.print()}>Imprimir</Button></div><AgencyReportDocument snapshot={closedSnapshot} /></Modal>
          <Modal open={reopenOpen} title="Reabrir ADR" onClose={() => setReopenOpen(false)}><label className="grid gap-2">Justificativa<textarea value={reopenJustification} onChange={(event) => setReopenJustification(event.target.value)} className="min-h-24 rounded border border-[var(--app-border)] bg-transparent p-2" /></label><Button variant="primary" className="mt-3" disabled={!reopenJustification.trim() || reopenMutation.isPending} onClick={() => { if (port) reopenMutation.mutate({ voyageId, port, justification: reopenJustification.trim() }, { onSuccess: () => { setReopenOpen(false); setReopenJustification('') } }) }}>Confirmar reabertura</Button></Modal>
        </> : <>
        <div className="app-panel app-panel--padded grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[var(--app-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{signedDepartmentsCount}/3 departamentos assinados</div>
            <Button variant="primary" disabled={signedDepartmentsCount !== 3 || closeMutation.isPending || !port} title={signedDepartmentsCount !== 3 ? 'Assine os 3 departamentos para fechar o ADR.' : undefined} onClick={() => { if (port) closeMutation.mutate({ voyageId, port, snapshot }) }}>Fechar ADR</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {DEPARTMENTS.map((department) => (
              <DepartmentSignoffControl
                key={department}
                department={department}
                label={AGENCY_REPORT_DEPARTMENT_LABELS[department]}
                signed={isDepartmentSigned(department)}
                attribution={departmentAttribution(department)}
                canSignoff={canSignDepartment(department)}
                sectionsPending={departmentSectionsPending(department)}
                isPending={departmentSignoffMutation.isPending}
                onChange={updateDepartmentSignoff}
              />
            ))}
          </div>
        </div>

        <ReportPhase title="Escala">
          <ReportSection
            title="CabeÃ§alho"
            section="datas" state={sectionState('datas')} attribution={sectionAttribution('datas')} canSignoff={canSignoff('datas')} events={eventsBySection('datas')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('datas')?.observation} onObservationChange={updateObservation}
          >
            <Hero value={`${formatDate(data?.schedule?.atb)} â†’ ${formatDate(data?.schedule?.atd)}`} unit="ATB â†’ ATD" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              <Info label="Armador" value={carrierName} />
              <Info label="Navio / viagem" value={voyageLabel} />
              <Info label="Porto" value={port ?? 'â€”'} />
              <label className="app-voyage-info">
                <span className="app-voyage-info__label">Terminal</span>
                {canEditOperations ? <input key={`${port}:${ownData?.terminal ?? ''}`} aria-label="Terminal" className="app-voyage-info__value border border-[var(--app-border)] bg-transparent px-2 py-1" defaultValue={ownData?.terminal ?? ''} onBlur={(event) => { if (port && event.target.value !== (ownData?.terminal ?? '')) terminalMutation.mutate({ voyageId, port, terminal: event.target.value }) }} /> : <span className="app-voyage-info__value">{ownData?.terminal ?? 'â€”'}</span>}
              </label>
              <Info label="ATA" value={formatDate(data?.schedule?.ata)} />
              <Info label="ATB" value={formatDate(data?.schedule?.atb)} />
              <Info label="ATD" value={formatDate(data?.schedule?.atd)} />
              <Info label="Restow" value={String(data?.schedule?.rtw ?? 0)} />
            </div>
          </ReportSection>
        </ReportPhase>

        <ReportPhase title="ImportaÃ§Ã£o">
          <ReportSection
            title="Carga descarregada"
            section="carga_descarregada" state={sectionState('carga_descarregada')} attribution={sectionAttribution('carga_descarregada')} canSignoff={canSignoff('carga_descarregada')} events={eventsBySection('carga_descarregada')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('carga_descarregada')?.observation} onObservationChange={updateObservation}
          >
            <div className="flex flex-wrap items-baseline gap-4">
              <Hero value={String(containers.length)} unit="containers descarregados" />
              {imoCount > 0 ? <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-xs font-semibold text-[var(--app-text)]">IMO: {imoCount}</span> : null}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {data?.cargaSolta?.bls ? <MetricPanel title="Carga solta"><Hero value={data.cargaSolta.weightTon.toLocaleString('pt-BR')} unit="ton" /><Info label="B/Ls" value={String(data.cargaSolta.bls)} /><Info label="MÃ¡quinas" value={String(data.cargaSolta.machines)} /><Info label="Packages" value={String(data.cargaSolta.packages)} /><Info label="Peso" value={`${data.cargaSolta.weightTon.toLocaleString('pt-BR')} ton`} /><Info label="CBM" value={data.cargaSolta.cbm.toLocaleString('pt-BR')} /></MetricPanel> : <MetricPanel title="Carga solta"><EmptyData /></MetricPanel>}
              {containers.length ? <MetricPanel title="Descarga de importaÃ§Ã£o"><Matrix rows={dischargeMatrix.rows} /></MetricPanel> : <MetricPanel title="Descarga de importaÃ§Ã£o"><EmptyData /></MetricPanel>}
            </div>
          </ReportSection>

          <ReportSection
            title="Vazios descarregados (cama / cover plate)"
            section="vazios_descarregados" state={sectionState('vazios_descarregados')} attribution={sectionAttribution('vazios_descarregados')} canSignoff={canSignoff('vazios_descarregados')} events={eventsBySection('vazios_descarregados')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('vazios_descarregados')?.observation} onObservationChange={updateObservation}
          >
            <Hero value={String(data?.vaziosImp.length ?? 0)} unit="vazios descarregados" />
            {data?.vaziosImp.length ? <Matrix rows={emptyDischargeMatrix.rows} /> : <EmptyData />}
          </ReportSection>

          <ReportSection
            title="VeÃ­culos"
            section="veiculos" state={sectionState('veiculos')} attribution={sectionAttribution('veiculos')} canSignoff={canSignoff('veiculos')} events={eventsBySection('veiculos')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('veiculos')?.observation} onObservationChange={updateObservation}
          >
            <Hero value={String(vehicleVinTotal)} unit="VINs" />
            {vehicles.length ? <div className="grid gap-2">{vehicles.map((vehicle) => <Info key={vehicle.brand} label={vehicle.brand || 'Marca nÃ£o informada'} value={`${vehicle.blCount} ${vehicle.blCount === 1 ? 'BL' : 'BLs'} Â· ${vehicle.vinCount} ${vehicle.vinCount === 1 ? 'VIN' : 'VINs'} Â· ${vehicleLocations.get(vehicle.brand)?.join(', ') || 'local de desova nÃ£o informado'}`} />)}</div> : <EmptyData />}
          </ReportSection>
        </ReportPhase>

        <ReportPhase title="OperaÃ§Ã£o de pÃ¡tio">
          <ReportSection
            title="OperaÃ§Ã£o de pÃ¡tio"
            section="operacao_patio" state={sectionState('operacao_patio')} attribution={sectionAttribution('operacao_patio')} canSignoff={canSignoff('operacao_patio')} events={eventsBySection('operacao_patio')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('operacao_patio')?.observation} onObservationChange={updateObservation}
          >
            <Hero value={String(data?.storage.days ?? 0)} unit="dias de storage" />
            <div className="grid gap-4 xl:grid-cols-3">
              <MetricPanel title="Storage"><Info label="Containers" value={String(data?.storage.containers ?? 0)} /><Info label="Dias" value={String(data?.storage.days ?? 0)} /></MetricPanel>
              <MetricPanel title="Overtime"><Info label="Containers com overtime" value={String(bookings.filter((booking) => Number(booking.overtime_pct ?? 0) > 0).length)} />{((data?.operation as unknown as { overtime?: Array<{ id: string; depot: string; percent: number }> } | null)?.overtime ?? []).map((overtime) => <Info key={overtime.id} label={overtime.depot} value={`${overtime.percent}%`} />)}</MetricPanel>
              <MetricPanel title="Depots e OS"><Info label="OS" value={data?.operation?.os_number ?? 'NÃ£o informada'} /><Info label="Embarque direto" value={String(directEmbarkCount)} /><Info label="Depots" value={depots.join(', ') || 'â€”'} /></MetricPanel>
            </div>
            <MetricPanel title="Serviço extra">{data?.operation?.service_qty?.length ? data.operation.service_qty.map((service) => <Info key={service.depot_service_id} label={service.depot_service_id} value={String(service.qty)} />) : <Info label="Registros" value="0" />}</MetricPanel>
            <MetricPanel title="Valores calculados"><Info label="Containers" value={formatBRL(data?.costs?.rows.reduce((sum, row) => sum + row.total, 0) ?? 0)} /><Info label="Serviços por quantidade" value={formatBRL(data?.costs?.qtyTotal ?? 0)} /><Info label="Total da operação" value={formatBRL(data?.costs?.total ?? 0)} /></MetricPanel>
          </ReportSection>

          <ReportSection
            title="Vazios embarcados"
            section="vazios_embarcados" state={sectionState('vazios_embarcados')} attribution={sectionAttribution('vazios_embarcados')} canSignoff={canSignoff('vazios_embarcados')} events={eventsBySection('vazios_embarcados')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('vazios_embarcados')?.observation} onObservationChange={updateObservation}
          >
            <Hero value={String(bookings.length)} unit="vazios embarcados" />
            {bookings.length ? <MetricPanel title="Matriz"><Matrix rows={emptyEmbarkMatrix.rows} /></MetricPanel> : <EmptyData />}
          </ReportSection>
        </ReportPhase>

        <ReportPhase title="ExportaÃ§Ã£o">
          <ReportSection
            title="Granito (carga carregada)"
            section="carga_carregada" state={sectionState('carga_carregada')} attribution={sectionAttribution('carga_carregada')} canSignoff={canSignoff('carga_carregada')} events={eventsBySection('carga_carregada')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('carga_carregada')?.observation} onObservationChange={updateObservation}
          >
            {data?.granite.length ? <>
              <Hero value={(data.granite.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} unit="ton" />
              <MetricPanel title="Granito"><Info label="B/Ls" value={String(data.granite.length)} /><Info label="Blocos" value={String(data.granite.reduce((total, item) => total + (item.blocks_qty ?? 0), 0))} /><Info label="Peso" value={`${(data.granite.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} ton`} /></MetricPanel>
            </> : <EmptyData />}
          </ReportSection>
        </ReportPhase>
        </>}
      </> : null}
    </div>
  )
}

function Matrix({ rows }: { rows: Record<string, Record<string, number>> }) {
  return <div className="grid gap-2">{Object.entries(rows).map(([type, categories]) => <Info key={type} label={type} value={Object.entries(categories).map(([category, total]) => `${category}: ${total}`).join(' Â· ')} />)}</div>
}
