import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FilePlus2, Printer } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { TabButton } from '../components/ui/TabButton'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { InvoiceDocumentLocal } from '../components/billing/InvoiceDocumentLocal'
import { InvoiceDocument as DemurrageInvoiceDocument } from '../components/demurrage/InvoiceDocument'
import { PortalConsolidatedModal } from '../components/portal/PortalConsolidatedModal'
import { DisputeModal } from '../components/portal/DisputeModal'
import { PortalDemurrageDetailModal } from '../components/portal/PortalDemurrageDetailModal'
import { PortalInvoiceDetailModal } from '../components/portal/PortalInvoiceDetailModal'
import { DemurrageTab, LocalFeesTab } from '../components/portal/PortalBillingTabs'
import { usePortalAuth } from '../hooks/usePortalAuth'
import {
  usePortalConsolidatableReceivables,
  usePortalCurrentRoe,
  usePortalDemurrageInvoiceDetail,
  usePortalDemurrageInvoices,
  usePortalInvoiceDetail,
  usePortalInvoices,
  usePortalObsoleteConsolidation,
} from '../hooks/usePortalBilling'
import { buildInvoiceFileBaseName } from '../components/shared/invoiceFormat'
import { exportPortalDemurrageWorkbook, exportPortalLocalInvoicesWorkbook } from '../services/exports'
import { EMPTY_PORTAL_BILLING_FILTERS, type PortalBillingFilters } from '../lib/portalBillingFilters'
import { formatBRL } from '../lib/utils'
import { portalErrorMessage } from '../lib/portalErrorMessage'
import { STATUS_GROUPS, type PortalStatusFilter } from '../lib/portalInvoiceStatus'

type PortalTab = 'local' | 'demurrage'
type StatusFilter = PortalStatusFilter
type Filters = PortalBillingFilters

function matchesStatus(status: string | null, filter: StatusFilter) {
  if (!filter) return true
  return (STATUS_GROUPS[filter] as readonly string[]).includes(status ?? 'issued')
}

