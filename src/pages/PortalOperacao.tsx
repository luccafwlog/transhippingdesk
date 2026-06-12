import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { formatDate } from '../lib/utils'
import type { PortalOperationBL, PortalOperationContainerStatus } from '../services/portalOperation'

export function PortalOperacao() {
  const { data, isLoading, error } = usePortalOperationBls()
  const rows = useMemo(() => data ?? [], [data])
  const [openBl, setOpenBl] = useState<string | null>(null)

  const totals = useMemo(
    () => ({
      bls: rows.length,
      containers: rows.reduce((sum, row) => sum + row.container_count, 0),
      demurrage: rows.reduce((sum, row) => sum + row.containers_in_demurrage, 0),
    }),
    [rows],
  )

  return (
    <>
      <PageHeader
        title="Operacao"
        description="Acompanhe CE Mercante, descarga, devolucao e dias de uso dos containers."
      />

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="B/Ls" value={String(totals.bls)} />
        <MetricCard label="Containers" value={String(totals.containers)} />
        <MetricCard label="Em demurrage" value={String(totals.demurrage)} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-[var(--app-border)] px-5 py-4">
          <h2 className="text-base font-semibold">B/Ls e containers</h2>
        </div>

        {isLoading ? <EmptyState title="Carregando..." description="Buscando dados operacionais." /> : null}
        {error ? <div className="px-5 py-4"><InlineError message="Falha ao carregar dados operacionais do portal." /></div> : null}
        {!isLoading && !error && rows.length === 0 ? (
          <EmptyState title="Sem B/Ls" description="Nao ha B/Ls operacionais vinculados a este cliente." />
        ) : null}

        {!isLoading && !error && rows.length > 0 ? (
          <div className="divide-y divide-[var(--app-border)]">
            {rows.map((row) => {
              const isOpen = openBl === row.bl_id
              return (
                <section key={row.bl_id}>
                  <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1.1fr_1fr_auto] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{row.bl_id}</h3>
                        {row.ce_mercante ? <Badge tone="blue">CE {row.ce_mercante}</Badge> : <Badge>Sem CE</Badge>}
                        {row.containers_in_demurrage > 0 ? <Badge tone="red">Em demurrage</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-[var(--app-muted)]">
                        {[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || '-'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <Info label="Trecho" value={`${row.pol ?? '-'} / ${row.pod ?? '-'}`} />
                      <Info label="Containers" value={String(row.container_count)} />
                      <Info label="Devolvidos" value={String(row.containers_returned)} />
                      <Info label="Demurrage" value={String(row.containers_in_demurrage)} />
                    </div>
                    <div className="lg:text-right">
                      <Button variant="secondary" onClick={() => setOpenBl(isOpen ? null : row.bl_id)}>
                        Detalhes {row.bl_id}
                      </Button>
                    </div>
                  </div>
                  {isOpen ? <ContainerDetails row={row} /> : null}
                </section>
              )
            })}
          </div>
        ) : null}
      </Card>
    </>
  )
}

function ContainerDetails({ row }: { row: PortalOperationBL }) {
  if (row.containers.length === 0) {
    return <div className="px-5 pb-5 text-sm text-[var(--app-muted)]">Nenhum container vinculado a este B/L.</div>
  }

  return (
    <div className="app-table-scroll border-t border-[var(--app-border)]">
      <table aria-label={`Containers do BL ${row.bl_id}`} className="app-table app-table--compact min-w-[860px] text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-4 py-3">Container</th>
            <th scope="col" className="px-4 py-3">Tipo</th>
            <th scope="col" className="px-4 py-3">Descarga</th>
            <th scope="col" className="px-4 py-3">Devolucao</th>
            <th scope="col" className="px-4 py-3">Dias uso</th>
            <th scope="col" className="px-4 py-3">Free time</th>
            <th scope="col" className="px-4 py-3">Demurrage</th>
            <th scope="col" className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {row.containers.map((container) => (
            <tr key={container.id}>
              <td className="px-4 py-3 font-semibold">{container.container_number}</td>
              <td className="px-4 py-3">{container.type ?? '-'}</td>
              <td className="px-4 py-3">{formatDate(container.discharge_date)}</td>
              <td className="px-4 py-3">{container.return_date ? formatDate(container.return_date) : 'Pendente'}</td>
              <td className="px-4 py-3">{formatNumber(container.usage_days)}</td>
              <td className="px-4 py-3">{formatNumber(container.free_time_days)}</td>
              <td className="px-4 py-3">{formatNumber(container.demurrage_days)}</td>
              <td className="px-4 py-3">{renderStatus(container.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function formatNumber(value: number | null) {
  return value == null ? '-' : String(value)
}

function renderStatus(status: PortalOperationContainerStatus) {
  if (status === 'devolvido') return <Badge tone="green">Devolvido</Badge>
  if (status === 'em_demurrage') return <Badge tone="red">Em demurrage</Badge>
  if (status === 'dentro_free_time') return <Badge tone="blue">Dentro free time</Badge>
  return <Badge tone="slate">Sem descarga</Badge>
}
