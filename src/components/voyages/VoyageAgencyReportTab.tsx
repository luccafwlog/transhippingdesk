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
  groupEmptyEmbarkBookings,
  MATRIX_CATEGORY_LABELS,
  groupVehiclesByBrand,
  signoffLabels,
  type AgencyReportSection,
  type AgencyReportSignoffEvent,
  type SignoffState,
} from '../../services/agencyDepartureReport'
import type { AgencyReportDepartmentKey, Json } from '../../types/database'
import type { AdrEscalaPod } from '../../services/voyageSummaries'
import { formatBRL, formatDate } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'

const DEPARTMENTS: AgencyReportDepartmentKey[] = ['operacoes', 'documentacao', 'equipamentos']

type Props = {
  voyageId: number
  voyageLabel: string
  carrierName: string
  pods: AdrEscalaPod[]
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
        <SectionObservation
          section={section}
          title={title}
          observation={observation}
          canEdit={Boolean(canSignoff)}
          onChange={onObservationChange}
        />
      ) : null}
    </section>
  )
}

// A observação é conteúdo do relatório, não um campo de formulário sempre
// aberto (ADR 0036): quando existe texto, ele é lido por todo mundo; quando
// não existe, só o dono da seção vê o convite para escrever. Quem não pode
// assinar nunca mais vê um "—" ocupando espaço por uma nota que ninguém deixou.
function SectionObservation({
  section,
  title,
  observation,
  canEdit,
  onChange,
}: {
  section: AgencyReportSection
  title: string
  observation?: string | null
  canEdit: boolean
  onChange?: (section: AgencyReportSection, observation: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const text = observation?.trim() ?? ''

  if (!text && !canEdit) return null

  if (!text && !editing) {
    return (
      <button
        type="button"
        className="justify-self-start text-sm font-semibold text-[var(--app-muted)] underline underline-offset-4 hover:text-[var(--app-text)]"
        onClick={() => setEditing(true)}
      >
        Adicionar observação
      </button>
    )
  }

  if (!canEdit) {
    return (
      <div className="grid gap-1 text-sm">
        <span className="text-xs font-semibold text-[var(--app-muted)]">Observação</span>
        <p className="whitespace-pre-line text-[var(--app-text)]">{text}</p>
      </div>
    )
  }

  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-semibold text-[var(--app-muted)]">Observação</span>
      <textarea
        key={`${section}:${observation ?? ''}`}
        aria-label={`Observação — ${title}`}
        defaultValue={observation ?? ''}
        autoFocus={editing}
        className="min-h-16 rounded border border-[var(--app-border)] bg-transparent p-2 text-sm"
        onBlur={(event) => {
          if (event.target.value !== (observation ?? '')) onChange?.(section, event.target.value)
          if (!event.target.value.trim()) setEditing(false)
        }}
      />
    </label>
  )
}

// Parte de uma seção que tem resolução única (ADR 0036): "Embarque de vazios"
// mostra as unidades embarcadas e a operação de pátio como dois blocos de
// conteúdo, sem dois sign-offs para o mesmo fato.
function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-[var(--app-border)] pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-sm font-semibold text-[var(--app-text)]">{title}</h4>
      {children}
    </div>
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

// Substitui o Hero(0) + placeholder genérico de uma seção inteira sem
// ocorrência (Task 4 do ADR 2026-07-31, aplicado a todas as seções de carga
// — inclusive Granito, revisão pós-merge): a seção continua exigindo
// resolução (o controle de sign-off é um irmão desta linha, não é afetado).
function NadaOperado({ children = 'Nada operado nesta escala.' }: { children?: ReactNode }) {
  return <p className="text-sm text-[var(--app-muted)]">{children}</p>
}

// Aviso de divergência entre fontes (Task 3 calculou os números; Task 4
// exibe). Não é bloqueante — só sinaliza que a Conciliação Baplie × B/L
// precisa revisar o item.
function DivergenceWarning({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--app-red)]">{children}</p>
}

// Aviso de dado órfão (Task 10 do ADR 2026-07-31): granito ou Embarque de
// Vazios lançado num porto que não é escala nenhuma da viagem. Reaproveita o
// wrapper do DivergenceWarning — informativo, não bloqueia sign-off nem
// fechamento — em vez de redeclarar o mesmo <p>, para ter um só lugar onde
// mudar o estilo visual do aviso.
function OrphanDataWarning({ entries, label }: { entries: Array<{ port: string; count: number }>; label: string }) {
  if (!entries.length) return null
  const text = `${entries.map((entry) => `${entry.count} ${label} em ${entry.port}`).join('; ')} — porto não é escala desta viagem, verificar o cadastro.`
  return <DivergenceWarning>{text}</DivergenceWarning>
}

