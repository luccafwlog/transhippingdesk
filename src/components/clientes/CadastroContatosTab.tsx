import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerDetail } from '../../hooks/useCustomers'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { PortalReviewPanel } from '../portal/PortalReviewPanel'
import { accountSituationLabel, provisioningDecisionLabel, recoveryEmailSourceLabel, deliveryStatusLabel } from '../../lib/portalProvisioningViewModel'
import { formatDate } from '../../lib/utils'
import { deleteCustomerContact, updateCustomerWithAudit, upsertCustomerContact } from '../../services/customers'
import { queryKeys } from '../../services/queryKeys'
import type { CustomerContact } from '../../types/database'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type CustomerForm = { name: string; trade_name: string; address: string; city: string; state: string; zip: string; notes: string }
type ContactForm = { id?: number; name: string; email: string; phone: string; purpose: NonNullable<CustomerContact['purpose']>; is_primary: boolean }
const emptyContact: ContactForm = { name: '', email: '', phone: '', purpose: 'geral', is_primary: false }

export function CadastroContatosTab({ data, cnpj }: { data: Data; cnpj: string }) {
  const queryClient = useQueryClient(); const { user, profile } = useAuth(); const canEdit = Boolean(profile || user)
  const { showToast } = useToast(); const confirm = useConfirm(); const { data: portalRow } = usePortalProvisioningForCustomer(data.id)
  const [portalOpen, setPortalOpen] = useState(false); const [saving, setSaving] = useState(false); const [justification, setJustification] = useState('')
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContact); const [contactSaving, setContactSaving] = useState(false)
  const [form, setForm] = useState<CustomerForm>({ name: data.name, trade_name: data.trade_name ?? '', address: data.address ?? '', city: data.city ?? '', state: data.state ?? '', zip: data.zip ?? '', notes: data.notes ?? '' })
  const [prevFormData, setPrevFormData] = useState<Data | null>(null)
  if (data !== prevFormData) {
    setPrevFormData(data)
    setForm({ name: data.name, trade_name: data.trade_name ?? '', address: data.address ?? '', city: data.city ?? '', state: data.state ?? '', zip: data.zip ?? '', notes: data.notes ?? '' })
  }

  async function saveCustomer() {
    if (!user || !canEdit) { showToast('Edição de clientes restrita ao perfil autorizado.', 'error'); return }
    if (!justification.trim()) { showToast('Informe a justificativa para salvar o cadastro.', 'error'); return }
    setSaving(true)
    try {
      const changed = await updateCustomerWithAudit({ customerId: data.id, original: { name: data.name, trade_name: data.trade_name, address: data.address, city: data.city, state: data.state, zip: data.zip, notes: data.notes }, values: { name: form.name, trade_name: form.trade_name || null, address: form.address || null, city: form.city || null, state: form.state || null, zip: form.zip || null, notes: form.notes || null }, changedBy: user.id, justification })
      await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] }); await queryClient.invalidateQueries({ queryKey: ['customers'] }); setJustification('')
      showToast(changed ? 'Cadastro do cliente atualizado.' : 'Nenhuma alteração detectada.', changed ? 'success' : 'info')
    } catch { showToast('Falha ao salvar o cadastro do cliente.', 'error') } finally { setSaving(false) }
  }
  async function saveContact() {
    if (!canEdit) { showToast('Edição de clientes restrita ao perfil autorizado.', 'error'); return }
    if (!contactForm.name.trim()) { showToast('Informe o nome do contato.', 'error'); return }
    setContactSaving(true)
    try { await upsertCustomerContact(data.id, { id: contactForm.id ?? 0, name: contactForm.name, email: contactForm.email || null, phone: contactForm.phone || null, purpose: contactForm.purpose, is_primary: contactForm.is_primary }); await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] }); await queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.timeline(data.id) }); setContactForm(emptyContact); showToast('Contato salvo com sucesso.', 'success') } catch { showToast('Falha ao salvar contato.', 'error') } finally { setContactSaving(false) }
  }
  async function deleteContact(id: number) {
    if (!canEdit || !(await confirm({ title: 'Remover contato', message: 'Remover este contato do cadastro do cliente?', confirmLabel: 'Remover', tone: 'danger' }))) return
    try { await deleteCustomerContact(id); await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] }); await queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.timeline(data.id) }); showToast('Contato removido.', 'success') } catch { showToast('Falha ao remover contato.', 'error') }
  }

  return <div className="grid gap-5">
    <Card className="grid gap-4"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(['name', 'trade_name', 'zip', 'city', 'state', 'address'] as const).map((key) => <Field key={key} label={{ name: 'Nome', trade_name: 'Nome fantasia', zip: 'CEP', city: 'Cidade', state: 'UF', address: 'Endereço' }[key]}><Input value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: key === 'state' ? event.target.value.toUpperCase() : event.target.value }))} /></Field>)}
    </div><Field label="Notas"><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field><Field label="Justificativa"><Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required /></Field><div className="flex justify-end"><Button loading={saving} onClick={saveCustomer} disabled={!canEdit}>Salvar cadastro</Button></div></Card>
  <Card><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-white">Portal do cliente</h2>{portalRow ? <Button variant="secondary" onClick={() => setPortalOpen((value) => !value)}>{portalOpen ? 'Fechar gestão' : 'Gerenciar Portal'}</Button> : null}</div><p className="mt-1 text-sm text-slate-400">Convites, ativação e suspensão são administrados na fila de provisionamento do Portal.</p>{portalRow ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><div className="text-xs text-slate-500">Email de Recuperação</div><div>{portalRow.recovery_email ?? 'Não informado'}</div>{portalRow.recovery_email_source ? <div className="text-xs text-slate-500">{recoveryEmailSourceLabel(portalRow.recovery_email_source)}</div> : null}</div><div><div className="text-xs text-slate-500">Situação</div><div>{accountSituationLabel(portalRow.account_situation)}</div></div><div><div className="text-xs text-slate-500">Decisão</div><div>{provisioningDecisionLabel(portalRow.provisioning_decision)}</div></div><div><div className="text-xs text-slate-500">Entrega</div><div>{deliveryStatusLabel(portalRow.latestDeliveryStatus)}</div></div><div><div className="text-xs text-slate-500">Último evento</div><div>{portalRow.lastActivityAt ? formatDate(portalRow.lastActivityAt) : 'Não informado'}</div></div><div><div className="text-xs text-slate-500">Alerta crítico</div><div>{portalRow.hasCriticalAlert ? 'Sim' : 'Não'}</div></div><div><div className="text-xs text-slate-500">Email compartilhado</div><div>{portalRow.sharedEmailCount > 0 ? 'Sim' : 'Não'}</div></div></div> : null}{portalOpen && portalRow ? <div className="mt-4 border-t border-[#30363d] pt-4"><PortalReviewPanel row={portalRow} variant="embedded" onSaved={() => void queryClient.invalidateQueries({ queryKey: ['portal-provisioning', 'customer', data.id] })} /></div> : null}<Link to={`/clientes/portal?cliente=${data.id}`} className="mt-4 block text-sm font-medium text-cyan-300">Abrir fila de provisionamento →</Link></Card>
    <Card><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-white">Contatos</h2><Button variant="secondary" onClick={() => setContactForm(emptyContact)} disabled={!canEdit}><Plus size={16} />Novo contato</Button></div><div className="grid gap-3">{data.customer_contacts?.length ? null : <div className="text-sm text-slate-400">Nenhum contato cadastrado.</div>}{data.customer_contacts?.map((contact) => <div key={contact.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-white">{contact.name ?? '-'}</div><div className="text-sm text-slate-400">{contact.email ?? '-'} · {contact.phone ?? '-'}</div><div className="text-xs uppercase text-slate-500">{contact.purpose ?? 'geral'} {contact.is_primary ? '· principal' : ''}</div></div><div className="flex gap-2"><Button variant="secondary" disabled={!canEdit} onClick={() => setContactForm({ id: contact.id, name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '', purpose: contact.purpose ?? 'geral', is_primary: Boolean(contact.is_primary) })}>Editar</Button><Button variant="ghost" aria-label="Remover contato" onClick={() => deleteContact(contact.id)} disabled={!canEdit}><Trash2 size={16} /></Button></div></div></div>)}</div><div className="mt-4 grid gap-3 border-t border-[#30363d] pt-4"><Field label="Nome do contato"><Input value={contactForm.name} onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Email"><Input value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} /></Field><Field label="Telefone"><Input value={contactForm.phone} onChange={(event) => setContactForm((current) => ({ ...current, phone: event.target.value }))} /></Field><div className="grid gap-3 md:grid-cols-2"><Field label="Finalidade"><Select value={contactForm.purpose} onChange={(event) => setContactForm((current) => ({ ...current, purpose: event.target.value as ContactForm['purpose'] }))}><option value="geral">Geral</option><option value="operacional">Operacional</option><option value="faturamento">Faturamento</option><option value="financeiro">Financeiro</option></Select></Field><Field label="Principal"><Select value={contactForm.is_primary ? 'sim' : 'nao'} onChange={(event) => setContactForm((current) => ({ ...current, is_primary: event.target.value === 'sim' }))}><option value="nao">Não</option><option value="sim">Sim</option></Select></Field></div><div className="flex justify-end"><Button loading={contactSaving} onClick={saveContact} disabled={!canEdit}>Salvar contato</Button></div></div></Card>
  </div>
}
