import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useCustomerDetail } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'
import { FINANCIAL_STATUS_LABELS, INVOICE_STATUS_LABELS, REVIEW_STATUS_LABELS, statusLabel } from '../lib/statusLabels'
import {
  deleteCustomerContact,
  getCustomerPortalAccount,
  setCustomerPortalAccountActive,
  updateCustomerWithAudit,
  upsertCustomerContact,
  upsertCustomerPortalAccount,
  provisionPortalAuthUser,
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
  const confirm = useConfirm()
  const { data, isLoading, error } = useCustomerDetail(cnpj)
  const [form, setForm] = useState<CustomerForm | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContact)
  const [contactSaving, setContactSaving] = useState(false)
  const [portalEmail, setPortalEmail] = useState('')
  const [portalPassword, setPortalPassword] = useState('')
  const [portalActive, setPortalActive] = useState(true)
  const [portalCnpj, setPortalCnpj] = useState('')

  const portalAccountQuery = useQuery({
    queryKey: ['customer-portal-account', data?.id],
    enabled: Boolean(data?.id && isAdmin),
    retry: false,
    queryFn: () => getCustomerPortalAccount(data!.id),
  })

  const portalProvisioningError =
    portalAccountQuery.error instanceof Error ? portalAccountQuery.error.message : null

  const savePortalMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('Cliente não carregado.')
      const trimmedEmail = portalEmail.trim()
      if (!trimmedEmail) throw new Error('Informe o email de login do portal.')
      // 1) garante a linha da conta de portal (id + email de contato)
      const account = await upsertCustomerPortalAccount({
        customerId: data.id,
        password: portalPassword,
        contactEmail: trimmedEmail,
        active: false,
        actorId: user?.id ?? null,
        loginCnpj: portalCnpj || null,
      })
      // 2) cria/atualiza o usuário Supabase Auth (login email + senha)
      const authResult = await provisionPortalAuthUser({
        accountId: account.id,
        portalEmail: trimmedEmail,
        password: portalPassword,
      })
      if (!authResult.auth_user_id) {
        throw new Error('O provisionamento do portal nao confirmou o usuario Auth.')
      }
      // 3) so publica a conta depois que o vinculo Auth existe.
      return setCustomerPortalAccountActive({
        customerId: data.id,
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
      if (!data) throw new Error('Cliente não carregado.')
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

  // Re-baseia formulário e campos do portal quando os dados (re)carregam —
  // ajuste durante o render (padrão "adjusting state when props change").
  const [prevFormData, setPrevFormData] = useState<typeof data | null>(null)
  if (data && data !== prevFormData) {
    setPrevFormData(data)
    setForm({
      name: data.name,
      trade_name: data.trade_name ?? '',
      address: data.address ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
      zip: data.zip ?? '',
      notes: data.notes ?? '',
    })
  }

  const portalAccount = portalAccountQuery.data
  const [prevPortalSync, setPrevPortalSync] = useState<{ data: typeof data; portalAccount: typeof portalAccount } | null>(null)
  if (data && (data !== prevPortalSync?.data || portalAccount !== prevPortalSync?.portalAccount)) {
    setPrevPortalSync({ data, portalAccount })

    const primaryContact =
      data.customer_contacts?.find((contact) => contact.purpose === 'faturamento' && contact.email) ??
      data.customer_contacts?.find((contact) => contact.is_primary && contact.email) ??
      data.customer_contacts?.find((contact) => contact.email)

    setPortalEmail(portalAccount?.contact_email ?? primaryContact?.email ?? '')
    setPortalActive(portalAccount?.active ?? true)
    setPortalCnpj(portalAccount?.login_cnpj ?? data.cnpj_cpf ?? '')
  }

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
        showToast('Nenhuma alteração detectada.', 'info')
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
    const ok = await confirm({
      title: 'Remover contato',
      message: 'Remover este contato do cadastro do cliente?',
      confirmLabel: 'Remover',
      tone: 'danger',
    })
    if (!ok) return

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
    return (
      <>
        <Breadcrumb items={[{ label: 'Clientes', to: '/clientes' }, { label: 'Carregando...' }]} />
        <SkeletonCard lines={5} />
      </>
    )
  }

  if (error || !data || !form) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const notFound = !cnpj || code === 'PGRST116' || (!error && !data)
    return (
      <Card className="text-red-200">
        {notFound ? 'Cliente não encontrado.' : 'Falha ao consultar o cliente.'}
      </Card>
    )
  }

  return (
    <>
      <Breadcrumb
        items={[
          { label: 'Clientes', to: '/clientes' },
          { label: data.name },
        ]}
      />
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

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="CNPJ/CPF" value={formatCnpjCpf(data.cnpj_cpf)} />
        <MetricCard label="B/Ls vinculados" value={String(data.bls?.length ?? 0)} />
        <MetricCard label="Saldo pendente" value={data.invoices_access_denied ? 'Restrito' : formatBRL(data.pending_balance)} />
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
          <Field label="Endereço">
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
              Provisiona login externo por email + senha para consulta e consolidação de invoices.
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

        {portalProvisioningError ? (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-950/20 px-4 py-3 text-sm text-red-100">
            {portalProvisioningError}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="CNPJ para login">
            <Input
              type="text"
              value={portalCnpj}
              onChange={(event) => setPortalCnpj(event.target.value)}
              placeholder="CNPJ do cliente (apenas numeros)"
            />
          </Field>
          <Field label="Email de login">
            <Input type="email" value={portalEmail} onChange={(event) => setPortalEmail(event.target.value)} placeholder="financeiro@cliente.com" />
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
            <div className="text-2xl font-bold text-white">
              {portalAccountQuery.data ? 'Provisionada' : portalProvisioningError ? 'Indisponivel' : 'Pendente'}
            </div>
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
                    <Button variant="ghost" aria-label="Remover contato" onClick={() => handleDeleteContact(contact.id)}>
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
                  <option value="nao">Não</option>
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
          <h2 className="mb-4 text-lg font-semibold text-white">Histórico de B/Ls</h2>
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="py-2">B/L</th>
                  <th scope="col" className="py-2">Consignatário</th>
                  <th scope="col" className="py-2">Revisão</th>
                  <th scope="col" className="py-2">Financeiro</th>
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
                    <td className="py-2">{statusLabel(REVIEW_STATUS_LABELS, bl.review_status)}</td>
                    <td className="py-2">{statusLabel(FINANCIAL_STATUS_LABELS, bl.financial_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-4 mt-8 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Invoices</h2>
            <Link className="app-btn app-btn--secondary" to={`/faturamento?customer=${data.id}`}>
              Ver no Faturamento
            </Link>
          </div>
          {data.invoices_access_denied ? (
            <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
              Visualização financeira restrita ao perfil admin.
            </div>
          ) : null}
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="py-2">Invoice</th>
                  <th scope="col" className="py-2">Emissão</th>
                  <th scope="col" className="py-2">Vencimento</th>
                  <th scope="col" className="py-2">Total</th>
                  <th scope="col" className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {data.invoices?.length ? null : (
                  <tr>
                    <td colSpan={5} className="py-4 text-slate-400">
                      {data.invoices_access_denied
                        ? 'Sem permissão para visualizar invoices deste cliente.'
                        : 'Nenhuma invoice encontrada para este cliente.'}
                    </td>
                  </tr>
                )}
                {data.invoices?.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="py-2">
                      <Link className="app-table__action" to={`/faturamento?customer=${data.id}&invoice=${invoice.id}`}>
                        {invoice.invoice_number ?? `INV-${invoice.id}`}
                      </Link>
                    </td>
                    <td className="py-2">{formatDate(invoice.issued_at)}</td>
                    <td className="py-2">{formatDate(invoice.due_date)}</td>
                    <td className="py-2">{formatBRL(invoice.total_brl)}</td>
                    <td className="py-2">{statusLabel(INVOICE_STATUS_LABELS, invoice.status)}</td>
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

