import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useOverrideCustomers } from '../../hooks/useLocalCharges'
import { formatBRL } from '../../lib/utils'
import { createCustomer } from '../../services/customers'
import { supabase } from '../../services/supabase'
import { cargoModeLabel, type CargoMode } from '../../pages/blDetalheHelpers'
import type { BLDetail } from '../../types/database'

// Aba Financeiro: vinculação de cliente, informações financeiras e overrides de demurrage.
export function BlFinanceiroTab({
  active,
  bl,
  cargoMode,
  isContainerMode,
  cargoQuantity,
}: {
  active: boolean
  bl: BLDetail
  cargoMode: CargoMode
  isContainerMode: boolean
  cargoQuantity: number
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [creatingManifestCustomer, setCreatingManifestCustomer] = useState(false)
  const [demurrageOverrideForm, setDemurrageOverrideForm] = useState({ p1: '', p2: '' })
  const [savingDemurrageOverride, setSavingDemurrageOverride] = useState(false)
  const { data: customerOptions } = useOverrideCustomers(customerSearch)

  // Re-baseia o formulário quando o B/L (re)carrega — ajuste durante o render
  // em vez de useEffect (padrão "adjusting state when props change" do React).
  const [prevBl, setPrevBl] = useState<BLDetail | null>(null)
  if (bl !== prevBl) {
    setPrevBl(bl)
    setDemurrageOverrideForm({
      p1: bl.demurrage_rate_override_p1_usd != null ? String(Number(bl.demurrage_rate_override_p1_usd)) : '',
      p2: bl.demurrage_rate_override_p2_usd != null ? String(Number(bl.demurrage_rate_override_p2_usd)) : '',
    })
  }

  async function handleLinkCustomer(customerId: number | null) {
    if (!bl || !user) return
    setSavingCustomer(true)
    try {
      const { error: rpcError } = await supabase.rpc('save_bl_review', {
        p_bl_id: bl.id,
        p_expected_updated_at: bl.updated_at ?? null,
        p_update_payload: { customer_id: customerId != null ? String(customerId) : '' },
        p_audit_rows: [
          {
            entity_type: 'bl',
            entity_id: bl.id,
            field_name: 'customer_id',
            old_value: bl.customer_id != null ? String(bl.customer_id) : null,
            new_value: customerId != null ? String(customerId) : null,
            justification: customerId != null ? 'Vinculacao manual de cliente na ficha do B/L.' : 'Desvinculacao manual de cliente na ficha do B/L.',
          },
        ],
        p_changed_by: user.id,
      })
      if (rpcError) throw rpcError
      await queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] })
      showToast(customerId != null ? 'Cliente vinculado com sucesso.' : 'Cliente desvinculado.', 'success')
      setCustomerSearch('')
      setSelectedCustomerId(null)
    } catch {
      showToast('Falha ao vincular cliente.', 'error')
    } finally {
      setSavingCustomer(false)
    }
  }

  async function handleCreateManifestCustomer() {
    if (!bl) return
    const name = bl.manifest_customer_name?.trim()
    const cnpj = bl.manifest_customer_cnpj_cpf?.trim()
    if (!name || !cnpj) return
    setCreatingManifestCustomer(true)
    try {
      const contacts = bl.manifest_customer_email?.trim()
        ? [{ name: 'Contato manifesto', email: bl.manifest_customer_email.trim(), purpose: 'financeiro' as const, is_primary: true }]
        : []
      const customer = await createCustomer({ cnpjCpf: cnpj, name, contacts })
      await handleLinkCustomer(customer.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
      if (msg.includes('duplicate key') || msg.includes('customers_cnpj_cpf_key')) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('cnpj_cpf', cnpj.replace(/\D/g, ''))
          .maybeSingle()
        if (existing) {
          await handleLinkCustomer(existing.id)
          return
        }
      }
      showToast('Falha ao cadastrar cliente do manifesto.', 'error')
    } finally {
      setCreatingManifestCustomer(false)
    }
  }

  async function handleSaveDemurrageOverrides() {
    if (!bl) return
    const p1 = demurrageOverrideForm.p1.trim() ? Number(demurrageOverrideForm.p1.replace(',', '.')) : null
    const p2 = demurrageOverrideForm.p2.trim() ? Number(demurrageOverrideForm.p2.replace(',', '.')) : null
    if ((p1 != null && !Number.isFinite(p1)) || (p2 != null && !Number.isFinite(p2))) {
      showToast('Valores invalidos para override de demurrage.', 'error')
      return
    }
    setSavingDemurrageOverride(true)
    try {
      const { error } = await supabase
        .from('bls')
        .update({ demurrage_rate_override_p1_usd: p1, demurrage_rate_override_p2_usd: p2 })
        .eq('id', bl.id)
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] })
      showToast('Overrides de demurrage salvos.', 'success')
    } catch {
      showToast('Falha ao salvar overrides de demurrage.', 'error')
    } finally {
      setSavingDemurrageOverride(false)
    }
  }

  if (!active) return null

  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Cliente</h2>
        <dl className="mb-4 grid gap-3 text-sm">
          <InfoLine label="Cliente vinculado" value={bl.customer?.name ?? 'Não vinculado'} />
          <InfoLine label="CNPJ/CPF" value={bl.customer?.cnpj_cpf ?? '-'} />
          <InfoLine label="Saldo pendente" value={formatBRL(bl.customer?.pending_balance ?? 0)} />
        </dl>

        {(bl.manifest_customer_name ?? bl.manifest_customer_cnpj_cpf) ? (
          <div className="mb-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Dados do manifesto</div>
            <dl className="mb-3 grid gap-2 text-sm">
              <InfoLine label="Nome" value={bl.manifest_customer_name ?? '-'} />
              <InfoLine label="CNPJ/CPF" value={bl.manifest_customer_cnpj_cpf ?? '-'} />
              <InfoLine label="Email" value={bl.manifest_customer_email ?? '-'} />
            </dl>
            {!bl.customer_id && bl.manifest_customer_name && bl.manifest_customer_cnpj_cpf ? (
              <Button
                type="button"
                variant="secondary"
                loading={creatingManifestCustomer}
                onClick={handleCreateManifestCustomer}
              >
                Cadastrar e vincular cliente do manifesto
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Conciliação:</span>
          {bl.customer_reconciliation_status === 'reconciled' ? <Badge tone="green">Reconciliado</Badge>
            : bl.customer_reconciliation_status === 'matched_document' ? <Badge tone="blue">Match CNPJ</Badge>
            : bl.customer_reconciliation_status === 'matched_name' ? <Badge tone="yellow">Match nome</Badge>
            : bl.customer_reconciliation_status === 'rejected' ? <Badge tone="red">Rejeitado</Badge>
            : <Badge tone="yellow">Pendente</Badge>}
          {bl.customer_reconciliation_notes ? (
            <span className="text-xs text-slate-400">{bl.customer_reconciliation_notes}</span>
          ) : null}
        </div>

        <div className="border-t border-[#30363d] pt-4">
          <div className="mb-3 text-sm font-semibold text-white">Vincular cliente</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Buscar">
              <Input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Razao social ou CNPJ"
              />
            </Field>
            <Field label="Selecionar">
              <Select
                value={selectedCustomerId != null ? String(selectedCustomerId) : ''}
                onChange={(event) => setSelectedCustomerId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Selecione</option>
                {(customerOptions ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.cnpj_cpf ? ` — ${c.cnpj_cpf}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              onClick={() => handleLinkCustomer(selectedCustomerId)}
              loading={savingCustomer}
              disabled={selectedCustomerId == null || savingCustomer}
            >
              <Save size={15} />
              Vincular
            </Button>
            {bl.customer_id ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => handleLinkCustomer(null)}
                loading={savingCustomer}
                disabled={savingCustomer}
              >
                <X size={15} />
                Desvincular
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Informações financeiras</h2>
        <dl className="grid gap-3 text-sm">
          <InfoLine label="Modo de carga" value={cargoModeLabel(cargoMode)} />
          <InfoLine label="CE Mercante" value={bl.ce_mercante ?? '-'} />
          <InfoLine label="Trecho" value={`${bl.pol ?? '-'} → ${bl.pod ?? '-'}`} />
          <InfoLine
            label={isContainerMode ? 'Containers distintos' : 'Packages total'}
            value={String(cargoQuantity)}
          />
        </dl>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Overrides de demurrage</h2>
        <p className="mb-4 text-sm text-slate-400">
          Deixe em branco para usar a tabela de taxas padrao. Free time ja esta disponivel na aba Operacional.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Taxa P1 override (USD/dia)">
            <Input
              value={demurrageOverrideForm.p1}
              onChange={(event) => setDemurrageOverrideForm((f) => ({ ...f, p1: event.target.value }))}
              placeholder={bl.demurrage_rate_override_p1_usd != null ? String(Number(bl.demurrage_rate_override_p1_usd)) : 'Padrao da tabela'}
            />
          </Field>
          <Field label="Taxa P2 override (USD/dia)">
            <Input
              value={demurrageOverrideForm.p2}
              onChange={(event) => setDemurrageOverrideForm((f) => ({ ...f, p2: event.target.value }))}
              placeholder={bl.demurrage_rate_override_p2_usd != null ? String(Number(bl.demurrage_rate_override_p2_usd)) : 'Padrao da tabela'}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={handleSaveDemurrageOverrides} loading={savingDemurrageOverride}>
            <Save size={15} />
            Salvar overrides
          </Button>
        </div>
      </Card>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-100">{value}</dd>
    </div>
  )
}
