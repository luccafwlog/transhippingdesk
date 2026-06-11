import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { Card, PageHeader } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { BLPipeline } from '../components/shared/BLPipeline'
import { BlCargaTab } from '../components/bl/BlCargaTab'
import { BlCobrancasTab } from '../components/bl/BlCobrancasTab'
import { BlFinanceiroTab } from '../components/bl/BlFinanceiroTab'
import { BlOperacionalTab } from '../components/bl/BlOperacionalTab'
import { useAuditLogs, useBlDetail } from '../hooks/useBls'
import { useBlEditForm } from '../hooks/useBlEditForm'
import { formatDate } from '../lib/utils'
import { cargoModeLabel, resolveCargoMode } from './blDetalheHelpers'

type BlTab = 'operacional' | 'carga' | 'cobrancas' | 'financeiro' | 'historico'

const BL_TABS: { key: BlTab; label: string }[] = [
  { key: 'operacional', label: 'Operacional' },
  { key: 'carga', label: 'Carga' },
  { key: 'cobrancas', label: 'Cobrancas' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'historico', label: 'Histórico' },
]

function isBlTab(value: string | null): value is BlTab {
  return value === 'operacional' || value === 'carga' || value === 'cobrancas' || value === 'financeiro' || value === 'historico'
}

export function BlDetalhe() {
  const { blId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: BlTab = isBlTab(tabParam) ? tabParam : 'operacional'
  const { data: bl, isLoading, error } = useBlDetail(blId)
  const { data: auditLogs } = useAuditLogs('bl', blId)

  const cargoMode = useMemo(() => resolveCargoMode(bl), [bl])
  const isContainerMode = cargoMode === 'container'
  const backHref = isContainerMode ? '/manifestos' : '/carga-solta'
  const backLabel = isContainerMode ? 'Voltar aos manifestos CNTR' : 'Voltar aos manifestos BB'

  const { form, setField, justification, setJustification, saving, changes, handleSubmit } = useBlEditForm(bl, isContainerMode)

  const containerSummary = useMemo(
    () => ({
      distinct: countDistinctContainerNumbers(bl?.bl_containers),
      imo: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => Boolean(container.is_imo)),
      oog: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => Boolean(container.is_oog)),
    }),
    [bl?.bl_containers],
  )

  // Dependa do objeto bl inteiro: identidade só muda em refetch e o cálculo é
  // barato — satisfaz react-hooks/preserve-manual-memoization sem suppression.
  const breakbulkSummary = useMemo(
    () => ({
      machines: Number(bl?.bb_machine_qty ?? 0),
      packages: Number(bl?.bb_packages_qty ?? 0),
      packagesTotal: Number(bl?.bb_packages_total ?? bl?.bb_packages_qty ?? 0),
      weightTon: Number(bl?.bb_weight_ton ?? (bl?.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
      cbm: Number(bl?.total_cbm ?? 0),
    }),
    [bl],
  )

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Manifestos', to: '/manifestos' }, { label: 'Carregando...' }]} />
        <SkeletonCard lines={5} />
      </>
    )
  }

  if (error || !bl || !form) {
    return <Card className="text-red-200">B/L nao encontrado ou erro ao consultar o Supabase.</Card>
  }

  return (
    <>
      <Breadcrumb
        items={[
          { label: 'Manifestos', to: '/manifestos' },
          { label: `B/L ${bl.id}` },
        ]}
      />
      <PageHeader
        title={`B/L ${bl.id} - ${cargoModeLabel(cargoMode)}`}
        description={
          isContainerMode
            ? 'Edicao manual com auditoria. Esta tela exibe containers e veiculos vinculados a este B/L.'
            : 'Edicao manual com auditoria. Esta tela exibe o resumo operacional do manifesto BB vinculado a este B/L.'
        }
        action={
          <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={backHref}>
            <ArrowLeft className="mr-1 inline" size={16} />
            {backLabel}
          </Link>
        }
      />

      <div className="mb-5">
        <BLPipeline bl={bl} />
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-[#30363d]">
        {BL_TABS.map((tab) => {
          const isActive = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                if (tab.key === 'operacional') next.delete('tab')
                else next.set('tab', tab.key)
                setSearchParams(next, { replace: true })
              }}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-b-2 border-[#1f6feb] text-white'
                  : 'border-b-2 border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Abas montadas incondicionalmente (prop `active`) para preservar estado de formulários ao trocar de aba. */}
      <BlOperacionalTab
        active={activeTab === 'operacional'}
        bl={bl}
        form={form}
        changes={changes}
        saving={saving}
        justification={justification}
        cargoMode={cargoMode}
        isContainerMode={isContainerMode}
        onFieldChange={setField}
        onJustificationChange={setJustification}
        onSubmit={handleSubmit}
      />

      <BlFinanceiroTab
        active={activeTab === 'financeiro'}
        bl={bl}
        cargoMode={cargoMode}
        isContainerMode={isContainerMode}
        cargoQuantity={isContainerMode ? containerSummary.distinct : breakbulkSummary.packagesTotal}
      />

      <BlCobrancasTab active={activeTab === 'cobrancas'} bl={bl} />

      <BlCargaTab
        active={activeTab === 'carga'}
        bl={bl}
        blId={blId}
        isContainerMode={isContainerMode}
        containerSummary={containerSummary}
        breakbulkSummary={breakbulkSummary}
      />

      {activeTab === 'historico' ? (
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Auditoria</h2>
          <div className="grid gap-3">
            {auditLogs?.length ? null : <div className="text-sm text-slate-400">Nenhuma alteracao auditada ainda.</div>}
            {auditLogs?.map((log) => (
              <div key={log.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm">
                <div className="font-semibold text-white">
                  {log.field_name}: {log.old_value || '-'} {'->'} {log.new_value || '-'}
                </div>
                <div className="mt-1 text-slate-400">
                  {formatDate(log.changed_at)} {'|'} {log.justification ?? 'Sem justificativa'}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  )
}
