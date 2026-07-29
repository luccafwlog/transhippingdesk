import { formatBRL, formatDate } from '../../lib/utils'
import { InvoiceDocFooter, InvoiceDocHeader, InvoiceDocTitle } from '../shared/InvoiceDocumentKit'

type Matrix = { rows?: Record<string, Record<string, number>>; totals?: Record<string, number> }
type Snapshot = {
  header?: {
    carrierName?: string
    voyageLabel?: string
    port?: string | null
    terminal?: string | null
    schedule?: { ata?: string | null; atb?: string | null; atd?: string | null; rtw?: number | null } | null
  }
  sections?: Record<string, unknown>
  occurrences?: Array<{ id?: string; body?: string; department?: string; created_at?: string }>
}

type Metric = [string, string | number | null | undefined]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asMatrix(value: unknown): Matrix {
  const record = asRecord(value)
  return { rows: asRecord(record.rows) as Record<string, Record<string, number>>, totals: asRecord(record.totals) as Record<string, number> }
}

function number(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function count(value: unknown) {
  return number(value).toLocaleString('pt-BR')
}

function ton(value: unknown) {
  return `${count(value)} ton`
}

function Empty() {
  return <p>—</p>
}

function MetricsTable({ label, metrics }: { label: string; metrics: Metric[] }) {
  return <table className="agency-report-document__table" aria-label={label}>
    <tbody>
      {metrics.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value === null || value === undefined || value === '' ? '—' : value}</td></tr>)}
    </tbody>
  </table>
}

function MatrixTable({ label, matrix }: { label: string; matrix: Matrix }) {
  const rows = matrix.rows ?? {}
  const categories = [...new Set(Object.values(rows).flatMap((row) => Object.keys(row)))].sort()
  if (!Object.keys(rows).length) return <Empty />

  return <table className="agency-report-document__table" aria-label={label}>
    <thead><tr><th scope="col">Tipo</th>{categories.map((category) => <th scope="col" key={category}>{category.replaceAll('_', ' ')}</th>)}<th scope="col">Total</th></tr></thead>
    <tbody>
      {Object.entries(rows).sort(([left], [right]) => left.localeCompare(right)).map(([type, values]) => (
        <tr key={type}><th scope="row">{type}</th>{categories.map((category) => <td key={category}>{count(values[category])}</td>)}<td>{count(Object.values(values).reduce((total, value) => total + number(value), 0))}</td></tr>
      ))}
    </tbody>
    <tfoot><tr><th scope="row">Total</th>{categories.map((category) => <td key={category}>{count(matrix.totals?.[category])}</td>)}<td>{count(Object.values(matrix.totals ?? {}).reduce((total, value) => total + number(value), 0))}</td></tr></tfoot>
  </table>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="agency-report-document__section"><h2>{title}</h2>{children}</section>
}

