/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Upload } from 'lucide-react'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { Card, PageHeader } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { BlImportModal } from '../components/shared/BlImportModal'
import { BlDetalhesTab } from '../components/bl/BlDetalhesTab'
import { BlFaturamentoTab } from '../components/bl/BlFaturamentoTab'
import { BlHistoricoTab } from '../components/bl/BlHistoricoTab'
import { BlVisaoGeralTab } from '../components/bl/BlVisaoGeralTab'
import { BlRailsPipeline } from '../components/bl/BlRailsPipeline'
import { Button } from '../components/ui/Button'
import { useBlDetail } from '../hooks/useBls'
import { useBlEditForm } from '../hooks/useBlEditForm'
import { useBlCockpit } from '../hooks/useBlCockpit'
import { useAuth } from '../hooks/useAuth'
import { useSetBlDisposition } from '../hooks/useTransshipments'
import { useInvoiceLinks } from '../hooks/useBilling'
import { listDemurrageInvoices } from '../services/demurrage/demurrageInvoices'
import { buildFinancialRail, buildOperationalRail, pickNextAction } from '../services/blRails'
import { getBlPortalStatus } from '../services/blPortalStatus'
import { queryKeys } from '../services/queryKeys'
import { useVoyageReconciliation } from '../hooks/useVoyageReconciliation'
import { cargoModeLabel, resolveCargoMode } from './blDetalheHelpers'

export type BlTab = 'visao-geral' | 'detalhes' | 'faturamento' | 'historico'

export const BL_TABS: { key: BlTab; label: string }[] = [
  { key: 'visao-geral', label: 'Visão Geral' },
  { key: 'detalhes', label: 'Detalhes do B/L' },
  { key: 'faturamento', label: 'Faturamento' },
  { key: 'historico', label: 'Histórico' },
]

export function isBlTab(value: string | null): value is BlTab {
  return value === 'visao-geral' || value === 'detalhes' || value === 'faturamento' || value === 'historico'
}

export function BlDetalhe() {
  const { blId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const tabParam = searchParams.get('tab')
  const activeTab: BlTab = isBlTab(tabParam) ? tabParam : 'visao-geral'
  const { data: bl, isLoading, error } = useBlDetail(blId)
  const { user } = useAuth()
  const { setTransshipment, setCod } = useSetBlDisposition(bl?.voyage_id ?? 0)
  const cockpitQuery = useBlCockpit(bl)
  const { data: invoiceLinksByBl } = useInvoiceLinks(bl?.id ? [bl.id] : [])
  const { data: demurrageInvoices } = useQuery({
    queryKey: queryKeys.demurrage.invoices({ blId: bl?.id }),
    enabled: Boolean(bl?.id),
    queryFn: () => listDemurrageInvoices({ blId: bl!.id }),
  })
  const { data: portalStatus } = useQuery({
    queryKey: queryKeys.portal.blStatus(bl?.id),
    enabled: Boolean(bl?.id),
    queryFn: () => getBlPortalStatus({ blId: bl!.id, ceMercante: bl!.ce_mercante, customerId: bl!.customer_id }),
  })
  const cargoMode = useMemo(() => resolveCargoMode(bl), [bl])
  const isContainerMode = cargoMode === 'container'
  const { data: reconciliation } = useVoyageReconciliation(isContainerMode ? bl?.voyage_id : null)
  const backHref = isContainerMode ? '/manifestos' : '/carga-solta'
  const backLabel = isContainerMode ? 'Voltar aos manifestos CNTR' : 'Voltar aos manifestos BB'
  const voyageLabel = [bl?.voyage?.vessel?.name, bl?.voyage?.voyage_number].filter(Boolean).join(' / ')

  const { form, setField, justification, setJustification, saving, changes, handleSubmit } = useBlEditForm(bl, isContainerMode)

  const railContainers = useMemo(() => (bl?.bl_containers ?? []).map((container) => ({
    container_number: container.container_number,
    discharge_date: container.discharge_date,
    return_date: container.return_date,
  })), [bl?.bl_containers])
  const operational = useMemo(() => bl ? buildOperationalRail({ bl, polSchedule: cockpitQuery.data?.polSchedule ?? null, podSchedule: cockpitQuery.data?.podSchedule ?? null, containers: railContainers, omission: cockpitQuery.data?.omission ?? null }) : [], [bl, cockpitQuery.data, railContainers])
  const latestInvoice = bl ? invoiceLinksByBl?.[bl.id]?.[0] ?? null : null
  const financial = useMemo(() => bl ? buildFinancialRail({ bl, latestInvoice: latestInvoice ? { id: latestInvoice.id, status: latestInvoice.status, total_brl: latestInvoice.total_brl } : null, demurrageInvoices: (demurrageInvoices ?? []).map((invoice) => ({ id: invoice.id, status: invoice.status })) }) : [], [bl, demurrageInvoices, latestInvoice])
  const blDivergenceCount = useMemo(() => {
    if (!reconciliation || !bl) return 0
    const numbers = new Set((bl.bl_containers ?? []).map((container) => container.container_number))
    return reconciliation.items.filter((item) => item.kind === 'missing_in_baplie' ? item.bl_number === bl.id : item.baplie_bl_ref === bl.id || numbers.has(item.container_number)).length
  }, [reconciliation, bl])

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
            ? 'Edição manual com auditoria. Esta tela exibe containers e veículos vinculados a este B/L.'
            : 'Edição manual com auditoria. Esta tela exibe o resumo operacional do manifesto BB vinculado a este B/L.'
        }
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {isContainerMode ? (
              <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
                <Upload size={16} />
                Importar B/L
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
        <BlRailsPipeline operational={operational} financial={financial} nextAction={pickNextAction(financial)} />
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
                if (tab.key === 'visao-geral') next.delete('tab')
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
      <BlVisaoGeralTab
        active={activeTab === 'visao-geral'}
        bl={bl}
        cockpit={cockpitQuery.data}
        isContainerMode={isContainerMode}
        containerSummary={containerSummary}
        breakbulkSummary={breakbulkSummary}
        omission={cockpitQuery.data?.omission}
        disposition={cockpitQuery.data?.transshipment?.disposition}
        savingDisposition={setTransshipment.isPending || setCod.isPending}
        onCod={() => {
          if (user?.id && bl?.voyage_id && cockpitQuery.data?.omission) setCod.mutate({ blId: bl.id, omissionId: cockpitQuery.data.omission.id, changedBy: user.id })
        }}
        onRestore={() => {
          if (user?.id && bl?.voyage_id && cockpitQuery.data?.omission) setTransshipment.mutate({ blId: bl.id, omissionId: cockpitQuery.data.omission.id, changedBy: user.id })
        }}
        portalStatus={portalStatus}
        blDivergenceCount={blDivergenceCount}
      />
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
        key={`${blFreightOpen ? 'open' : 'closed'}-${bl.voyage_id ?? 'none'}-${bl.id}`}
        open={blFreightOpen}
        onClose={() => setBlFreightOpen(false)}
        voyageId={bl.voyage_id}
        voyageLabel={voyageLabel || undefined}
        onlyBlId={bl.id}
      />
    </>
  )
}