export function VoyageAgencyReportTab({ voyageId, voyageLabel, carrierName, pods, initialEscala }: Props) {
  const initialPort = initialEscala && pods.some((entry) => entry.pod === initialEscala) ? initialEscala : (pods[0]?.pod ?? null)
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
    type: container.size_type ?? '—',
    category: container.category,
  })))
  const emptyDischargeMatrix = buildContainerTypeMatrix((data?.vaziosImp ?? []).map((container) => ({
    type: container.container_type ?? '—',
    category: container.natureza === 'cama' ? 'vazio_cama' : 'vazio_cover_plate',
  })))
  const emptyEmbarkRows = groupEmptyEmbarkBookings((data?.vaziosExp ?? []).map((booking) => ({
    type: booking.container_type ?? '—',
    condition: booking.condition,
    localLabel: booking.local?.name ?? booking.local?.code ?? null,
  })))
  // Duas leituras lado a lado do mesmo embarque de vazios: total por tipo (sem
  // quebra por local) e o mesmo total por tipo dentro de cada depot/terminal —
  // emptyEmbarkRows já soma por (tipo, condição, local); aqui só reagrupamos
  // sem duplicar a consulta.
  const emptyEmbarkByType = new Map<string, number>()
  const emptyEmbarkByLocal = new Map<string, Map<string, number>>()
  for (const row of emptyEmbarkRows) {
    emptyEmbarkByType.set(row.type, (emptyEmbarkByType.get(row.type) ?? 0) + row.quantity)
    const localKey = row.localLabel || '—'
    const byType = emptyEmbarkByLocal.get(localKey) ?? new Map<string, number>()
    byType.set(row.type, (byType.get(row.type) ?? 0) + row.quantity)
    emptyEmbarkByLocal.set(localKey, byType)
  }
  const emptyEmbarkTypeTotals = [...emptyEmbarkByType.entries()].sort(([a], [b]) => a.localeCompare(b))
  const emptyEmbarkLocalTotals = [...emptyEmbarkByLocal.entries()]
    .map(([localLabel, byType]) => ({
      localLabel,
      types: [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.localLabel.localeCompare(b.localLabel))
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
  const depots = [...new Set(bookings
    .filter((booking) => booking.local?.tipo === 'depot')
    .map((booking) => booking.local?.name ?? booking.local?.code)
    .filter(Boolean))]
  const directEmbarkCount = bookings.filter((booking) => booking.local?.tipo === 'terminal_portuario').length
  // A subseção de pátio só afirma "nada" quando nenhuma das suas fontes tem
  // dado — storage, embarque direto, locais ou linhas de serviço.
  const hasPatioOperation = Boolean(
    data?.storage.days || data?.storage.containers || directEmbarkCount || depots.length || data?.costs?.serviceLines?.length,
  )
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
    return `${signoffLabels[signoff.state]} por ${name ?? '—'} em ${formatDate(signoff.signed_at)}`
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
    return `Assinado por ${name ?? '—'} em ${formatDate(row.signed_at)}`
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
      // Task 4 do ADR 2026-07-31: passa a listar (tipo, condição, local) em
      // vez da matriz 2D com natureza fixa em 'carga_geral' (perdia condição e
      // local). Shape é EmptyEmbarkRow[] — o impresso (AgencyReportDocument.tsx)
      // lê via EmptyEmbarkTable/asEmptyEmbarkRows.
      vaziosEmbarcados: emptyEmbarkRows,
      vaziosUnidades: data?.vaziosExp ?? [],
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
    // Task 5 do ADR 2026-07-31: chave de topo irmã de `signoffs` — o impresso
    // fecha com os três sign-offs departamentais. Task 9 libera esta chave na
    // validação de fechamento (allowlist em close_agency_departure_report).
    departmentSignoffs: ownData?.departmentSignoffs ?? [],
  }
  const closedSnapshot = ownData?.closed_snapshot as typeof snapshot | null
  const isClosed = ownData?.status === 'closed' && closedSnapshot

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" aria-label="Selecionar escala ADR">
        {pods.map(({ pod, omitted }) => (
          <Button key={pod} variant={port === pod ? 'primary' : 'secondary'} aria-pressed={port === pod} onClick={() => setPort(pod)} className="rounded-full">
            {pod}
            {omitted ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${port === pod ? 'bg-white/20 text-white' : 'bg-[var(--app-surface-muted)] text-[var(--app-muted)]'}`}
                title="Escala omitida — o navio não atracou neste porto; ADR mantido apenas como registro fechado."
              >
                Omitida
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {isLoading ? <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando dados do ADR…</div> : null}
      {error ? <div className="app-panel app-panel--padded text-sm text-[var(--app-red)]">Não foi possível carregar os dados do ADR.</div> : null}
      {!isLoading && !error ? <>
        {isClosed ? <>
          <div className="app-panel app-panel--padded flex flex-wrap items-center justify-between gap-3" role="status"><span>Fechado em {formatDate(ownData?.closed_at)} por {ownData?.closed_by_name ?? ownData?.closed_by ?? '—'}</span><div className="flex gap-2"><Button variant="secondary" onClick={() => setPrintOpen(true)}>Imprimir</Button>{isAdmin ? <Button variant="primary" onClick={() => setReopenOpen(true)}>Reabrir</Button> : null}</div></div>
          <AgencyReportDocument snapshot={closedSnapshot} actorNames={actorNames} />
          <Modal open={printOpen} title="Agency Departure Report" onClose={() => setPrintOpen(false)}><div className="flex justify-end pb-3"><Button variant="secondary" onClick={() => window.print()}>Imprimir</Button></div><AgencyReportDocument snapshot={closedSnapshot} actorNames={actorNames} /></Modal>
          <Modal open={reopenOpen} title="Reabrir ADR" onClose={() => setReopenOpen(false)}><label className="grid gap-2">Justificativa<textarea value={reopenJustification} onChange={(event) => setReopenJustification(event.target.value)} className="min-h-24 rounded border border-[var(--app-border)] bg-transparent p-2" /></label><Button variant="primary" className="mt-3" disabled={!reopenJustification.trim() || reopenMutation.isPending} onClick={() => { if (port) reopenMutation.mutate({ voyageId, port, justification: reopenJustification.trim() }, { onSuccess: () => { setReopenOpen(false); setReopenJustification('') } }) }}>Confirmar reabertura</Button></Modal>
        </> : <>
        <div className="app-panel app-panel--padded grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[var(--app-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{signedDepartmentsCount}/3 departamentos assinados</div>
            <Button variant="primary" disabled={signedDepartmentsCount !== 3 || closeMutation.isPending || !port} title={signedDepartmentsCount !== 3 ? 'Assine os 3 departamentos para fechar o ADR.' : undefined} onClick={() => { if (port) closeMutation.mutate({ voyageId, port, snapshot: snapshot as unknown as Json }) }}>Fechar ADR</Button>
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

        {/* A Escala não é uma fase do ciclo: é o assunto do relatório. Uma
            faixa "Escala" só produziria um h2 seguido de um h3 com o mesmo
            nome, então a seção abre a aba sozinha (ADR 0036). */}
        <ReportSection
            title="Escala"
            section="datas" state={sectionState('datas')} attribution={sectionAttribution('datas')} canSignoff={canSignoff('datas')} events={eventsBySection('datas')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('datas')?.observation} onObservationChange={updateObservation}
          >
            <Hero value={`${formatDate(data?.schedule?.atb)} → ${formatDate(data?.schedule?.atd)}`} unit="ATB → ATD" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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

        <ReportPhase title="Importação">
          <ReportSection
            title="Carga descarregada"
            section="carga_descarregada" state={sectionState('carga_descarregada')} attribution={sectionAttribution('carga_descarregada')} canSignoff={canSignoff('carga_descarregada')} events={eventsBySection('carga_descarregada')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('carga_descarregada')?.observation} onObservationChange={updateObservation}
          >
            {containers.length === 0 && !data?.cargaSolta?.bls && !data?.cargaSolta?.transshipment?.bls ? <NadaOperado /> : <>
              <div className="flex flex-wrap items-baseline gap-4">
                <Hero value={String(containers.length)} unit="containers descarregados" />
                {imoCount > 0 ? <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-xs font-semibold text-[var(--app-text)]">IMO: {imoCount}</span> : null}
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {data?.cargaSolta?.bls || data?.cargaSolta?.transshipment?.bls ? (
                  <MetricPanel title="Carga solta">
                    {data?.cargaSolta?.bls ? <><Hero value={data.cargaSolta.weightTon.toLocaleString('pt-BR')} unit="ton" /><Info label="B/Ls" value={String(data.cargaSolta.bls)} /><Info label="Máquinas" value={String(data.cargaSolta.machines)} /><Info label="Packages" value={String(data.cargaSolta.packages)} /><Info label="Peso" value={`${data.cargaSolta.weightTon.toLocaleString('pt-BR')} ton`} /><Info label="CBM" value={data.cargaSolta.cbm.toLocaleString('pt-BR')} /></> : null}
                    {data?.cargaSolta?.transshipment?.bls ? (
                      <div className="mt-2 grid gap-1 border-t border-[var(--app-border)] pt-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Em transbordo</span>
                        <Info label="B/Ls" value={String(data.cargaSolta.transshipment.bls)} />
                        <Info label="Máquinas" value={String(data.cargaSolta.transshipment.machines)} />
                        <Info label="Packages" value={String(data.cargaSolta.transshipment.packages)} />
                        <Info label="Peso" value={`${data.cargaSolta.transshipment.weightTon.toLocaleString('pt-BR')} ton`} />
                        <Info label="CBM" value={data.cargaSolta.transshipment.cbm.toLocaleString('pt-BR')} />
                      </div>
                    ) : null}
                  </MetricPanel>
                ) : null}
                {containers.length ? <MetricPanel title="Descarga de importação"><OperatedListing rows={dischargeMatrix.rows} /></MetricPanel> : null}
              </div>
            </>}
            {data?.dischargeDivergence && data.dischargeDivergence.orphanFullContainers > 0 ? (
              <DivergenceWarning>
                {data.dischargeDivergence.orphanFullContainers} container(s) cheio(s) no Baplie sem B/L correspondente nesta escala — revisar na Conciliação Baplie × B/L.
              </DivergenceWarning>
            ) : null}
          </ReportSection>

          <ReportSection
            title="Vazios descarregados"
            section="vazios_descarregados" state={sectionState('vazios_descarregados')} attribution={sectionAttribution('vazios_descarregados')} canSignoff={canSignoff('vazios_descarregados')} events={eventsBySection('vazios_descarregados')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('vazios_descarregados')?.observation} onObservationChange={updateObservation}
          >
            {data?.vaziosImp.length ? <>
              <Hero value={String(data.vaziosImp.length)} unit="vazios descarregados" />
              <OperatedListing rows={emptyDischargeMatrix.rows} />
            </> : <NadaOperado />}
            {data?.vaziosDivergence?.diverges ? (
              <DivergenceWarning>
                Baplie aponta {data.vaziosDivergence.baplieCount} vazio(s) descarregado(s) contra {data.vaziosDivergence.moduleCount} no módulo de Vazios de Importação
                {data.vaziosDivergence.unclassifiedCount > 0 ? ` (${data.vaziosDivergence.unclassifiedCount} ainda sem natureza classificada)` : ''} — revisar na Conciliação Baplie × B/L.
              </DivergenceWarning>
            ) : null}
          </ReportSection>

          <ReportSection
            title="Veículos"
            section="veiculos" state={sectionState('veiculos')} attribution={sectionAttribution('veiculos')} canSignoff={canSignoff('veiculos')} events={eventsBySection('veiculos')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('veiculos')?.observation} onObservationChange={updateObservation}
          >
            {vehicleVinTotal ? <>
              <Hero value={String(vehicleVinTotal)} unit="VINs" />
              <div className="grid gap-2">{vehicles.map((vehicle) => <Info key={vehicle.brand} label={vehicle.brand || 'Marca não informada'} value={`${vehicle.blCount} ${vehicle.blCount === 1 ? 'BL' : 'BLs'} · ${vehicle.vinCount} ${vehicle.vinCount === 1 ? 'VIN' : 'VINs'}${vehicle.transshipmentVinCount ? ` · ${vehicle.transshipmentVinCount} em transbordo` : ''} · ${vehicleLocations.get(vehicle.brand)?.join(', ') || 'local de desova não informado'}`} />)}</div>
            </> : <NadaOperado />}
          </ReportSection>
        </ReportPhase>

        <ReportPhase title="Exportação">
          <ReportSection
            title="Carga carregada"
            section="carga_carregada" state={sectionState('carga_carregada')} attribution={sectionAttribution('carga_carregada')} canSignoff={canSignoff('carga_carregada')} events={eventsBySection('carga_carregada')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('carga_carregada')?.observation} onObservationChange={updateObservation}
          >
            {data?.granite.length ? <>
              <Hero value={(data.granite.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} unit="ton" />
              <MetricPanel title="Granito"><Info label="B/Ls" value={String(data.granite.length)} /><Info label="Blocos" value={String(data.granite.reduce((total, item) => total + (item.blocks_qty ?? 0), 0))} /><Info label="Peso" value={`${(data.granite.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} ton`} /></MetricPanel>
            </> : data?.orphanData?.granito.length ? null : <NadaOperado />}
            <OrphanDataWarning entries={data?.orphanData?.granito ?? []} label="B/L(s) de granito" />
          </ReportSection>

          {/* Embarque de Vazios é UM agregado por escala (CONTEXT.md): as
              unidades embarcadas e os serviços performados sobre elas são duas
              partes do mesmo fato, com uma resolução só (ADR 0036). A
              armazenagem — dias e custo — fica inteira na operação de pátio. */}
          <ReportSection
            title="Embarque de vazios"
            section="vazios_embarcados" state={sectionState('vazios_embarcados')} attribution={sectionAttribution('vazios_embarcados')} canSignoff={canSignoff('vazios_embarcados')} events={eventsBySection('vazios_embarcados')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('vazios_embarcados')?.observation} onObservationChange={updateObservation}
          >
            <Subsection title="Containers embarcados">
              {bookings.length ? <>
                <Hero value={String(bookings.length)} unit="vazios embarcados" />
                <div className="grid gap-4 xl:grid-cols-2">
                  <MetricPanel title="Total por tipo">
                    {emptyEmbarkTypeTotals.map(([type, quantity]) => <Info key={type} label={type} value={String(quantity)} />)}
                  </MetricPanel>
                  <div className="grid gap-4">
                    {emptyEmbarkLocalTotals.map(({ localLabel, types }) => (
                      <MetricPanel key={localLabel} title={localLabel}>
                        {types.map(([type, quantity]) => <Info key={type} label={type} value={String(quantity)} />)}
                      </MetricPanel>
                    ))}
                  </div>
                </div>
              </> : data?.orphanData?.vaziosEmbarcados.length ? null : <NadaOperado>Nenhum vazio embarcado nesta escala.</NadaOperado>}
              <OrphanDataWarning entries={data?.orphanData?.vaziosEmbarcados ?? []} label="unidade(s) de vazios embarcados" />
            </Subsection>

            <Subsection title="Operação de pátio">
              {hasPatioOperation ? <>
                <Hero value={String(data?.storage.days ?? 0)} unit="dias de storage" />
                <div className="grid gap-4 xl:grid-cols-3">
                  {data?.storage.days ? <MetricPanel title="Storage"><Info label="Containers" value={String(data.storage.containers)} /><Info label="Dias" value={String(data.storage.days)} /></MetricPanel> : null}
                  {directEmbarkCount ? <MetricPanel title="Embarque direto"><Info label="Unidades sem armazenagem" value={String(directEmbarkCount)} /></MetricPanel> : null}
                  <MetricPanel title="Locais"><Info label="Depots / terminais" value={depots.join(', ') || '—'} /></MetricPanel>
                </div>
                <MetricPanel title="Linhas de serviço">{data?.costs?.serviceLines?.length ? <div className="app-table-scroll"><table className="app-table min-w-[900px] text-left text-sm"><thead><tr><th>Serviço</th><th>Local</th><th>Rota</th><th>Tipo</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{data.costs.serviceLines.map((service) => <tr key={service.id}><td>{service.service?.name ?? '—'}</td><td>{service.local?.name ?? service.local?.code ?? service.local_id}</td><td>{service.destino?.name ?? service.destino?.code ?? '—'}</td><td>{service.container_type ?? '—'}</td><td>{String(service.quantidade)}</td><td>{formatBRL(Number(service.valor_unitario))}</td><td>{formatBRL(Number(service.total))}</td></tr>)}</tbody></table></div> : <Info label="Registros" value="0" />}</MetricPanel>
                <MetricPanel title="Totais"><Info label="Total da operação" value={formatBRL(data?.costs?.total ?? 0)} /></MetricPanel>
              </> : <NadaOperado>Nenhum serviço de pátio nesta escala.</NadaOperado>}
            </Subsection>
          </ReportSection>
        </ReportPhase>
        </>}
      </> : null}
    </div>
  )
}

// Task 4 do ADR 2026-07-31: substitui a antiga Matrix (uma linha por tipo,
// categorias mescladas numa string só) por uma linha por combinação
// (tipo, categoria) existente — a "listagem do operado" literal do plano, sem
// célula zerada porque buildContainerTypeMatrix só grava o que ocorreu.
function OperatedListing({ rows }: { rows: Record<string, Record<string, number>> }) {
  const combos = Object.entries(rows)
    .flatMap(([type, categories]) => Object.entries(categories).map(([category, quantity]) => ({ type, category, quantity })))
    .sort((a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category))

  if (!combos.length) return <NadaOperado />

  return (
    <div className="grid gap-2">
      {combos.map((combo) => <Info key={`${combo.type}:${combo.category}`} label={`${combo.type} · ${MATRIX_CATEGORY_LABELS[combo.category] ?? combo.category}`} value={String(combo.quantity)} />)}
    </div>
  )
}