export function AgencyReportDocument({ snapshot }: { snapshot: Snapshot }) {
  const header = snapshot.header ?? {}
  const schedule = header.schedule ?? {}
  const sections = snapshot.sections ?? {}
  const cargaSolta = asRecord(sections.cargaSolta)
  const granite = Array.isArray(sections.granito)
    ? {
      bls: sections.granito.length,
      blocks: sections.granito.reduce((total, item) => total + number(asRecord(item).blocks_qty), 0),
      weightTon: sections.granito.reduce((total, item) => total + number(asRecord(item).real_weight_kg) / 1000, 0),
    }
    : asRecord(sections.granito)
  const vehicles = Array.isArray(sections.veiculos) ? sections.veiculos.map(asRecord) : []
  const vehicleLocations = asRecord(sections.vehicleLocations)
  const operation = asRecord(sections.operation)
  const overtime = Array.isArray(operation.overtime) ? operation.overtime.map(asRecord) : []
  const depots = Array.isArray(sections.depots) ? sections.depots : []
  const vaziosUnidades = Array.isArray(sections.vaziosUnidades) ? sections.vaziosUnidades.map(asRecord) : []
  const costs = asRecord(sections.costs)
  const serviceLines = Array.isArray(costs.serviceLines) ? costs.serviceLines.map(asRecord) : []

  return <article className="agency-report-print-content" aria-label="Agency Departure Report fechado">
    <InvoiceDocHeader logoSrc="/branding/tr-logo.png" docNumber={`ADR · ${header.port ?? '—'}`} />
    <InvoiceDocTitle uppercase>Agency Departure Report</InvoiceDocTitle>
    <dl className="agency-report-document__facts">
      <div><dt>Armador</dt><dd>{header.carrierName ?? '—'}</dd></div><div><dt>Navio / viagem</dt><dd>{header.voyageLabel ?? '—'}</dd></div>
      <div><dt>Porto</dt><dd>{header.port ?? '—'}</dd></div><div><dt>Terminal</dt><dd>{header.terminal ?? '—'}</dd></div>
      <div><dt>ATA</dt><dd>{formatDate(schedule.ata)}</dd></div><div><dt>ATB</dt><dd>{formatDate(schedule.atb)}</dd></div>
      <div><dt>ATD</dt><dd>{formatDate(schedule.atd)}</dd></div><div><dt>Restow</dt><dd>{count(schedule.rtw)}</dd></div>
    </dl>

    <Section title="Carga solta"><MetricsTable label="Carga solta" metrics={[
      ['B/Ls', count(cargaSolta.bls)], ['Máquinas', count(cargaSolta.machines)], ['Packages', count(cargaSolta.packages)], ['Peso', ton(cargaSolta.weightTon)], ['CBM', count(cargaSolta.cbm)],
    ]} /></Section>
    <Section title="Granito"><MetricsTable label="Granito" metrics={[
      ['B/Ls', count(granite.bls)], ['Blocos', count(granite.blocks)], ['Peso', ton(granite.weightTon)],
    ]} /></Section>
    <Section title="Matriz de descarga"><MatrixTable label="Matriz de descarga" matrix={asMatrix(sections.cargaDescarregada)} /></Section>
    <Section title="Vazios descarregados"><MatrixTable label="Vazios descarregados" matrix={asMatrix(sections.vaziosDescarregados)} /></Section>
    <Section title="Container com veículo">
      {vehicles.length ? <table className="agency-report-document__table" aria-label="Container com veículo"><thead><tr><th scope="col">Marca</th><th scope="col">B/Ls</th><th scope="col">VINs</th><th scope="col">Local de desova</th></tr></thead><tbody>
        {vehicles.map((vehicle, index) => {
          const brand = String(vehicle.brand ?? 'Marca não informada')
          const locations = Array.isArray(vehicleLocations[brand]) ? vehicleLocations[brand].join(', ') : '—'
          return <tr key={`${brand}-${index}`}><th scope="row">{brand}</th><td>{count(vehicle.blCount)}</td><td>{count(vehicle.vinCount)}</td><td>{locations || '—'}</td></tr>
        })}
      </tbody></table> : <Empty />}
    </Section>
    <Section title="Embarque de vazios">
      <MatrixTable label="Embarque de vazios" matrix={asMatrix(sections.vaziosEmbarcados)} />
      <MetricsTable label="Operação de vazios" metrics={[
        ['OS', String(operation.os_number ?? 'Não informada')], ['Embarque direto', count(sections.directEmbarkCount)], ['Depots', depots.join(', ') || '—'],
      ]} />
    </Section>
    <Section title="Linhas de serviço do embarque">
      {serviceLines.length ? <table className="agency-report-document__table" aria-label="Linhas de serviço"><thead><tr><th>Serviço</th><th>Local</th><th>Rota</th><th>Tipo</th><th>Quantidade</th><th>%</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{serviceLines.map((service, index) => <tr key={String(service.id ?? index)}><th>{String(asRecord(service.service).name ?? service.service_id ?? '—')}</th><td>{String(asRecord(service.local).name ?? service.local_id ?? '—')}</td><td>{String(asRecord(service.destino).name ?? service.destino_id ?? '—')}</td><td>{String(service.container_type ?? '—')}</td><td>{count(service.quantidade)}</td><td>{service.percentual == null ? '—' : `${count(service.percentual)}%`}</td><td>{formatBRL(number(service.valor_unitario))}</td><td>{formatBRL(number(service.quantidade) * number(service.valor_unitario) * (service.percentual == null ? 1 : number(service.percentual) / 100))}</td></tr>)}</tbody></table> : <Empty />}
    </Section>
    <Section title="Anexo — unidades que geraram armazenagem">
      {vaziosUnidades.length ? <table className="agency-report-document__table" aria-label="Unidades que geraram armazenagem"><thead><tr><th>Container</th><th>Tipo</th><th>Local</th><th>Condição</th><th>Entrada</th><th>Saída</th></tr></thead><tbody>{vaziosUnidades.filter((unit) => unit.hand_in_date && unit.hand_out_date).map((unit, index) => <tr key={String(unit.id ?? index)}><th>{String(unit.container_number ?? '—')}</th><td>{String(unit.container_type ?? '—')}</td><td>{String(unit.local_id ?? '—')}</td><td>{String(unit.condition ?? '—')}</td><td>{formatDate(unit.hand_in_date as string | null)}</td><td>{formatDate(unit.hand_out_date as string | null)}</td></tr>)}</tbody></table> : <Empty />}
    </Section>
    <Section title="Storage"><MetricsTable label="Storage" metrics={[['Containers', count(asRecord(sections.storage).containers)], ['Dias', count(asRecord(sections.storage).days)]]} /></Section>
    <Section title="Overtime">
      <MetricsTable label="Contagem de overtime" metrics={[['Handling', count(sections.overtimeHandlingCount)], ['Transporte', count(sections.overtimeTransportCount)]]} />
      {overtime.length ? <table className="agency-report-document__table" aria-label="Overtime por depot"><thead><tr><th scope="col">Depot</th><th scope="col">Percentual</th></tr></thead><tbody>{overtime.map((item, index) => <tr key={String(item.id ?? index)}><th scope="row">{String(item.depot ?? '—')}</th><td>{count(item.percent)}%</td></tr>)}</tbody></table> : null}
    </Section>
    <Section title="Ocorrências">
      {snapshot.occurrences?.length ? <ul>{snapshot.occurrences.map((item, index) => <li key={item.id ?? index}>{item.body ?? '—'} <small>{item.department ? `(${item.department})` : ''} {formatDate(item.created_at)}</small></li>)}</ul> : <Empty />}
    </Section>
    <InvoiceDocFooter />
  </article>
}
