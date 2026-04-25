import { useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import {
  parseGraniteManifestFile,
  importGraniteManifest,
  type ParsedGraniteManifest,
  type ReconciliationStatus,
} from '../services/graniteImport'
import { listGraniteBls, calculateGraniteBlCharges } from '../services/graniteCharges'
import { createInvoiceFromGraniteBls } from '../services/billing'
import { onlyDigits } from '../lib/utils'
import { loadCustomerMaps, findMatchedCustomer } from '../services/customerReconciliation'

const pageSizes = [20, 50, 100]

type Filters = {
  search: string
  voyageId: string
  dischargePort: string
  page: number
  pageSize: number
}

export function Granite() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: voyageOptions } = useVoyageOptions()
  const initialVoyageId = searchParams.get('voyage') ?? ''

  const [filters, setFilters] = useState<Filters>({
    search: '',
    voyageId: initialVoyageId,
    dischargePort: '',
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<ParsedGraniteManifest | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Overrides de CNPJ feitos inline no preview
  const [cnpjOverrides, setCnpjOverrides] = useState<Record<number, string>>({})
  const [chargeBlId, setChargeBlId] = useState<string | null>(null)
  const [chargeLines, setChargeLines] = useState<Array<{ description: string | null; charge_type: string | null; quantity: number | null; unit_value: number | null; subtotal: number | null; currency: string | null }>>([])

  const { data, isLoading, error } = useQuery({
    queryKey: ['granite-bls', filters],
    queryFn: () => listGraniteBls(filters),
  })

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setManifest(null)
    setCnpjOverrides({})
    if (!nextFile) return
    setParsing(true)
    try {
      setManifest(await parseGraniteManifestFile(nextFile))
      showToast('Preview carregado.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleCnpjOverride(rowIndex: number, cnpj: string) {
    setCnpjOverrides((prev) => ({ ...prev, [rowIndex]: cnpj }))
    if (!manifest) return
    const digits = onlyDigits(cnpj)
    if (digits.length < 11) return
    const maps = await loadCustomerMaps()
    const bl = manifest.bls[rowIndex]
    const match = findMatchedCustomer({ cnpjCpf: cnpj, consignee: bl.shipper_name ?? '' }, maps)
    if (match) {
      const updated = manifest.bls.map((b, i) =>
        i === rowIndex ? { ...b, shipper_cnpj: cnpj, clientId: match.customer.id, reconciliationStatus: 'matched' as ReconciliationStatus } : b,
      )
      setManifest({ ...manifest, bls: updated })
    }
  }

  async function handleImport() {
    if (!manifest || !voyageId || !user) return
    setSubmitting(true)
    try {
      const { pendingCount } = await importGraniteManifest({
        filename: file?.name ?? 'granito.xlsx',
        voyageId: Number(voyageId),
        manifest,
        uploadedBy: user.id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
      const msg = pendingCount
        ? `Importado com ${manifest.bls.length} B/Ls. ${pendingCount} com faturamento pendente.`
        : `${manifest.bls.length} B/Ls importados com sucesso.`
      showToast(msg, 'success')
      setUploadOpen(false)
      setVoyageId('')
      setFile(null)
      setManifest(null)
      setCnpjOverrides({})
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCalculateCharges(blId: string, clientId: number | null) {
    try {
      const lines = await calculateGraniteBlCharges(blId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
      if (clientId && user) {
        await createInvoiceFromGraniteBls({ graniteBlIds: [blId], customerId: clientId, issueNow: true, actorId: user.id })
        await queryClient.invalidateQueries({ queryKey: ['invoices'] })
        showToast('Taxas calculadas e fatura emitida automaticamente.', 'success')
      } else {
        setChargeLines(lines)
        setChargeBlId(blId)
        showToast('Taxas calculadas. Vincule um cliente via Revisão para faturar.', 'info')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao calcular taxas.', 'error')
    }
  }

  const pendingInManifest = manifest?.bls.filter((bl) => bl.reconciliationStatus !== 'matched').length ?? 0

  return (
    <>
      <PageHeader
        title="Manifestos Granito"
        description="Importacao do relatorio de cargas COSCO (Granito)."
        action={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={16} />
            Importar Planilha COSCO
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Texto livre">
            <Input
              placeholder="B/L, Shipper ou CNPJ"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
            />
          </Field>
          <Field label="Viagem">
            <Select value={filters.voyageId} onChange={(e) => updateFilter('voyageId', e.target.value)}>
              <option value="">Todas</option>
              {voyageOptions?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vessel?.name ?? 'Navio'} / {v.voyage_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Porto de descarga">
            <Input
              placeholder="Ex: ITMDX"
              value={filters.dischargePort}
              onChange={(e) => updateFilter('dischargePort', e.target.value)}
            />
          </Field>
          <Field label="Por pagina">
            <Select value={filters.pageSize} onChange={(e) => updateFilter('pageSize', Number(e.target.value))}>
              {pageSizes.map((s) => (
                <option key={s} value={s}>{s}/pag.</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar B/Ls de granito." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1200px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">B/L</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Shipper</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="px-4 py-3">Peso Real (kg)</th>
                <th className="px-4 py-3">Peso Real (ton)</th>
                <th className="px-4 py-3">CBM Final</th>
                <th className="px-4 py-3">Fase</th>
                <th className="px-4 py-3">Status Taxas</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={11}>
                    Carregando...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-0">
                    <EmptyState title="Nenhum B/L de granito encontrado." description="Importe uma planilha COSCO ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {(data?.rows ?? []).map((bl) => (
                <tr key={bl.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-[#58a6ff]">{bl.bl_number}</td>
                  <td className="px-4 py-3">{bl.booking_number ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--lg" title={bl.shipper_name ?? '-'}>
                      {(bl as { customer?: { name?: string } }).customer?.name ?? bl.shipper_name ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{bl.shipper_cnpj ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--xl" title={bl.vessel_voyage ?? '-'}>
                      {bl.vessel_voyage ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{bl.real_weight_kg != null ? Number(bl.real_weight_kg).toLocaleString('pt-BR') : '-'}</td>
                  <td className="px-4 py-3">
                    {bl.real_weight_kg != null ? Number(Number(bl.real_weight_kg) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) : '-'}
                  </td>
                  <td className="px-4 py-3">{bl.final_m3 != null ? Number(bl.final_m3).toLocaleString('pt-BR') : '-'}</td>
                  <td className="px-4 py-3">{bl.phase ?? '-'}</td>
                  <td className="px-4 py-3">
                    <ChargeStatusBadge status={bl.charge_status} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="app-table__action mr-2"
                      onClick={() => handleCalculateCharges(bl.id, (bl as { client_id?: number | null }).client_id ?? null)}
                    >
                      Calcular taxas
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="app-table__footer">
          <span>
            Pagina {filters.page} de {totalPages} - {data?.count ?? 0} registros
          </span>
          <div className="app-table__footer-controls">
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

      {/* Modal de taxas calculadas */}
      <Modal open={chargeBlId !== null} onClose={() => { setChargeBlId(null); setChargeLines([]) }} title="Taxas do B/L">
        {chargeLines.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma taxa ativa cadastrada. Acesse Granito &gt; Taxas para cadastrar.</p>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact w-full text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Taxa</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Quantidade</th>
                  <th className="px-3 py-2">Valor Unit.</th>
                  <th className="px-3 py-2">Subtotal</th>
                  <th className="px-3 py-2">Moeda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {chargeLines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{line.description ?? '-'}</td>
                    <td className="px-3 py-2">{line.charge_type ?? '-'}</td>
                    <td className="px-3 py-2">{line.quantity != null ? Number(line.quantity).toLocaleString('pt-BR') : '-'}</td>
                    <td className="px-3 py-2">{line.unit_value != null ? Number(line.unit_value).toLocaleString('pt-BR', { minimumFractionDigits: 4 }) : '-'}</td>
                    <td className="px-3 py-2 font-semibold text-white">{line.subtotal != null ? Number(line.subtotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}</td>
                    <td className="px-3 py-2">{line.currency ?? 'BRL'}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#58a6ff]/30">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase text-slate-400">Total</td>
                  <td className="px-3 py-2 font-bold text-[#58a6ff]">
                    {chargeLines.reduce((sum, l) => sum + Number(l.subtotal ?? 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2">BRL</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2 border-t border-[#30363d] pt-4">
          <p className="mr-auto text-sm text-slate-400">Para faturar, vincule o cliente na Revisão e recalcule as taxas.</p>
          <Button variant="ghost" onClick={() => { setChargeBlId(null); setChargeLines([]) }}>
            Fechar
          </Button>
        </div>
      </Modal>

      {/* Modal de importação */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Importar Planilha COSCO — Granito">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Formato esperado</div>
            <div className="mt-2 text-slate-400">
              Planilha "Relatorio de Cargas/Booking" exportada pela COSCO. Colunas obrigatorias: <strong>BL</strong> e <strong>Real Weight</strong>.
              CNPJ pode vir vazio — resolva antes de confirmar.
            </div>
          </div>

          <Field label="Viagem de destino">
            <Select value={voyageId} onChange={(e) => setVoyageId(e.target.value)}>
              <option value="">Selecione uma viagem</option>
              {voyageOptions?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vessel?.name ?? 'Navio'} / {v.voyage_number}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Arquivo .xls / .xlsx">
            <Input accept=".xlsx,.xls" type="file" onChange={handleFile} />
          </Field>

          {parsing ? <div className="text-sm text-slate-400">Processando arquivo...</div> : null}

          {manifest ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="B/Ls validos" value={manifest.bls.length} />
                <PreviewBox label="Peso Real total (ton)" value={manifest.bls.reduce((s, b) => s + b.real_weight_kg / 1000, 0)} decimals={3} />
                <PreviewBox label="Erros de parser" value={manifest.rowErrors.length} />
              </div>

              {pendingInManifest > 0 ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {pendingInManifest} B/L(s) sem cliente resolvido. Preencha os CNPJs abaixo ou confirme importar com pendencias (faturamento bloqueado nesses B/Ls).
                </div>
              ) : null}

              <div className="app-table-scroll max-h-80 rounded-xl border border-[#30363d]">
                <table className="app-table app-table--compact min-w-[900px] text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">BL</th>
                      <th className="px-3 py-2">Shipper</th>
                      <th className="px-3 py-2">CNPJ</th>
                      <th className="px-3 py-2">Peso Real (kg)</th>
                      <th className="px-3 py-2">Fase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {manifest.bls.slice(0, 50).map((bl, idx) => (
                      <tr key={bl.bl_number}>
                        <td className="px-3 py-2">
                          <ReconciliationBadge status={bl.reconciliationStatus} />
                        </td>
                        <td className="px-3 py-2 font-semibold text-white">{bl.bl_number}</td>
                        <td className="px-3 py-2">
                          <span className="app-table__truncate app-table__truncate--lg">{bl.shipper_name ?? '-'}</span>
                        </td>
                        <td className="px-3 py-2">
                          {bl.reconciliationStatus === 'missing_cnpj' ? (
                            <Input
                              placeholder="Digite o CNPJ"
                              className="w-40 text-xs"
                              value={cnpjOverrides[idx] ?? ''}
                              onChange={(e) => handleCnpjOverride(idx, e.target.value)}
                            />
                          ) : (
                            bl.shipper_cnpj ?? '-'
                          )}
                        </td>
                        <td className="px-3 py-2">{Number(bl.real_weight_kg).toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2">{bl.phase ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {manifest.rowErrors.length ? (
                <div className="max-h-32 overflow-auto rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {manifest.rowErrors.slice(0, 10).map((e, i) => (
                    <div key={i}>Linha {e.row}: {e.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>Cancelar</Button>
            <Button disabled={!manifest || !voyageId || !user} loading={submitting} onClick={handleImport}>
              Confirmar importacao
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function ChargeStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'calculated': return <span className="app-badge app-badge--blue">Calculado</span>
    case 'ready_for_billing': return <span className="app-badge app-badge--green">Pronto</span>
    case 'invoiced': return <span className="app-badge app-badge--green">Faturado</span>
    default: return <span className="app-badge app-badge--slate">Nao calc.</span>
  }
}

function ReconciliationBadge({ status }: { status: ReconciliationStatus }) {
  switch (status) {
    case 'matched': return <span className="app-badge app-badge--green">✓ OK</span>
    case 'missing_cnpj': return <span className="app-badge app-badge--yellow">⚠ CNPJ</span>
    case 'not_found': return <span className="app-badge app-badge--red">✗ Nao cad.</span>
  }
}

function PreviewBox({ label, value, decimals = 0 }: { label: string; value: number; decimals?: number }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">
        {Number(value).toLocaleString('pt-BR', decimals ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {})}
      </div>
    </div>
  )
}
