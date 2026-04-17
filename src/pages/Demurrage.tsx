import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, FileText } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { calculateDemurrage, createInvoiceForBL, fetchDemurrageKPIs, listDemurrageContainers } from '../services/demurrage'
import type { DemurrageContainerListItem } from '../types/database'
import { formatDate } from '../lib/utils'

function fmtUSD(v: number) {
  return '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function DemurrageStatusBadge({ status }: { status: string | null }) {
  if (status === 'returned') return <Badge tone="slate">Devolvido</Badge>
  if (status === 'overdue') return <Badge tone="red">Em atraso</Badge>
  return <Badge tone="green">Free time</Badge>
}

function groupByBl(containers: DemurrageContainerListItem[]): Map<string, DemurrageContainerListItem[]> {
  const map = new Map<string, DemurrageContainerListItem[]>()
  for (const c of containers) {
    const blId = c.bl_id ?? 'unknown'
    if (!map.has(blId)) map.set(blId, [])
    map.get(blId)!.push(c)
  }
  return map
}

export function Demurrage() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [generatingBl, setGeneratingBl] = useState<string | null>(null)

  const { data: containers, isLoading, error } = useQuery({
    queryKey: ['demurrage-containers'],
    queryFn: () => listDemurrageContainers(),
    staleTime: 60_000,
  })

  const { data: kpis } = useQuery({
    queryKey: ['demurrage-kpis'],
    queryFn: fetchDemurrageKPIs,
    staleTime: 60_000,
  })

  const generateMutation = useMutation({
    mutationFn: (blId: string) => createInvoiceForBL(blId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
      showToast('Invoice de demurrage criada com sucesso.', 'success')
    },
    onError: (err: Error) => showToast(err.message ?? 'Erro ao gerar invoice.', 'error'),
    onSettled: () => setGeneratingBl(null),
  })

  const filtered = (containers ?? []).filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.container_number.toLowerCase().includes(q) ||
      (c.bl_id ?? '').toLowerCase().includes(q) ||
      ((c.bl as { customer?: { name?: string } } | null)?.customer?.name ?? '').toLowerCase().includes(q)
    )
  })

  const grouped = groupByBl(filtered)

  const totalOverdueUSD = filtered.reduce((sum, c) => {
    if (!c.discharge_date || !c.return_date) return sum
    const bl = c.bl as { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null
    const calc = calculateDemurrage(c.type, c.discharge_date, c.return_date, bl?.free_time_override, bl?.demurrage_rate_override_p1_usd, bl?.demurrage_rate_override_p2_usd)
    return sum + calc.total_usd
  }, 0)

  return (
    <>
      <PageHeader
        title="Demurrage"
        description="Rastreamento de sobreestadia de containers"
        action={
          <Link to="/demurrage/invoices">
            <Button variant="secondary">
              <FileText size={15} />
              Invoices D&D
            </Button>
          </Link>
        }
      />

      {/* KPI bar */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-slate-400">Containers em atraso</div>
          <div className="text-2xl font-bold text-red-400">{kpis?.overdueContainers ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Total USD (visível)</div>
          <div className="text-2xl font-bold text-amber-400">{fmtUSD(totalOverdueUSD)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Invoices draft (USD)</div>
          <div className="text-2xl font-bold text-slate-300">{kpis ? fmtUSD(kpis.draftInvoicesTotalUsd) : '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Aguard. pagamento (BRL)</div>
          <div className="text-2xl font-bold text-blue-400">
            {kpis ? `R$ ${kpis.issuedInvoicesTotalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
        </Card>
      </div>

      {/* Filter bar */}
      <Card className="mb-4 p-4">
        <Field label="Buscar">
          <Input placeholder="Container, BL ou cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </Card>

      {isLoading && <Card>Carregando...</Card>}
      {error && <InlineError message="Erro ao carregar containers." />}

      {!isLoading && !error && grouped.size === 0 && (
        <EmptyState icon={Clock} title="Nenhum container ativo" description="Todos os containers foram devolvidos ou não há descargas registradas." />
      )}

      {/* Grouped by BL */}
      {Array.from(grouped.entries()).map(([blId, blContainers]) => {
        const firstBl = blContainers[0].bl as { customer?: { name?: string; cnpj_cpf?: string } | null; voyage?: { voyage_number?: string; vessel?: { name?: string } | null } | null } | null
        const customerName = firstBl?.customer?.name ?? blId
        const voyageInfo = firstBl?.voyage?.voyage_number ? `${firstBl.voyage.voyage_number} — ${firstBl.voyage.vessel?.name ?? ''}` : ''
        const hasOverdue = blContainers.some((c) => c.demurrage_status === 'overdue')
        const blTotalUSD = blContainers.reduce((sum, c) => {
          if (!c.discharge_date || !c.return_date) return sum
          const blData = c.bl as { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null
          return sum + calculateDemurrage(c.type, c.discharge_date, c.return_date, blData?.free_time_override, blData?.demurrage_rate_override_p1_usd, blData?.demurrage_rate_override_p2_usd).total_usd
        }, 0)

        return (
          <Card key={blId} className="mb-4">
            <div className="flex items-start justify-between gap-4 border-b border-[#30363d] p-4">
              <div>
                <Link to={`/manifestos/${blId}`} className="font-semibold text-blue-400 hover:underline">
                  {blId}
                </Link>
                <div className="text-sm text-slate-400">{customerName}</div>
                {voyageInfo && <div className="text-xs text-slate-500">{voyageInfo}</div>}
              </div>
              <div className="flex items-center gap-3">
                {blTotalUSD > 0 && <span className="text-sm font-semibold text-amber-400">{fmtUSD(blTotalUSD)}</span>}
                {hasOverdue && (
                  <Button
                    variant="secondary"
                    disabled={generatingBl === blId}
                    onClick={() => { setGeneratingBl(blId); generateMutation.mutate(blId) }}
                  >
                    <FileText size={14} />
                    {generatingBl === blId ? 'Gerando...' : 'Gerar Invoice'}
                  </Button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="app-table app-table--compact min-w-[820px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Container</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">Descarga</th>
                    <th className="py-2">Devolucao</th>
                    <th className="py-2">Dias totais</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {blContainers.map((c) => {
                    const blData = c.bl as { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null
                    const calc = c.discharge_date && c.return_date ? calculateDemurrage(c.type, c.discharge_date, c.return_date, blData?.free_time_override, blData?.demurrage_rate_override_p1_usd, blData?.demurrage_rate_override_p2_usd) : null
                    return (
                      <tr key={c.id}>
                        <td className="py-2 font-semibold text-white">{c.container_number}</td>
                        <td className="py-2">{c.type ?? '-'}</td>
                        <td className="py-2">{c.discharge_date ? formatDate(c.discharge_date) : '—'}</td>
                        <td className="py-2">{c.return_date ? formatDate(c.return_date) : <span className="text-slate-500">Pendente</span>}</td>
                        <td className="py-2">{calc ? calc.total_days : '—'}</td>
                        <td className="py-2"><DemurrageStatusBadge status={c.demurrage_status} /></td>
                        <td className="py-2 font-semibold text-amber-400">{calc && calc.total_usd > 0 ? fmtUSD(calc.total_usd) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )
      })}
    </>
  )
}
