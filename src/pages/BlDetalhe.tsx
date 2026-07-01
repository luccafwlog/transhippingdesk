/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Upload } from 'lucide-react'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { Card, PageHeader } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { BLPipeline } from '../components/shared/BLPipeline'
import { BlImportModal } from '../components/shared/BlImportModal'
import { BlDetalhesTab } from '../components/bl/BlDetalhesTab'
import { BlFaturamentoTab } from '../components/bl/BlFaturamentoTab'
import { BlHistoricoTab } from '../components/bl/BlHistoricoTab'
import { Button } from '../components/ui/Button'
import { useBlDetail } from '../hooks/useBls'
import { useBlEditForm } from '../hooks/useBlEditForm'
import { cargoModeLabel, resolveCargoMode } from './blDetalheHelpers'

export type BlTab = 'detalhes' | 'faturamento' | 'historico'

export const BL_TABS: { key: BlTab; label: string }[] = [
  { key: 'detalhes', label: 'Detalhes do B/L' },
  { key: 'faturamento', label: 'Faturamento' },
  { key: 'historico', label: 'Histórico' },
]

export function isBlTab(value: string | null): value is BlTab {
  return value === 'detalhes' || value === 'faturamento' || value === 'historico'
}

export function BlDetalhe() {
  const { blId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const tabParam = searchParams.get('tab')
  const activeTab: BlTab = isBlTab(tabParam) ? tabParam : 'detalhes'
  const { data: bl, isLoading, error } = useBlDetail(blId)

  const cargoMode = useMemo(() => resolveCargoMode(bl), [bl])
  const isContainerMode = cargoMode === 'container'
  const backHref = isContainerMode ? '/manifestos' : '/carga-solta'
  const backLabel = isContainerMode ? 'Voltar aos manifestos CNTR' : 'Voltar aos manifestos BB'
  const voyageLabel = [bl?.voyage?.vessel?.name, bl?.voyage?.voyage_number].filter(Boolean).join(' / ')

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
          <div className="flex flex-wrap justify-end gap-2">
            {isContainerMode ? (
              <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
                <Upload size={16} />
                Importar Frete B/L
              </Button>
            ) : null}
            <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={backHref}>
              <ArrowLeft className="mr-1 inline" size={16} />
              {backLabel}
            </Link>
          </div>
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
                if (tab.key === 'detalhes') next.delete('tab')
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
      <BlDetalhesTab
        active={activeTab === 'detalhes'}
        bl={bl}
        blId={blId}
        form={form}
        changes={changes}
        saving={saving}
        justification={justification}
        cargoMode={cargoMode}
        isContainerMode={isContainerMode}
        containerSummary={containerSummary}
        breakbulkSummary={breakbulkSummary}
        onFieldChange={setField}
        onJustificationChange={setJustification}
        onSubmit={handleSubmit}
      />

      <BlFaturamentoTab active={activeTab === 'faturamento'} bl={bl} />

      <BlHistoricoTab active={activeTab === 'historico'} blId={blId} />

      <BlImportModal
        open={blFreightOpen}
        onClose={() => setBlFreightOpen(false)}
        voyageId={bl.voyage_id}
        voyageLabel={voyageLabel || undefined}
        onlyBlId={bl.id}
      />
    </>
  )
}
