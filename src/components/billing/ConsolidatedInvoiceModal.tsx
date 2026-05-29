import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useBillingCustomers } from '../../hooks/useBilling'
import { useConsolidatableReceivables, useCreateConsolidatedInvoice } from '../../hooks/useBillingLedger'
import { isReceivableSelectable, listReceivableVoyageOptions, summarizeConsolidation } from './consolidatedInvoiceSelection'

function fmtBRL(v: number | null | undefined) {
  return 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = { open: boolean; onClose: () => void }

export function ConsolidatedInvoiceModal({ open, onClose }: Props) {
  const { showToast } = useToast()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [voyageId, setVoyageId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const { data: customerOptions } = useBillingCustomers(customerSearch)
  const { data: voyageReceivables } = useConsolidatableReceivables({
    customerId,
    voyageId: null,
    search: null,
  })
  const { data: receivables, isLoading } = useConsolidatableReceivables({
    customerId,
    voyageId,
    search: search.trim() || null,
  })
  const createMutation = useCreateConsolidatedInvoice()

  const rows = receivables ?? []
  const voyageOptions = listReceivableVoyageOptions(voyageReceivables ?? [])
  const summary = summarizeConsolidation(rows, selected)
  const selectedTotal = summary.total
  const eligibleCount = summary.eligibleCount

  const selectedCustomer = customerOptions?.find((c) => c.id === customerId)

  function reset() {
    setCustomerId(null)
    setCustomerSearch('')
    setVoyageId(null)
    setSearch('')
    setDueDate('')
    setNotes('')
    setSelected([])
    setError('')
  }

  function close() {
    reset()
    onClose()
  }

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit() {
    setError('')
    if (!customerId) {
      setError('Selecione um cliente.')
      return
    }
    if (selected.length === 0) {
      setError('Selecione ao menos um B/L com saldo aberto.')
      return
    }
    try {
      const result = await createMutation.mutateAsync({
        customerId,
        receivableIds: selected,
        dueDate: dueDate || null,
        notes: notes || null,
      })
      showToast(`Consolidada ${result.invoice_number} emitida (${fmtBRL(result.total_brl)}).`, 'success')
      close()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao emitir consolidada.'
      setError(message)
      showToast(message, 'error')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Nova Consolidada" className="invoice-create-dialog">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Customer picker (not wrapped in Field: dropdown buttons must not live inside a <label>) */}
        <div className="app-field">
          <span className="app-field__label">
            Cliente<span className="app-field__required" aria-hidden="true"> *</span>
          </span>
          <div style={{ position: 'relative' }}>
            <Input
              placeholder="Buscar cliente..."
              value={selectedCustomer ? selectedCustomer.name : customerSearch}
              onChange={(e) => {
                setCustomerId(null)
                setVoyageId(null)
                setSelected([])
                setCustomerSearch(e.target.value)
                setPickerOpen(true)
              }}
              onFocus={() => setPickerOpen(true)}
            />
            {pickerOpen && !customerId && (customerOptions?.length ?? 0) > 0 && (
              <div
                style={{
                  position: 'absolute',
                  zIndex: 20,
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'var(--app-surface)',
                  border: '1px solid var(--app-border)',
                  borderRadius: 8,
                  marginTop: 4,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}
              >
                {customerOptions!.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id)
                      setVoyageId(null)
                      setCustomerSearch('')
                      setPickerOpen(false)
                      setSelected([])
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{c.cnpj_cpf}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <Field label="Viagem">
          <Select
            value={voyageId == null ? '' : String(voyageId)}
            onChange={(e) => {
              setVoyageId(e.target.value ? Number(e.target.value) : null)
              setSelected([])
            }}
            disabled={!customerId || voyageOptions.length === 0}
          >
            <option value="">Todas as viagens</option>
            {voyageOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Buscar B/L">
          <Input
            placeholder="Filtrar por B/L..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!customerId}
          />
        </Field>

        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--app-border)', borderRadius: 8 }}>
          {!customerId ? (
            <EmptyState title="Selecione um cliente" description="Selecione um cliente para ver B/Ls com saldo aberto." />
          ) : isLoading ? (
            <EmptyState title="Carregando..." description="Buscando B/Ls com saldo aberto." />
          ) : rows.length === 0 ? (
            <EmptyState title="Sem B/Ls" description="Cliente não possui B/Ls abertos para consolidar." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--app-border)' }}>
                  <th style={{ padding: '8px' }}></th>
                  <th style={{ padding: '8px' }}>B/L</th>
                  <th style={{ padding: '8px' }}>Navio/Viagem</th>
                  <th style={{ padding: '8px' }}>Individual</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Saldo</th>
                  <th style={{ padding: '8px' }}>Elegibilidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const eligible = isReceivableSelectable(r)
                  return (
                    <tr
                      key={r.receivable_id}
                      style={{ borderBottom: '1px solid var(--app-border)', opacity: eligible ? 1 : 0.6 }}
                    >
                      <td style={{ padding: '8px' }}>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar B/L ${r.bl_id}`}
                          checked={selected.includes(r.receivable_id)}
                          disabled={!eligible}
                          onChange={() => toggle(r.receivable_id)}
                        />
                      </td>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{r.bl_id}</td>
                      <td style={{ padding: '8px' }}>
                        {[r.vessel_name, r.voyage_number].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td style={{ padding: '8px' }}>{r.individual_invoice_number ?? '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{fmtBRL(r.balance_brl)}</td>
                      <td style={{ padding: '8px' }}>
                        {eligible ? (
                          <Badge tone="green">Elegível</Badge>
                        ) : (
                          <span style={{ fontSize: 12, opacity: 0.8 }}>{r.eligibility_reason}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Vencimento">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Observações">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>

        {error && <div style={{ color: 'var(--app-danger, #dc2626)', fontSize: 13 }}>{error}</div>}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--app-border)',
            paddingTop: 12,
          }}
        >
          <div style={{ fontSize: 13 }}>
            {selected.length} de {eligibleCount} elegíveis · <strong>{fmtBRL(selectedTotal)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={createMutation.isPending}
              disabled={selected.length === 0}
            >
              Emitir consolidada
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
