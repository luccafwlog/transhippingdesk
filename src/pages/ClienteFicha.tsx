import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useCustomerDetail } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'
import { deleteCustomerContact, updateCustomerWithAudit, upsertCustomerContact } from '../services/customers'
import type { CustomerContact } from '../types/database'

type CustomerForm = {
  name: string
  trade_name: string
  address: string
  city: string
  state: string
  zip: string
  notes: string
}

type ContactForm = {
  id?: number
  name: string
  email: string
  phone: string
  purpose: NonNullable<CustomerContact['purpose']>
  is_primary: boolean
}

const emptyContact: ContactForm = {
  name: '',
  email: '',
  phone: '',
  purpose: 'geral',
  is_primary: false,
}

export function ClienteFicha() {
  const { cnpj } = useParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data, isLoading, error } = useCustomerDetail(cnpj)
  const [form, setForm] = useState<CustomerForm | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContact)
  const [contactSaving, setContactSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm({
      name: data.name,
      trade_name: data.trade_name ?? '',
      address: data.address ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
      zip: data.zip ?? '',
      notes: data.notes ?? '',
    })
  }, [data])

  async function handleSaveCustomer() {
    if (!data || !form || !user) return
    if (!justification.trim()) {
      showToast('Informe a justificativa para salvar o cadastro.', 'error')
      return
    }

    setSaving(true)
    try {
      const changed = await updateCustomerWithAudit({
        customerId: data.id,
        original: {
          name: data.name,
          trade_name: data.trade_name,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          notes: data.notes,
        },
        values: {
          name: form.name,
          trade_name: form.trade_name || null,
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip: form.zip || null,
          notes: form.notes || null,
        },
        changedBy: user.id,
        justification,
      })

      if (!changed) {
        showToast('Nenhuma alteracao detectada.', 'info')
      } else {
        await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
        await queryClient.invalidateQueries({ queryKey: ['customers'] })
        showToast('Cadastro do cliente atualizado.', 'success')
      }

      setJustification('')
    } catch {
      showToast('Falha ao salvar o cadastro do cliente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveContact() {
    if (!data) return
    if (!contactForm.name.trim()) {
      showToast('Informe o nome do contato.', 'error')
      return
    }

    setContactSaving(true)
    try {
      await upsertCustomerContact(data.id, {
        id: contactForm.id ?? 0,
        name: contactForm.name,
        email: contactForm.email || null,
        phone: contactForm.phone || null,
        purpose: contactForm.purpose,
        is_primary: contactForm.is_primary,
      })

      await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
      setContactForm(emptyContact)
      showToast('Contato salvo com sucesso.', 'success')
    } catch {
      showToast('Falha ao salvar contato.', 'error')
    } finally {
      setContactSaving(false)
    }
  }

  async function handleDeleteContact(contactId: number) {
    try {
      await deleteCustomerContact(contactId)
      await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
      showToast('Contato removido.', 'success')
    } catch {
      showToast('Falha ao remover contato.', 'error')
    }
  }

  if (isLoading) {
    return <Card>Carregando ficha do cliente...</Card>
  }

  if (error || !data || !form) {
    return <Card className="text-red-200">Cliente nao encontrado ou erro ao consultar o Supabase.</Card>
  }

  return (
    <>
      <PageHeader
        title={data.name}
        description={`Ficha do cliente ${formatCnpjCpf(data.cnpj_cpf)} com contatos, B/Ls e invoices vinculadas.`}
        action={
          <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to="/clientes">
            <ArrowLeft className="mr-1 inline" size={16} />
            Voltar para clientes
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="CNPJ/CPF" value={formatCnpjCpf(data.cnpj_cpf)} />
        <MetricCard label="B/Ls vinculados" value={String(data.bls?.length ?? 0)} />
        <MetricCard label="Saldo pendente" value={formatBRL(data.pending_balance)} />
      </div>

      <Card className="mb-5 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Nome">
            <Input value={form.name} onChange={(event) => setForm((current) => (current ? { ...current, name: event.target.value } : current))} />
          </Field>
          <Field label="Nome fantasia">
            <Input value={form.trade_name} onChange={(event) => setForm((current) => (current ? { ...current, trade_name: event.target.value } : current))} />
          </Field>
          <Field label="CEP">
            <Input value={form.zip} onChange={(event) => setForm((current) => (current ? { ...current, zip: event.target.value } : current))} />
          </Field>
          <Field label="Cidade">
            <Input value={form.city} onChange={(event) => setForm((current) => (current ? { ...current, city: event.target.value } : current))} />
          </Field>
          <Field label="UF">
            <Input value={form.state} onChange={(event) => setForm((current) => (current ? { ...current, state: event.target.value.toUpperCase() } : current))} />
          </Field>
          <Field label="Endereco">
            <Input value={form.address} onChange={(event) => setForm((current) => (current ? { ...current, address: event.target.value } : current))} />
          </Field>
        </div>

        <Field label="Notas">
          <Textarea value={form.notes} onChange={(event) => setForm((current) => (current ? { ...current, notes: event.target.value } : current))} />
        </Field>
        <Field label="Justificativa">
          <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required />
        </Field>

        <div className="flex justify-end">
          <Button loading={saving} onClick={handleSaveCustomer}>
            Salvar cadastro
          </Button>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Contatos</h2>
            <Button variant="secondary" onClick={() => setContactForm(emptyContact)}>
              <Plus size={16} />
              Novo contato
            </Button>
          </div>

          <div className="grid gap-3">
            {data.customer_contacts?.length ? null : <div className="text-sm text-slate-400">Nenhum contato cadastrado.</div>}
            {data.customer_contacts?.map((contact) => (
              <div key={contact.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{contact.name ?? '-'}</div>
                    <div className="text-sm text-slate-400">
                      {contact.email ?? '-'} · {contact.phone ?? '-'}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">
                      {contact.purpose ?? 'geral'} {contact.is_primary ? '· principal' : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setContactForm({
                          id: contact.id,
                          name: contact.name ?? '',
                          email: contact.email ?? '',
                          phone: contact.phone ?? '',
                          purpose: contact.purpose ?? 'geral',
                          is_primary: Boolean(contact.is_primary),
                        })
                      }
                    >
                      Editar
                    </Button>
                    <Button variant="ghost" onClick={() => handleDeleteContact(contact.id)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 border-t border-[#30363d] pt-4">
            <Field label="Nome do contato">
              <Input value={contactForm.name} onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Email">
              <Input value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} />
            </Field>
            <Field label="Telefone">
              <Input value={contactForm.phone} onChange={(event) => setContactForm((current) => ({ ...current, phone: event.target.value }))} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Finalidade">
                <Select
                  value={contactForm.purpose}
                  onChange={(event) =>
                    setContactForm((current) => ({
                      ...current,
                      purpose: event.target.value as ContactForm['purpose'],
                    }))
                  }
                >
                  <option value="geral">Geral</option>
                  <option value="operacional">Operacional</option>
                  <option value="faturamento">Faturamento</option>
                  <option value="financeiro">Financeiro</option>
                </Select>
              </Field>
              <Field label="Principal">
                <Select
                  value={contactForm.is_primary ? 'sim' : 'nao'}
                  onChange={(event) => setContactForm((current) => ({ ...current, is_primary: event.target.value === 'sim' }))}
                >
                  <option value="nao">Nao</option>
                  <option value="sim">Sim</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button loading={contactSaving} onClick={handleSaveContact}>
                Salvar contato
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Historico de B/Ls</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">B/L</th>
                  <th className="py-2">Consignatario</th>
                  <th className="py-2">Revisao</th>
                  <th className="py-2">Financeiro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {data.bls?.length ? null : (
                  <tr>
                    <td colSpan={4} className="py-4 text-slate-400">
                      Nenhum B/L vinculado.
                    </td>
                  </tr>
                )}
                {data.bls?.map((bl) => (
                  <tr key={bl.id}>
                    <td className="py-2">
                      <Link className="text-[#58a6ff] hover:underline" to={`/manifestos/${bl.id}`}>
                        {bl.id}
                      </Link>
                    </td>
                    <td className="py-2">{bl.consignee ?? '-'}</td>
                    <td className="py-2">{bl.review_status ?? '-'}</td>
                    <td className="py-2">{bl.financial_status ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-4 mt-8 text-lg font-semibold text-white">Invoices</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Invoice</th>
                  <th className="py-2">Emissao</th>
                  <th className="py-2">Vencimento</th>
                  <th className="py-2">Total</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {data.invoices?.length ? null : (
                  <tr>
                    <td colSpan={5} className="py-4 text-slate-400">
                      Nenhuma invoice encontrada para este cliente.
                    </td>
                  </tr>
                )}
                {data.invoices?.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="py-2">{invoice.invoice_number ?? `INV-${invoice.id}`}</td>
                    <td className="py-2">{formatDate(invoice.issued_at)}</td>
                    <td className="py-2">{formatDate(invoice.due_date)}</td>
                    <td className="py-2">{formatBRL(invoice.total_brl)}</td>
                    <td className="py-2">{invoice.status ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </Card>
  )
}
