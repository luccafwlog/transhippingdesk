import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { usePortalProvisioning } from '../hooks/usePortalProvisioning'
import { comparePriority, type QueueRow } from '../services/portalProvisioning'
import { PortalReviewPanel } from '../components/portal/PortalReviewPanel'

type Preset = 'aguardando_analise' | 'criticas' | 'sem_email' | 'convite_expirado' | 'falha_no_envio' | 'ativo' | 'provisionamento_nao_necessario'

const presets: Array<{ value: Preset; label: string }> = [
  { value: 'criticas', label: 'Pendências críticas' },
  { value: 'aguardando_analise', label: 'Aguardando análise' },
  { value: 'sem_email', label: 'Sem email' },
  { value: 'convite_expirado', label: 'Convites expirados' },
  { value: 'falha_no_envio', label: 'Falhas de envio' },
  { value: 'ativo', label: 'Contas ativas' },
  { value: 'provisionamento_nao_necessario', label: 'Provisionamento não necessário' },
]

function matchesPreset(row: QueueRow, preset: Preset) {
  if (preset === 'criticas') return row.hasCriticalAlert
  if (preset === 'sem_email') return !row.recovery_email && row.candidates.length === 0
  if (preset === 'ativo') return row.account_situation === 'ativo'
  if (preset === 'provisionamento_nao_necessario') return row.provisioning_decision === preset
  return row.account_situation === preset || row.provisioning_decision === preset
}

export function ClientesPortal() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data = [], isLoading, error, refetch } = usePortalProvisioning()
  const [search, setSearch] = useState('')
  const selectedCustomerId = Number(searchParams.get('cliente')) || null
  const [preset, setPreset] = useState<Preset>((searchParams.get('filtro') as Preset) || 'aguardando_analise')
  const rows = useMemo(() => data.filter((row) => {
    const text = `${row.customer_name} ${row.cnpj_cpf}`.toLowerCase()
    return text.includes(search.toLowerCase()) && matchesPreset(row, preset)
  }).sort(comparePriority), [data, preset, search])
  const selected = data.find((row) => row.customer_id === selectedCustomerId)
  const count = (fn: (row: QueueRow) => boolean) => data.filter(fn).length

  function selectPreset(value: Preset) {
    setPreset(value)
    setSearchParams((current) => { current.set('filtro', value); return current }, { replace: true })
  }

  return (
    <>
      <PageHeader title="Portal do Cliente" description="Fila operacional de análise, convites e situações do Portal." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[['Total', data.length, 'all'], ['Críticas', count((row) => row.hasCriticalAlert), 'criticas'], ['Aguardando análise', count((row) => row.provisioning_decision === 'aguardando_analise'), 'aguardando_analise'], ['Sem email', count((row) => !row.recovery_email && !row.candidates.length), 'sem_email'], ['Convites pendentes', count((row) => row.account_situation === 'convite_pendente'), 'convite_pendente'], ['Expirados', count((row) => row.account_situation === 'convite_expirado'), 'convite_expirado'], ['Falhas', count((row) => row.account_situation === 'falha_no_envio'), 'falha_no_envio'], ['Ativas', count((row) => row.account_situation === 'ativo'), 'ativo']].map(([label, value, valueFilter]) => (
          <button key={String(label)} type="button" className="text-left" onClick={() => valueFilter !== 'all' && selectPreset(valueFilter as Preset)}>
            <Card className="h-full"><div className="text-xs text-[var(--app-muted)]">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></Card>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {presets.map((item) => <button key={item.value} type="button" className={`app-tab ${preset === item.value ? 'app-tab--active' : ''}`} onClick={() => selectPreset(item.value)}>{item.label}</button>)}
        <Input aria-label="Buscar cliente" className="ml-auto min-w-64" placeholder="Buscar razão social ou CNPJ" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {error ? <InlineError message="Erro ao carregar a fila do Portal." /> : null}
      <Card className="overflow-hidden p-0">
        <div className="app-table-scroll"><table className="app-table app-table--compact min-w-[900px] text-left text-sm"><thead><tr><th>Cliente</th><th>Situação</th><th>Decisão</th><th>Email de Recuperação</th><th>Alertas</th><th>Próxima ação</th></tr></thead><tbody>
          {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center">Carregando fila...</td></tr> : null}
          {!isLoading && !rows.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--app-muted)]">Nenhum cliente neste filtro.</td></tr> : null}
          {rows.map((row) => <tr key={row.customer_id} className="cursor-pointer" onClick={() => setSearchParams((current) => { current.set('cliente', String(row.customer_id)); return current })}>
            <td className="px-4 py-3"><div className="font-medium">{row.customer_name}</div><div className="font-mono text-xs text-[var(--app-muted)]">{row.cnpj_cpf}</div></td>
            <td className="px-4 py-3"><Badge tone={row.account_situation === 'ativo' ? 'green' : row.account_situation === 'falha_no_envio' ? 'red' : 'yellow'}>{row.account_situation}</Badge></td>
            <td className="px-4 py-3">{row.provisioning_decision}</td><td className="px-4 py-3">{row.recovery_email ?? (row.candidates[0]?.email ?? 'Sem email')}</td>
            <td className="px-4 py-3">{row.hasCriticalAlert ? 'Crítico' : '—'}</td><td className="px-4 py-3">{row.account_situation === 'convite_pendente' ? 'Aguardar ativação' : row.recovery_email ? 'Revisar situação' : 'Revisar email'}</td>
          </tr>)}
        </tbody></table></div>
      </Card>
      {selected ? <PortalReviewPanel row={selected} onClose={() => setSearchParams((current) => { current.delete('cliente'); return current })} onSaved={() => void refetch()} /> : null}
    </>
  )
}