function inDateRange(value: string | null, from: string, to: string) {
  if (!value) return !from && !to
  const day = value.slice(0, 10)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

// Match por substring case-insensitive contra uma lista de valores (navio/viagem, BLs).
function matchesText(values: string[], term: string) {
  if (!term.trim()) return true
  const needle = term.trim().toLowerCase()
  return values.some((v) => v.toLowerCase().includes(needle))
}

export function PortalBilling() {
  const { overview } = usePortalAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: receivables } = usePortalConsolidatableReceivables()
  const { data: invoices, isLoading: invoicesLoading, error: invoicesError } = usePortalInvoices()
  const { data: demurrageInvoices, isLoading: demurrageLoading, error: demurrageError } = usePortalDemurrageInvoices()
  const { data: currentRoe } = usePortalCurrentRoe()
  const obsoleteMutation = usePortalObsoleteConsolidation()

  const [searchParams, setSearchParams] = useSearchParams()
  const tab: PortalTab = searchParams.get('tab') === 'demurrage' ? 'demurrage' : 'local'
  const setTab = (next: PortalTab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('tab', next)
      return params
    })
  }
  const [consolidateOpen, setConsolidateOpen] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null)
  const [selectedDemurrageId, setSelectedDemurrageId] = useState<number | null>(null)
  const [disputeInvoiceId, setDisputeInvoiceId] = useState<number | null>(null)
  const [disputeDocNumber, setDisputeDocNumber] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [demurragePrintOpen, setDemurragePrintOpen] = useState(false)
  const [localFilters, setLocalFilters] = useState<Filters>(EMPTY_PORTAL_BILLING_FILTERS)
  const [demFilters, setDemFilters] = useState<Filters>(EMPTY_PORTAL_BILLING_FILTERS)

  const detailQuery = usePortalInvoiceDetail(selectedInvoiceId)
  const demurrageDetailQuery = usePortalDemurrageInvoiceDetail(selectedDemurrageId)

  const eligibleCount = (receivables ?? []).filter((r) => r.eligibility_status === 'eligible').length

  // Opções de dropdown derivadas das próprias faturas do cliente.
  // Navio/Viagem usa o par "NAVIO / VIAGEM" para o autocomplete do filtro.
  const localVesselOptions = useMemo(
    () => Array.from(new Set((invoices ?? []).flatMap((i) => i.vessel_voyages ?? []))).sort(),
    [invoices],
  )
  const localPods = useMemo(
    () => Array.from(new Set((invoices ?? []).flatMap((i) => i.pods ?? []))).sort(),
    [invoices],
  )
  const demVesselOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (demurrageInvoices ?? [])
            .map((i) => (i.vessel_name ? [i.vessel_name, i.voyage_number].filter(Boolean).join(' / ') : null))
            .filter(Boolean) as string[],
        ),
      ).sort(),
    [demurrageInvoices],
  )
  const demPods = useMemo(
    () => Array.from(new Set((demurrageInvoices ?? []).map((i) => i.pod).filter(Boolean) as string[])).sort(),
    [demurrageInvoices],
  )

  const filteredInvoices = useMemo(
    () =>
      (invoices ?? []).filter(
        (i) =>
          matchesStatus(i.status, localFilters.status) &&
          matchesText(i.vessel_voyages ?? [], localFilters.vessel) &&
          matchesText(i.bls ?? [], localFilters.bl) &&
          (!localFilters.pod || (i.pods ?? []).includes(localFilters.pod)) &&
          inDateRange(i.issued_at, localFilters.dateFrom, localFilters.dateTo),
      ),
    [invoices, localFilters],
  )

  const filteredDemurrage = useMemo(
    () =>
      (demurrageInvoices ?? []).filter(
        (i) =>
          matchesStatus(i.status, demFilters.status) &&
          matchesText([i.vessel_name, i.voyage_number].filter(Boolean) as string[], demFilters.vessel) &&
          matchesText([i.bl_id], demFilters.bl) &&
          (!demFilters.pod || i.pod === demFilters.pod) &&
          inDateRange(i.billed_at, demFilters.dateFrom, demFilters.dateTo),
      ),
    [demurrageInvoices, demFilters],
  )

  function handleExport() {
    if (tab === 'demurrage') {
      void exportPortalDemurrageWorkbook(filteredDemurrage)
      return
    }
    void exportPortalLocalInvoicesWorkbook(filteredInvoices)
  }

  async function handleObsolete() {
    if (!detailQuery.data?.invoice) return
    const confirmed = await confirm({
      title: 'Desfazer fatura consolidada',
      message: 'Desfazer esta fatura consolidada? Os B/Ls voltam a ficar disponíveis para uma nova consolidação.',
      confirmLabel: 'Desfazer',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await obsoleteMutation.mutateAsync(Number(detailQuery.data.invoice.id))
      showToast('Fatura consolidada desfeita. Os B/Ls foram liberados.', 'success')
      setSelectedInvoiceId(null)
    } catch (error) {
      showToast(portalErrorMessage(error, 'Falha ao desfazer a fatura.'), 'error')
    }
  }

  const detailInvoice = detailQuery.data?.invoice
  const canObsolete =
    detailInvoice?.invoice_type === 'consolidated' &&
    ['issued', 'partially_paid', 'overdue'].includes(detailInvoice.status ?? 'issued') &&
    (detailQuery.data?.payments.length ?? 0) === 0

  return (
    <>
      <PageHeader
        title="Faturas"
        description="Consulte suas faturas, pague via PIX e consolide B/Ls em aberto."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={handleExport}>
              <Download size={16} />
              Exportar Excel
            </Button>
            <Button onClick={() => setConsolidateOpen(true)}>
              <FilePlus2 size={16} />
              Gerar fatura consolidada
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
        <MetricCard label="Saldo pendente" value={formatBRL(overview?.pending_balance)} />
        <MetricCard label="Faturas emitidas" value={String(invoices?.length ?? 0)} />
        <MetricCard label="B/Ls elegíveis" value={String(eligibleCount)} />
      </div>

      <div className="mb-4 flex gap-2 border-b border-[var(--app-border)]" role="tablist">
        <TabButton active={tab === 'local'} label="Taxas Locais" onClick={() => setTab('local')} />
        <TabButton active={tab === 'demurrage'} label="Demurrage" onClick={() => setTab('demurrage')} />
      </div>

      {tab === 'local' ? (
        <LocalFeesTab
          invoices={filteredInvoices}
          loading={invoicesLoading}
          error={Boolean(invoicesError)}
          filters={localFilters}
          onFilters={setLocalFilters}
          vesselOptions={localVesselOptions}
          pods={localPods}
          onOpenDetail={setSelectedInvoiceId}
        />
      ) : (
        <>
          {currentRoe ? (
            <div className="mb-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3 text-sm font-semibold text-[var(--app-text-strong)]">
              ROE vigente: R$ {currentRoe.roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
              {' · atualizado em '}
              {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(currentRoe.updatedAt))}
            </div>
          ) : null}
          <DemurrageTab
            invoices={filteredDemurrage}
            loading={demurrageLoading}
            error={Boolean(demurrageError)}
            filters={demFilters}
            onFilters={setDemFilters}
            vesselOptions={demVesselOptions}
            pods={demPods}
            onOpenDetail={setSelectedDemurrageId}
            onDispute={(id, doc) => { setDisputeInvoiceId(id); setDisputeDocNumber(doc) }}
          />
        </>
      )}

      <PortalConsolidatedModal
        open={consolidateOpen}
        onClose={() => setConsolidateOpen(false)}
        onCreated={(id) => setSelectedInvoiceId(id)}
      />

      <DisputeModal
        demurrageInvoiceId={disputeInvoiceId}
        docNumber={disputeDocNumber}
        onClose={() => setDisputeInvoiceId(null)}
      />

      <PortalInvoiceDetailModal
        open={Boolean(selectedInvoiceId)}
        invoiceId={selectedInvoiceId}
        detail={detailQuery.data}
        loading={detailQuery.isLoading}
        error={detailQuery.error}
        canObsolete={canObsolete}
        obsoleteLoading={obsoleteMutation.isPending}
        onClose={() => setSelectedInvoiceId(null)}
        onObsolete={() => void handleObsolete()}
        onPrint={() => setPrintOpen(true)}
        onPrintReceipt={() => setReceiptOpen(true)}
      />
      {printOpen && detailQuery.data?.invoice ? (
        <Modal open onClose={() => setPrintOpen(false)} title={`Imprimir ${detailQuery.data.invoice.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrintOpen(false)}>Fechar</Button>
            <Button
              onClick={() => {
                const prev = document.title
                document.title = buildInvoiceFileBaseName(detailQuery.data!)
                window.print()
                document.title = prev
              }}
            >
              <Printer size={16} />
              Imprimir
            </Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={detailQuery.data} />
          </div>
        </Modal>
      ) : null}

      <PortalDemurrageDetailModal
        open={Boolean(selectedDemurrageId)}
        invoiceId={selectedDemurrageId}
        detail={demurrageDetailQuery.data}
        loading={demurrageDetailQuery.isLoading}
        onClose={() => setSelectedDemurrageId(null)}
        onPrint={() => setDemurragePrintOpen(true)}
      />
      {demurragePrintOpen && demurrageDetailQuery.data?.invoice ? (
        <Modal open onClose={() => setDemurragePrintOpen(false)} title={`Recibo ${demurrageDetailQuery.data.invoice.doc_number}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDemurragePrintOpen(false)}>Fechar</Button>
            <Button onClick={() => window.print()}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content">
            <DemurrageInvoiceDocument
              detail={{
                ...demurrageDetailQuery.data,
                customer: { name: demurrageDetailQuery.data.invoice.customer_name, cnpj_cpf: demurrageDetailQuery.data.invoice.customer_cnpj_cpf },
                bl: { pol: demurrageDetailQuery.data.invoice.pol, pod: demurrageDetailQuery.data.invoice.pod, voyage: { voyage_number: demurrageDetailQuery.data.invoice.voyage_number, vessel: { name: demurrageDetailQuery.data.invoice.vessel_name } } },
              } as never}
              type="receipt"
            />
          </div>
        </Modal>
      ) : null}
      {receiptOpen && detailQuery.data?.invoice ? (
        <Modal open onClose={() => setReceiptOpen(false)} title={`Recibo ${detailQuery.data.invoice.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReceiptOpen(false)}>Fechar</Button>
            <Button onClick={() => window.print()}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content"><InvoiceDocumentLocal detail={detailQuery.data} type="receipt" /></div>
        </Modal>
      ) : null}
    </>
  )
}
