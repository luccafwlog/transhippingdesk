import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useCustomerDetail } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'
import {
  deleteCustomerContact,
  getCustomerPortalAccount,
  setCustomerPortalAccountActive,
  updateCustomerWithAudit,
  upsertCustomerContact,
  upsertCustomerPortalAccount,
} from '../services/customers'
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

type CommercialForm = {
  payment_terms_days: string
  discount_pct: string
  commercial_notes: string
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
  const { user, isAdmin } = useAuth()
  const { showToast } = useToast()
  const { data, isLoading, error } = useCustomerDetail(cnpj)
  const [form, setForm] = useState<CustomerForm | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [commercialForm, setCommercialForm] = useState<CommercialForm | null>(null)
  const [commercialJustification, setCommercialJustification] = useState('')
  const [commercialSaving, setCommercialSaving] = useState(false)
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContact)
  const [contactSaving, setContactSaving] = useState(false)
  const [portalEmail, setPortalEmail] = useState('')
  const [portalPassword, setPortalPassword] = useState('')
  const [portalActive, setPortalActive] = useState(true)

  const portalAccountQuery = useQuery({
    queryKey: ['customer-portal-account', data?.id],
    enabled: Boolean(data?.id),
    queryFn: () => getCustomerPortalAccount(data!.id),
  })

  const savePortalMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('Cliente nao carregado.')
      return upsertCustomerPortalAccount({
        customerId: data.id,
        password: portalPassword,
        contactEmail: portalEmail || null,
        active: portalActive,
        actorId: user?.id ?? null,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customer-portal-account', data?.id] })
    },
  })

  const togglePortalActiveMutation = useMutation({
    mutationFn: async (active: boolean) => {
      if (!data) throw new Error('Cliente nao carregado.')
      return setCustomerPortalAccountActive({
        customerId: data.id,
        active,
        actorId: user?.id ?? null,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customer-portal-account', data?.id] })
    },
  })

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
    setCommercialForm({
      payment_terms_days: data.payment_terms_days != null ? String(data.payment_terms_days) : '30',
      discount_pct: data.discount_pct != null ? String(data.discount_pct) : '0',
      commercial_notes: data.commercial_notes ?? '',
    })
  }, [data])

  useEffect(() => {
    if (!data) return

    const primaryContact =
      data.customer_contacts?.find((contact) => contact.purpose === 'faturamento' && contact.email) ??
      data.customer_contacts?.find((contact) => contact.is_primary && contact.email) ??
      data.customer_contacts?.find((contact) => contact.email)

    setPortalEmail(portalAccountQuery.data?.contact_email ?? primaryContact?.email ?? '')
    setPortalActive(portalAccountQuery.data?.active ?? true)
  }, [data, portalAccountQuery.data])

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
          payment_terms_days: data.payment_terms_days,
          discount_pct: data.discount_pct,
          commercial_notes: data.commercial_notes,
        },
        values: {
          name: form.name,
          trade_name: form.trade_name || null,
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip: form.zip || null,
          notes: form.notes || null,
          payment_terms_days: data.payment_terms_days,
          discount_pct: data.discount_pct,
          commercial_notes: data.commercial_notes,
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

  async function handleSaveCommercial() {
    if (!data || !commercialForm || !user) return
    if (!commercialJustification.trim()) {
      showToast('Informe a justificativa para salvar as regras comerciais.', 'error')
      return
    }

    const paymentTermsDays = Number(commercialForm.payment_terms_days)
    const discountPct = Number(String(commercialForm.discount_pct).replace(',', '.'))

    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays <= 0 || paymentTermsDays > 365) {
      showToast('Prazo de pagamento deve ser um numero inteiro entre 1 e 365 dias.', 'error')
      return
    }
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct >= 100) {
      showToast('Desconto deve ser um percentual entre 0 e 99.99.', 'error')
      return
    }

    setCommercialSaving(true)
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
          payment_terms_days: data.payment_terms_days,
          discount_pct: data.discount_pct,
          commercial_notes: data.commercial_notes,
        },
        values: {
          name: data.name,
          trade_name: data.trade_name,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          notes: data.notes,
          payment_terms_days: paymentTermsDays,
          discount_pct: discountPct,
          commercial_notes: commercialForm.commercial_notes || null,
        },
        changedBy: user.id,
        justification: commercialJustification,
      })

      if (!changed) {
        showToast('Nenhuma alteracao detectada.', 'info')
      } else {
        await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
        await queryClient.invalidateQueries({ queryKey: ['customers'] })
        showToast('Regras comerciais atualizadas.', 'success')
      }

      setCommercialJustification('')
    } catch {
      showToast('Falha ao salvar as regras comerciais.', 'error')
    } finally {
      setCommercialSaving(false)
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

  async function handleSavePortalAccount() {
    if (!data || !user) return
    if (!isAdmin) {
      showToast('Provisionamento do portal restrito ao perfil admin.', 'error')
      return
    }
    if (portalPassword.trim().length < 8) {
      showToast('Informe uma senha com no minimo 8 caracteres.', 'error')
      return
    }

    try {
      await savePortalMutation.mutateAsync()
      setPortalPassword('')
      showToast('Acesso do portal atualizado.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao provisionar acesso do portal.', 'error')
    }
  }

  async function handleTogglePortalActive() {
    if (!data || !user) return
    if (!isAdmin) {
      showToast('Provisionamento do portal restrito ao perfil admin.', 'error')
      return
    }

    const nextActive = !(portalAccountQuery.data?.active ?? portalActive)
    try {
      await togglePortalActiveMutation.mutateAsync(nextActive)
      setPortalActive(nextActive)
      showToast(nextActive ? 'Acesso do portal ativado.' : 'Acesso do portal desativado.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao atualizar status do portal.', 'error')
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

      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Portal do cliente</h2>
            <p className="mt-1 text-sm text-slate-400">
              Provisiona login externo por CNPJ + senha para consulta e consolidacao de invoices.
            </p>
          </div>
          <div className="text-sm text-slate-400">
            {portalAccountQuery.data ? `Ultimo login: ${formatDate(portalAccountQuery.data.last_login_at)}` : 'Sem acesso provisionado'}
          </div>
        </div>

        {!isAdmin ? (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
            Somente admin pode criar ou alterar o acesso do portal.
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Email de contato">
            <Input value={portalEmail} onChange={(event) => setPortalEmail(event.target.value)} placeholder="financeiro@cliente.com" />
          </Field>
          <Field label="Senha do portal">
            <Input
              type="password"
              value={portalPassword}
              onChange={(event) => setPortalPassword(event.target.value)}
              placeholder={portalAccountQuery.data ? 'Nova senha para reset' : 'Minimo 8 caracteres'}
            />
          </Field>
          <Field label="Status">
            <Select value={portalActive ? 'active' : 'inactive'} onChange={(event) => setPortalActive(event.target.value === 'active')}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>
          </Field>
          <div className="grid gap-1 rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">Conta portal</div>
            <div className="text-2xl font-bold text-white">{portalAccountQuery.data ? 'Provisionada' : 'Pendente'}</div>
            <div className="text-xs text-slate-400">{portalAccountQuery.data?.contact_email ?? 'Sem email definido'}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={handleTogglePortalActive}
            loading={togglePortalActiveMutation.isPending}
            disabled={!portalAccountQuery.data || !isAdmin}
          >
            {portalAccountQuery.data?.active ? 'Desativar portal' : 'Ativar portal'}
          </Button>
          <Button loading={savePortalMutation.isPending} onClick={handleSavePortalAccount} disabled={!isAdmin}>
            {portalAccountQuery.data ? 'Salvar e resetar senha' : 'Criar acesso portal'}
          </Button>
        </div>
      </Card>
      {commercialForm ? (
        <Card className="mb-5 grid gap-4">
          <h2 className="text-base font-semibold text-white">Regras Comerciais</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Prazo de pagamento (dias)">
              <Input
                type="number"
                min={1}
                max={365}
                value={commercialForm.payment_terms_days}
                onChange={(event) =>
                  setCommercialForm((current) => current ? { ...current, payment_terms_days: event.target.value } : current)
                }
              />
            </Field>
            <Field label="Desconto (%)">
              <Input
                type="number"
                min={0}
                max={99.99}
                step={0.01}
                value={commercialForm.discount_pct}
                onChange={(event) =>
                  setCommercialForm((current) => current ? { ...current, discount_pct: event.target.value } : current)
                }
              />
            </Field>
            <div className="flex items-end text-sm text-slate-400">
              {Number(commercialForm.discount_pct) > 0
                ? `Desconto de ${commercialForm.discount_pct}% aplicado nas invoices.`
                : 'Sem desconto aplicado.'}
            </div>
          </div>
          <Field label="Notas comerciais">
            <Textarea
              value={commercialForm.commercial_notes}
              onChange={(event) =>
                setCommercialForm((current) => current ? { ...current, commercial_notes: event.target.value } : current)
              }
              placeholder="Ex: Contrato vigente ate 2026-12-31. Desconto aplicavel apenas em B/Ls consolidados."
            />
          </Field>
          <Field label="Justificativa">
            <Textarea
              value={commercialJustification}
              onChange={(event) => setCommercialJustification(event.target.value)}
              required
            />
          </Field>
          <div className="flex justify-end">
            <Button loading={commercialSaving} onClick={handleSaveCommercial}>
              Salvar regras comerciais
            </Button>
          </div>
        </Card>
      ) : null}

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
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
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
                      <Link className="app-table__action" to={`/manifestos/${bl.id}`}>
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
          {data.invoices_access_denied ? (
            <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
              Visualizacao financeira restrita ao perfil admin.
            </div>
          ) : null}
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
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
                      {data.invoices_access_denied
                        ? 'Sem permissao para visualizar invoices deste cliente.'
                        : 'Nenhuma invoice encontrada para este cliente.'}
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

