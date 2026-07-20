import { formatDate } from '../../lib/utils'

type Snapshot = {
  header?: { carrierName?: string; voyageLabel?: string; port?: string | null; terminal?: string | null; schedule?: { ata?: string | null; atd?: string | null } | null }
  sections?: Record<string, unknown>
  occurrences?: Array<{ id?: string; body?: string; department?: string; created_at?: string }>
}

function value(content: unknown): string {
  if (content === null || content === undefined || content === '') return '—'
  if (typeof content === 'string' || typeof content === 'number') return String(content)
  if (Array.isArray(content)) return content.length ? `${content.length} registro(s)` : '—'
  return Object.entries(content as Record<string, unknown>).map(([key, item]) => `${key}: ${value(item)}`).join(' · ') || '—'
}

export function AgencyReportDocument({ snapshot }: { snapshot: Snapshot }) {
  const header = snapshot.header ?? {}
  const sections = snapshot.sections ?? {}
  const documentSections: Array<[string, unknown]> = [
    ['Carga solta', sections.cargaSolta], ['Granito', sections.granito], ['Matriz de descarga', sections.cargaDescarregada],
    ['Vazios descarregados', sections.vaziosDescarregados], ['Container com veículo', sections.veiculos], ['Embarque de vazios', sections.vaziosEmbarcados],
    ['Serviço extra, storage e overtime', { operation: sections.operation, storage: sections.storage }],
  ]
  return <article className="agency-report-print-content" aria-label="Agency Departure Report fechado">
    <header className="agency-report-document__header">
      <div><strong>TRANSHIPPING</strong><br /><span>AGENCY DEPARTURE REPORT</span></div>
      <span>Snapshot fechado</span>
    </header>
    <dl className="agency-report-document__facts">
      <div><dt>Armador</dt><dd>{header.carrierName ?? '—'}</dd></div><div><dt>Navio / viagem</dt><dd>{header.voyageLabel ?? '—'}</dd></div>
      <div><dt>Porto</dt><dd>{header.port ?? '—'}</dd></div><div><dt>Terminal</dt><dd>{header.terminal ?? '—'}</dd></div>
      <div><dt>ATA</dt><dd>{formatDate(header.schedule?.ata)}</dd></div><div><dt>ATD</dt><dd>{formatDate(header.schedule?.atd)}</dd></div>
    </dl>
    {documentSections.map(([title, content]) => <section key={title} className="agency-report-document__section"><h2>{title}</h2><p>{value(content)}</p></section>)}
    <section className="agency-report-document__section"><h2>Ocorrências</h2>{snapshot.occurrences?.length ? <ul>{snapshot.occurrences.map((item, index) => <li key={item.id ?? index}>{item.body ?? '—'} <small>{item.department ? `(${item.department})` : ''} {formatDate(item.created_at)}</small></li>)}</ul> : <p>—</p>}</section>
  </article>
}
