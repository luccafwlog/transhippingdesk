import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import type { BLDetail } from '../../types/database'
import type { ContainerSummary, BreakbulkSummary } from './BlCargaTab'
import type { useBlCockpit } from '../../hooks/useBlCockpit'
import { BlTransshipmentCard } from './BlTransshipmentCard'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'

const dt = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value)) : '—'

export function BlVisaoGeralTab({ active, bl, cockpit, isContainerMode, containerSummary, breakbulkSummary, onCod, onRestore, disposition, omission, savingDisposition }: {
  active: boolean
  bl: BLDetail
  cockpit: ReturnType<typeof useBlCockpit>['data']
  isContainerMode: boolean
  containerSummary: ContainerSummary
  breakbulkSummary: BreakbulkSummary
  onCod?: () => void
  onRestore?: () => void
  disposition?: BlDisposition | null
  omission?: VoyageOmission | null
  savingDisposition?: boolean
}) {
  if (!active) return null
  return <div className="grid gap-5 lg:grid-cols-2">
    {omission && disposition && onCod && onRestore ? <BlTransshipmentCard omission={omission} disposition={disposition} saving={savingDisposition ?? false} onCod={onCod} onRestore={onRestore} /> : null}
    <Card><h3 className="mb-3 text-sm font-semibold">Viagem &amp; Escala</h3><dl className="grid gap-2 text-sm sm:grid-cols-2"><Item label="Armador / Navio / Viagem">{bl.voyage_id ? <Link className="font-semibold text-[#58a6ff] hover:underline" to={`/viagens/${bl.voyage_id}`}>{[bl.voyage?.vessel?.carrier?.name, bl.voyage?.vessel?.name, bl.voyage?.voyage_number].filter(Boolean).join(' / ') || '—'}</Link> : '—'}</Item><Item label="Trecho">{`${bl.pol ?? '—'} → ${bl.pod ?? '—'}`}</Item><Item label="Saida do POL">{cockpit?.polSchedule?.atd ? `ATD ${dt(cockpit.polSchedule.atd)}` : `ETD ${dt(cockpit?.polSchedule?.etd)}`}</Item><Item label="Chegada ao POD">{cockpit?.podSchedule?.ata ? `ATA ${dt(cockpit.podSchedule.ata)}` : `ETA ${dt(cockpit?.podSchedule?.eta)}`}</Item></dl></Card>
    <Card><h3 className="mb-3 text-sm font-semibold">Carga</h3>{isContainerMode ? <dl className="grid gap-2 text-sm sm:grid-cols-3"><Item label="Containers">{String(containerSummary.distinct)}</Item><Item label="IMO">{String(containerSummary.imo)}</Item><Item label="OOG">{String(containerSummary.oog)}</Item></dl> : <dl className="grid gap-2 text-sm sm:grid-cols-3"><Item label="Maquinas">{String(breakbulkSummary.machines)}</Item><Item label="Packages">{String(breakbulkSummary.packagesTotal)}</Item><Item label="Peso (t)">{String(breakbulkSummary.weightTon)}</Item></dl>}</Card>
    <Card><h3 className="mb-3 text-sm font-semibold">Cliente</h3>{bl.customer ? <div className="text-sm"><div className="font-semibold">{bl.customer.name}</div><div className="text-[var(--app-muted)]">{bl.customer.cnpj_cpf}</div></div> : <Badge tone="yellow">Sem cliente vinculado</Badge>}<Link className="mt-2 inline-block text-sm font-semibold text-[#58a6ff] hover:underline" to={`/manifestos/${bl.id}?tab=faturamento`}>Abrir Faturamento →</Link></Card>
    <Card><h3 className="mb-3 text-sm font-semibold">Financeiro</h3><dl className="grid gap-2 text-sm sm:grid-cols-2"><Item label="Taxas">{bl.charge_status ?? 'not_calculated'}</Item><Item label="Status">{bl.financial_status ?? 'pending'}</Item></dl></Card>
  </div>
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-[var(--app-muted)]">{label}</dt><dd className="font-medium text-[var(--app-text-strong)]">{children}</dd></div>
}
