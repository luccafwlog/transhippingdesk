import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { SkeletonTable } from '../ui/Skeleton'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { formatBRL, formatDate } from '../../lib/utils'
import { listBillingCustomers } from '../../services/billing'
import { listReconciliationHistory, type ReconciliationFilters } from '../../services/reconciliacao'

type SortField = NonNullable<ReconciliationFilters['sort']>

type SortConfig = { field: SortField; dir: 'asc' | 'desc' }

const DEFAULT_SORT: SortConfig = { field: 'paidAt', dir: 'desc' }

const PAGE_SIZES = [20, 50, 100]

function statusBadge(status: string) {
  if (status === 'paid') return <Badge tone="green">Paga</Badge>
  if (status === 'covered') return <Badge tone="green">Coberta</Badge>
  if (status === 'partially_paid') return <Badge tone="yellow">Parcial</Badge>
  return <Badge tone="slate">{status}</Badge>
}

type ReconciliationHistoryTableProps = {
  onSelectLocalInvoice?: (invoiceId: number) => void
  onSelectDemurrageInvoice?: (demurrageId: number) => void
}

export function ReconciliationHistoryTable({
  onSelectLocalInvoice,
  onSelectDemurrageInvoice,
}: ReconciliationHistoryTableProps) {
  const [paidFrom, setPaidFrom] = useState('')
  const [paidTo, setPaidTo] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'' | 'local' | 'demurrage'>('')
  const [customerId, setCustomerId] = useState('')
  const [blSearch, setBlSearch] = useState('')
  const [voyageSearch, setVoyageSearch] = useState('')
  const [pod, setPod] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT)

  const filters: ReconciliationFilters = {
    paidFrom, paidTo, source: sourceFilter, customerId,
    blSearch, voyageSearch, pod,
    sort: sort.field, sortDir: sort.dir,
    page, pageSize,
  }

  const activeCount = useMemo(() => {
    let n = 0
    if (paidFrom) n++
    if (paidTo) n++
    if (sourceFilter) n++
    if (customerId) n++
    if (blSearch) n++
    if (voyageSearch) n++
    if (pod) n++
    return n
  }, [paidFrom, paidTo, sourceFilter, customerId, blSearch, voyageSearch, pod])

  const { data, isLoading, error } = useQuery({
    queryKey: ['reconciliation-history', filters],
    queryFn: () => listReconciliationHistory(filters),
    staleTime: 15_000,
  })

  const rows = useMemo(() => data?.rows ?? [], [data?.rows])
  const totalCount = data?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  function updateSort(field: SortField) {
    setSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
    setPage(1)
  }

  function clearFilters() {
    setPaidFrom('')
    setPaidTo('')
    setSourceFilter('')
    setCustomerId('')
    setBlSearch('')
    setVoyageSearch('')
    setPod('')
    setPage(1)
  }

  function renderSortCell(field: SortField, label: string) {
    const active = sort.field === field
    return (
      <th
        scope="col"
        className="cursor-pointer select-none px-4 py-3 hover:text-slate-300"
        onClick={() => updateSort(field)}
      >
        <div className="flex items-center gap-1">
          {label}
          {active ? (
            sort.dir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />
          ) : (
            <ArrowUpDown size={13} className="opacity-30" />
          )}
        </div>
      </th>
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[#30363d] p-4">
        <FilterBar activeCount={activeCount} onClear={clearFilters} title="Filtros do hist\u00f3rico">
          <div className="app-filter-grid">
            <Field label="Per\u00edodo de">
              <Input type="date" value={paidFrom} onChange={(e) => { setPaidFrom(e.target.value); setPage(1) }} />
            </Field>
            <Field label="Per\u00edodo at\u00e9">
              <Input type="date" value={paidTo} onChange={(e) => { setPaidTo(e.target.value); setPage(1) }} />
            </Field>
            <Field label="Tipo">
              <Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value as '' | 'local' | 'demurrage'); setPage(1) }}>
                <option value="">Todos</option>
                <option value="local">Taxas Locais</option>
                <option value="demurrage">Demurrage</option>
              </Select>
            </Field>
            <Combobox
              key={`cust-${page}`}
              label="Consignat\u00e1rio"
              placeholder="Nome ou CNPJ"
              initialValue=""
              onValueChange={(value) => { if (!value.trim()) { setCustomerId(''); setPage(1) } }}
              fetchOptions={async (q) =>
                (await listBillingCustomers(q)).map((c): ComboOption => ({ value: String(c.id), label: c.name, meta: c.cnpj_cpf }))
              }
              onSelectOption={(option) => { setCustomerId(option.value); setPage(1) }}
            />
            <Field label="B/L">
              <Input
                type="text"
                placeholder="N\u00famero do BL"
                value={blSearch}
                onChange={(e) => { setBlSearch(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="Navio / Viagem">
              <Input
                type="text"
                placeholder="Navio ou viagem"
                value={voyageSearch}
                onChange={(e) => { setVoyageSearch(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="POD">
              <Input
                type="text"
                placeholder="Porto de destino"
                value={pod}
                onChange={(e) => { setPod(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="Itens por p\u00e1gina">
              <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/p\u00e1g.</option>)}
              </Select>
            </Field>
          </div>
        </FilterBar>
      </div>

      <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{totalCount} registro(s) encontrado(s)</span>
        <span className="text-xs text-slate-400">
          P\u00e1gina {page} de {totalPages}
        </span>
      </div>

      {error ? <InlineError message="Erro ao carregar hist\u00f3rico de concilia\u00e7\u00e3o." /> : null}

      <div className="app-table-scroll app-table-scroll--sticky">
        <table className="app-table app-table--compact min-w-[1200px] text-left text-sm">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Tipo</th>
              {renderSortCell('docNumber', 'N\u00ba Documento')}
              <th scope="col" className="px-4 py-3">Tipo Doc.</th>
              {renderSortCell('customerName', 'Consignat\u00e1rio')}
              {renderSortCell('blId', 'B/L')}
              <th scope="col" className="px-4 py-3">Navio / Viagem</th>
              <th scope="col" className="px-4 py-3">POD</th>
              {renderSortCell('totalAmount', 'Valor Total')}
              {renderSortCell('paidAt', 'Pagamento')}
              {renderSortCell('status', 'Status')}
              <th scope="col" className="px-4 py-3">A\u00e7\u00f5es</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {isLoading ? (
              <tr><td colSpan={11} className="p-0"><SkeletonTable rows={6} cols={11} /></td></tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr><td colSpan={11} className="p-0"><EmptyState title="Nenhum pagamento encontrado." description={activeCount > 0 ? 'Tente limpar os filtros.' : 'Nenhuma concilia\u00e7\u00e3o registrada ainda.'} /></td></tr>
            ) : null}
            {rows.map((row) => {
              const voyageLabel = [row.vesselName, row.voyageNumber].filter(Boolean).join(' \u00b7 ') || '\u2014'
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    {row.source === 'demurrage' ? (
                      <Badge tone="blue">Demurrage</Badge>
                    ) : (
                      <Badge tone="green">Taxas Locais</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">{row.docNumber}</td>
                  <td className="px-4 py-3">
                    {row.source === 'demurrage' ? (
                      <span className="text-slate-500">\u2014</span>
                    ) : row.invoiceType === 'consolidated' ? (
                      <Badge tone="blue">Consolidada</Badge>
                    ) : (
                      <Badge tone="green">\u00danico BL</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="app-table__truncate app-table__truncate--xl" title={row.customerName}>
                        {row.customerName || '\u2014'}
                      </div>
                      <div className="app-table__cell-meta">{row.customerCnpj || ''}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.blId}</td>
                  <td className="px-4 py-3 text-slate-300">{voyageLabel}</td>
                  <td className="px-4 py-3 text-slate-300">{row.pod || '\u2014'}</td>
                  <td className="px-4 py-3 text-green-400">{formatBRL(row.totalAmount)}</td>
                  <td className="px-4 py-3">{row.paidAt ? formatDate(row.paidAt) : <span className="text-slate-500">\u2014</span>}</td>
                  <td className="px-4 py-3">{statusBadge(row.status)}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (row.source === 'local') onSelectLocalInvoice?.(row.invoiceId)
                        else onSelectDemurrageInvoice?.(row.invoiceId)
                      }}
                    >
                      Detalhes
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="app-table__footer">
        <span>P\u00e1gina {page} de {totalPages} \u00b7 {totalCount} registros</span>
        <div className="app-table__footer-controls">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>
            Anterior
          </Button>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))}>
            Pr\u00f3xima
          </Button>
        </div>
      </div>
    </Card>
  )
}
