import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useCustomerLookup } from '../hooks/useCustomers'
import { useReviewQueue, type ReviewQueueItem } from '../hooks/useReview'
import { formatCnpjCpf } from '../lib/utils'
import { createCustomer } from '../services/customers'
import { logOperationalEvent } from '../services/operationalEvents'
import { ConcurrentEditError, saveBlReview } from '../services/review'

export function Revisao() {
  const { data, isLoading, error } = useReviewQueue()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')
  const [reasonFilter, setReasonFilter] = useState<string | null>(null)

  const filteredData = useMemo(() => {
    if (!data) return []
    let result = data
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      result = result.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          (item.consignee ?? '').toLowerCase().includes(q) ||
          (item.shipper ?? '').toLowerCase().includes(q),
      )
    }
    if (reasonFilter) {
      result = result.filter((item) => item.review_reasons?.includes(reasonFilter))
    }
    return result
  }, [data, searchText, reasonFilter])

  const allReasons = useMemo(() => {
    if (!data) return []
    const reasons = new Set<string>()
    for (const item of data) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons].sort()
  }, [data])

  const selected = selectedIndex !== null ? (filteredData[selectedIndex] ?? null) : null

  function openItem(index: number) {
    setSelectedIndex(index)
  }

  function handleClose() {
    setSelectedIndex(null)
  }

  function handleSaveSuccess() {
    if (selectedIndex === null) return
    // Advance to next item; if last, close
    if (selectedIndex < filteredData.length - 1) {
      setSelectedIndex(selectedIndex + 1)
    } else {
      setSelectedIndex(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Revisao Manual"
        description="Fila de B/Ls com pendencias de importacao que exigem validacao humana."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar B/L, consignatario ou shipper..."
            className="w-72 pl-8"
          />
          <Search className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" size={15} />
          {searchText ? (
            <button
              type="button"
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
              onClick={() => setSearchText('')}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {allReasons.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {allReasons.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setReasonFilter(reasonFilter === reason ? null : reason)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  reasonFilter === reason
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-[#30363d] text-slate-400 hover:border-[#484f58] hover:text-slate-200'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
        ) : null}

        {data && data.length > 0 ? (
          <span className="ml-auto text-xs text-slate-500">
            {filteredData.length} de {data.length} B/L{data.length !== 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar a fila de revisao." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">B/L</th>
                <th className="px-4 py-3">Pendencias</th>
                <th className="px-4 py-3">Consignatario</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Carregando fila de revisao...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !filteredData.length ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      title={data?.length ? 'Nenhum B/L corresponde ao filtro.' : 'Nenhum B/L pendente de revisao.'}
                      description={data?.length ? 'Limpe os filtros para ver todos os pendentes.' : undefined}
                    />
                  </td>
                </tr>
              ) : null}
              {filteredData.map((item, index) => (
                <tr key={item.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{item.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {(item.review_reasons?.length ? item.review_reasons : ['Pendente de revisao']).map((reason) => (
                        <Badge key={reason} tone="yellow">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{item.consignee ?? '-'}</td>
                  <td className="px-4 py-3">{item.customer?.name ?? 'Nao vinculado'}</td>
                  <td className="px-4 py-3">
                    {item.voyage?.vessel?.name ?? '-'} / {item.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openItem(index)}>
                        Corrigir
                      </Button>
                      <Link className="app-table__action" to={`/manifestos/${item.id}`}>
                        Abrir B/L
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ReviewModal
        item={selected}
        currentIndex={selectedIndex}
        totalItems={filteredData.length}
        onClose={handleClose}
        onSaveSuccess={handleSaveSuccess}
        onNavigate={(index) => setSelectedIndex(index)}
      />
    </>
  )
}

function ReviewModal({
  item,
  currentIndex,
  totalItems,
  onClose,
  onSaveSuccess,
  onNavigate,
}: {
  item: ReviewQueueItem | null
  currentIndex: number | null
  totalItems: number
  onClose: () => void
  onSaveSuccess: () => void
  onNavigate: (index: number) => void
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [shipper, setShipper] = useState('')
  const [consignee, setConsignee] = useState('')
  const [pol, setPol] = useState('')
  const [pod, setPod] = useState('')
  const [totalWeightKg, setTotalWeightKg] = useState('')
  const [totalCbm, setTotalCbm] = useState('')
  const [notes, setNotes] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerCnpj, setNewCustomerCnpj] = useState('')
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const customerLookup = useCustomerLookup(customerSearch)

  useEffect(() => {
    if (!item) return
    setShipper(item.shipper ?? '')
    setConsignee(item.consignee ?? '')
    setPol(item.pol ?? '')
    setPod(item.pod ?? '')
    setTotalWeightKg(item.total_weight_kg ? String(item.total_weight_kg) : '')
    setTotalCbm(item.total_cbm ? String(item.total_cbm) : '')
    setNotes(item.notes ?? '')
    setSelectedCustomerId(item.customer_id ?? null)
    setCustomerSearch('')
    setNewCustomerName(item.consignee ?? '')
    setNewCustomerCnpj('')
    setJustification('')
  }, [item])

  async function handleCreateCustomer() {
    if (!newCustomerName.trim() || !newCustomerCnpj.trim()) {
      showToast('Informe nome e CNPJ/CPF para criar o cliente.', 'error')
      return
    }

    try {
      const customer = await createCustomer({ cnpjCpf: newCustomerCnpj, name: newCustomerName })
      setSelectedCustomerId(customer.id)
      setCustomerSearch(`${customer.name} ${formatCnpjCpf(customer.cnpj_cpf)}`)
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      showToast('Cliente criado e pronto para vinculacao.', 'success')
    } catch {
      showToast('Falha ao criar cliente.', 'error')
    }
  }

  async function handleSave() {
    if (!item || !user) return
    if (!justification.trim()) {
      showToast('Informe a justificativa da revisao.', 'error')
      return
    }

    setSaving(true)
    try {
      await saveBlReview({
        blId: item.id,
        original: {
          shipper: item.shipper,
          consignee: item.consignee,
          pol: item.pol,
          pod: item.pod,
          total_weight_kg: item.total_weight_kg,
          total_cbm: item.total_cbm,
          notes: item.notes,
        },
        values: {
          shipper,
          consignee,
          pol,
          pod,
          total_weight_kg: totalWeightKg === '' ? null : Number(totalWeightKg),
          total_cbm: totalCbm === '' ? null : Number(totalCbm),
          notes,
        },
        customerId: selectedCustomerId,
        previousCustomerId: item.customer_id ?? null,
        changedBy: user.id,
        justification,
        expectedUpdatedAt: item.updated_at ?? null,
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', item.id] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs', 'bl', item.id] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['op-count'] }),
      ])

      const remaining = totalItems - 1
      const isLast = currentIndex !== null && currentIndex >= totalItems - 1
      showToast(
        isLast
          ? 'B/L revisado. Fila concluida.'
          : `B/L revisado. Proximo: ${remaining - 1} restante${remaining - 1 !== 1 ? 's' : ''}.`,
        'success',
      )
      onSaveSuccess()
    } catch (error) {
      if (error instanceof ConcurrentEditError) {
        void logOperationalEvent({
          code: 'bl_review_concurrent_conflict',
          message: error.message,
          changedBy: user?.id ?? null,
          entityId: item.id,
          context: { source: 'review_modal' },
        })
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        showToast('Este B/L foi alterado por outro usuario. A fila foi recarregada.', 'error')
        return
      }
      showToast('Falha ao salvar a revisao do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canGoPrev = currentIndex !== null && currentIndex > 0
  const canGoNext = currentIndex !== null && currentIndex < totalItems - 1

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item ? `Revisar B/L ${item.id}` : 'Revisar B/L'}>
      {item ? (
        <div className="grid gap-5">
          {totalItems > 1 && currentIndex !== null ? (
            <div className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => canGoPrev && onNavigate(currentIndex - 1)}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                <ChevronLeft size={15} />
                Anterior
              </button>
              <span className="text-xs text-slate-500">
                {currentIndex + 1} de {totalItems}
              </span>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => canGoNext && onNavigate(currentIndex + 1)}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                Proximo
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}

          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} />
              Pendencias detectadas
            </div>
            <div className="flex flex-wrap gap-2">
              {(item.review_reasons?.length ? item.review_reasons : ['Pendente de revisao']).map((reason) => (
                <Badge key={reason} tone="yellow">
                  {reason}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Shipper">
              <Input value={shipper} onChange={(event) => setShipper(event.target.value)} />
            </Field>
            <Field label="Consignatario">
              <Input value={consignee} onChange={(event) => setConsignee(event.target.value)} />
            </Field>
            <Field label="POL">
              <Input value={pol} onChange={(event) => setPol(event.target.value)} />
            </Field>
            <Field label="POD">
              <Input value={pod} onChange={(event) => setPod(event.target.value)} />
            </Field>
            <Field label="Peso total (kg)">
              <Input type="number" value={totalWeightKg} onChange={(event) => setTotalWeightKg(event.target.value)} />
            </Field>
            <Field label="CBM total">
              <Input type="number" value={totalCbm} onChange={(event) => setTotalCbm(event.target.value)} />
            </Field>
          </div>

          <Field label="Notas da revisao">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          <Card className="grid gap-4 bg-[#0d1117]">
            <div className="font-semibold text-white">Vinculacao de cliente</div>
            <Field label="Buscar cliente por nome ou CNPJ">
              <div className="relative">
                <Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Digite ao menos 2 caracteres" />
                <Search className="pointer-events-none absolute right-3 top-2.5 text-slate-500" size={16} />
              </div>
            </Field>
            {customerLookup.data?.length ? (
              <div className="grid gap-2">
                {customerLookup.data.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selectedCustomerId === customer.id
                        ? 'border-[#1f6feb] bg-[#1f6feb]/15 text-white'
                        : 'border-[#30363d] bg-[#161b22] text-slate-300 hover:bg-[#21262d]'
                    }`}
                    onClick={() => setSelectedCustomerId(customer.id)}
                  >
                    <div className="font-semibold">{customer.name}</div>
                    <div className="text-xs text-slate-400">{formatCnpjCpf(customer.cnpj_cpf)}</div>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
              <Field label="Novo cliente - nome">
                <Input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} />
              </Field>
              <Field label="Novo cliente - CNPJ/CPF">
                <Input value={newCustomerCnpj} onChange={(event) => setNewCustomerCnpj(event.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={handleCreateCustomer}>
                  Cadastrar cliente
                </Button>
              </div>
            </div>
          </Card>

          <Field label="Justificativa obrigatoria">
            <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Marcar como revisado
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
