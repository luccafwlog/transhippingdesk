import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Boxes, Download } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { type ContainerFilters, fetchAllContainers, useContainers, useVoyageOptions } from '../hooks/useBls'
import { formatCnpjCpf } from '../lib/utils'
import { exportContainerWorkbook } from '../services/exports'

const pageSizes = [20, 50, 100]

export function Containers() {
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const { showToast } = useToast()
  const [filters, setFilters] = useState<ContainerFilters>({
    search: '',
    voyageId: initialVoyage,
    pod: '',
    reviewStatus: '',
    financialStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })
  const [exporting, setExporting] = useState(false)
  const { data, isLoading, error } = useContainers(filters)

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof ContainerFilters>(key: K, value: ContainerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllContainers(filters)
      if (!rows.length) {
        showToast('Nenhum container encontrado para exportar com os filtros atuais.', 'info')
        return
      }

      await exportContainerWorkbook(rows)
      showToast(`Exportacao concluida com ${rows.length} container(es).`, 'success')
    } catch {
      showToast('Falha ao exportar containers.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Containers"
        description="Lista consolidada dos containers importados via manifestos. O total distinto considera o numero do container, mesmo quando ele aparece em mais de um B/L."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar Containers
            </Button>
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to="/manifestos"
            >
              <Boxes size={16} />
              Voltar aos Manifestos
            </Link>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Texto livre">
            <Input
              placeholder="Container, B/L, cliente ou navio"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </Field>
          <Field label="Viagem">
            <VoyageSelect value={filters.voyageId} onChange={(value) => updateFilter('voyageId', value)} />
          </Field>
          <Field label="POD">
            <Input value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)} />
          </Field>
          <Field label="Status revisao do B/L">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
            </Select>
          </Field>
          <Field label="Status financeiro do B/L">
            <Select
              value={filters.financialStatus}
              onChange={(event) => updateFilter('financialStatus', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="invoiced">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Registros filtrados" value={isLoading ? '...' : data?.count ?? 0} />
        <SummaryCard label="Containers distintos" value={isLoading ? '...' : data?.distinctCount ?? 0} />
        <SummaryCard label="B/Ls envolvidos" value={isLoading ? '...' : data?.blCount ?? 0} />
        <SummaryCard label="OOG distintos" value={isLoading ? '...' : data?.oogDistinctCount ?? 0} />
        <SummaryCard label="IMO distintos" value={isLoading ? '...' : data?.imoDistinctCount ?? 0} />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar containers.</div> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Container</th>
                <th className="px-4 py-3">B/L</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Armador</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="px-4 py-3">POL / POD</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Seal</th>
                <th className="px-4 py-3">Peso bruto</th>
                <th className="px-4 py-3">CBM</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-400">
                    Carregando containers...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-400">
                    Nenhum container encontrado.
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((container) => (
                <tr key={container.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{container.container_number}</td>
                  <td className="px-4 py-3">
                    <Link className="text-[#58a6ff] hover:underline" to={`/manifestos/${container.bl?.id}`}>
                      {container.bl?.id ?? '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{container.bl?.customer?.name ?? container.bl?.consignee ?? '-'}</td>
                  <td className="px-4 py-3">{formatCnpjCpf(container.bl?.customer?.cnpj_cpf)}</td>
                  <td className="px-4 py-3">{container.bl?.voyage?.vessel?.carrier?.name ?? '-'}</td>
                  <td className="px-4 py-3">
                    {container.bl?.voyage?.vessel?.name ?? '-'} / {container.bl?.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">{`${container.bl?.pol ?? '-'} -> ${container.bl?.pod ?? '-'}`}</td>
                  <td className="px-4 py-3">{container.type ?? '-'}</td>
                  <td className="px-4 py-3">{container.seal_number ?? '-'}</td>
                  <td className="px-4 py-3">{Number(container.gross_weight_kg ?? 0).toLocaleString('pt-BR')} kg</td>
                  <td className="px-4 py-3">{Number(container.cbm ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {container.is_oog ? <Badge tone="yellow">OOG</Badge> : null}
                      {container.is_imo ? <Badge tone="red">IMO</Badge> : null}
                      {!container.is_oog && !container.is_imo ? <Badge tone="blue">Standard</Badge> : null}
                    </div>
                    {container.is_imo && (container.imo_class || container.un_number) ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {container.imo_class ?? '-'} / {container.un_number ?? '-'}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="inline-flex rounded-lg border border-[#1f6feb]/40 bg-[#1f6feb]/10 px-3 py-1.5 font-semibold text-[#8cc8ff] hover:bg-[#1f6feb]/20"
                      to={`/manifestos/${container.bl?.id}`}
                    >
                      Abrir B/L
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col justify-between gap-3 border-t border-[#30363d] p-4 text-sm text-slate-400 md:flex-row md:items-center">
          <span>
            Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros · {data?.distinctCount ?? 0} containers distintos
          </span>
          <div className="flex items-center gap-2">
            <Select
              className="w-28"
              value={filters.pageSize}
              onChange={(event) => updateFilter('pageSize', Number(event.target.value))}
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}/pag.
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={filters.page <= 1}
              onClick={() => updateFilter('page', Math.max(1, filters.page - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              disabled={filters.page >= totalPages}
              onClick={() => updateFilter('page', Math.min(totalPages, filters.page + 1))}
            >
              Proxima
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">Considera os filtros ativos desta tela.</div>
    </Card>
  )
}

function VoyageSelect({
  value,
  onChange,
  emptyLabel = 'Todas',
}: {
  value: string
  onChange: (value: string) => void
  emptyLabel?: string
}) {
  const { data } = useVoyageOptions()

  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {data?.map((voyage) => (
        <option key={voyage.id} value={voyage.id}>
          {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
        </option>
      ))}
    </Select>
  )
}
