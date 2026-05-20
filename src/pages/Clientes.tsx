import { useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Download, Plus, Trash2, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useCustomers, useCustomerSummary } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf, onlyDigits } from '../lib/utils'
import { importCustomerBaseRows, parseCustomerBaseFile, type ParsedCustomerBase } from '../services/customerBase'
import { createCustomer } from '../services/customers'
import { exportCustomerBaseWorkbook } from '../services/exports'
import { supabase } from '../services/supabase'
import type { CustomerListItem } from '../types/database'

const customerCreateSchema = z.object({
  cnpjCpf: z
    .string()
    .min(1, 'CNPJ/CPF obrigatório')
    .refine((val) => {
      const digits = onlyDigits(val)
      return digits.length === 11 || digits.length === 14
    }, 'Informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido'),
  name: z.string().min(2, 'Razão Social obrigatória (mín. 2 caracteres)'),
})

type CustomerCreateErrors = Partial<{ cnpjCpf: string; name: string }>

type ContactForm = {
  _id: string
  name: string
  email: string
  phone: string
  purpose: 'faturamento' | 'operacional' | 'financeiro' | 'geral'
  is_primary: boolean
}

type CreateCustomerForm = {
  cnpjCpf: string
  name: string
  tradeName: string
  address: string
  city: string
  state: string
  zip: string
  notes: string
  contacts: ContactForm[]
}

function newContact(): ContactForm {
  return { _id: crypto.randomUUID(), name: '', email: '', phone: '', purpose: 'geral', is_primary: false }
}

const emptyCreateForm: CreateCustomerForm = {
  cnpjCpf: '',
  name: '',
  tradeName: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  notes: '',
  contacts: [newContact()],
}

export function Clientes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [filters, setFilters] = useState({
    search: '',
    emailStatus: '' as '' | 'with' | 'without',
    blStatus: '' as '' | 'with' | 'without',
    pendingStatus: '' as '' | 'with' | 'without',
    page: 0,
    pageSize: 50,
  })

  function setFilterField<K extends 'search' | 'emailStatus' | 'blStatus' | 'pendingStatus'>(
    field: K,
    value: typeof filters[K],
  ) {
    setFilters((current) => ({ ...current, [field]: value, page: 0 }))
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateCustomerForm>(emptyCreateForm)
  const [createErrors, setCreateErrors] = useState<CustomerCreateErrors>({})
  const [saving, setSaving] = useState(false)
  const [baseFileName, setBaseFileName] = useState('')
  const [parsedBase, setParsedBase] = useState<ParsedCustomerBase | null>(null)
  const [parsingBase, setParsingBase] = useState(false)
  const [importingBase, setImportingBase] = useState(false)
  const { data, isLoading, error } = useCustomers(filters)
  const { data: summary } = useCustomerSummary()

  const totalPages = Math.ceil((data?.totalCount ?? 0) / filters.pageSize)

  async function handleCreateCustomer() {
    const validation = customerCreateSchema.safeParse({
      cnpjCpf: createForm.cnpjCpf,
      name: createForm.name,
    })
    if (!validation.success) {
      const fieldErrors: CustomerCreateErrors = {}
      for (const issue of validation.error.issues) {
        const field = issue.path[0] as keyof CustomerCreateErrors
        if (!fieldErrors[field]) fieldErrors[field] = issue.message
      }
      setCreateErrors(fieldErrors)
      return
    }
    setCreateErrors({})

    const activeContacts = createForm.contacts.filter(
      (contact) => contact.name.trim() || contact.email.trim() || contact.phone.trim(),
    )

    if (activeContacts.some((contact) => !contact.name.trim())) {
      showToast('Todo contato preenchido parcialmente precisa ter nome.', 'error')
      return
    }

    setSaving(true)
    try {
      const customer = await createCustomer({
        cnpjCpf: createForm.cnpjCpf,
        name: createForm.name,
        tradeName: createForm.tradeName,
        address: createForm.address,
        city: createForm.city,
        state: createForm.state,
        zip: createForm.zip,
        notes: createForm.notes,
        contacts: activeContacts,
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
      ])

      showToast('Cliente cadastrado com sucesso.', 'success')
      setCreateOpen(false)
      setCreateForm(emptyCreateForm)
      navigate(`/clientes/${customer.cnpj_cpf}`)
    } catch {
      showToast('Falha ao cadastrar cliente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleBaseFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setBaseFileName(nextFile?.name ?? '')
    setParsedBase(null)

    if (!nextFile) return

    setParsingBase(true)
    try {
      const parsed = await parseCustomerBaseFile(nextFile)
      setParsedBase(parsed)
      showToast(
        parsed.rowErrors.length
          ? `Base lida com ${parsed.rows.length} clientes validos e ${parsed.rowErrors.length} linhas ignoradas.`
          : `Base lida com ${parsed.rows.length} clientes validos.`,
        parsed.rowErrors.length ? 'info' : 'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler a base. Confira o layout do arquivo.'
      showToast(message, 'error')
    } finally {
      setParsingBase(false)
    }
  }

  async function handleImportBase() {
    if (!parsedBase?.rows.length) return

    setImportingBase(true)
    try {
      const result = await importCustomerBaseRows(parsedBase.rows)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])
      const linkedMsg = result.blsLinked ? ` ${result.blsLinked} B/L(s) vinculado(s) automaticamente.` : ''
      showToast(
        `Base importada: ${result.imported} novo(s), ${result.updated} atualizado(s), ${result.contactsCreated} contato(s).${linkedMsg}`,
        'success',
      )
      resetImportModal()
    } catch {
      showToast('Falha ao importar base de clientes.', 'error')
    } finally {
      setImportingBase(false)
    }
  }

  async function handleExportBase() {
    try {
      let query = supabase.from('customers').select('*, bls(id, charge_status), customer_contacts(id)').order('name', { ascending: true })

      if (filters.search) {
        query = query.or(
          `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,cnpj_cpf.ilike.%${filters.search}%`,
        )
      }

      const { data, error } = await query
      if (error) throw error

      const rows = ((data ?? []) as unknown as CustomerListItem[]).filter((row) => {
        const hasEmails = (row.customer_contacts?.length ?? 0) > 0
        const hasBls = (row.bls?.length ?? 0) > 0
        const hasPendingBalance = Number(row.pending_balance ?? 0) > 0

        if (filters.emailStatus === 'with' && !hasEmails) return false
        if (filters.emailStatus === 'without' && hasEmails) return false
        if (filters.blStatus === 'with' && !hasBls) return false
        if (filters.blStatus === 'without' && hasBls) return false
        if (filters.pendingStatus === 'with' && !hasPendingBalance) return false
        if (filters.pendingStatus === 'without' && hasPendingBalance) return false
        return true
      })

      await exportCustomerBaseWorkbook(rows)
      showToast(`Base exportada com ${rows.length} cliente(s).`, 'success')
    } catch {
      showToast('Falha ao exportar base de clientes.', 'error')
    }
  }

  function resetImportModal() {
    setImportOpen(false)
    setBaseFileName('')
    setParsedBase(null)
    setParsingBase(false)
    setImportingBase(false)
  }

  function resetCreateModal() {
    setCreateOpen(false)
    setCreateForm(emptyCreateForm)
    setCreateErrors({})
    setSaving(false)
  }

  function updateCreateField<K extends keyof Omit<CreateCustomerForm, 'contacts'>>(field: K, value: CreateCustomerForm[K]) {
    setCreateForm((current) => ({ ...current, [field]: value }))
  }

  function updateContact(index: number, patch: Partial<ContactForm>) {
    setCreateForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, currentIndex) =>
        currentIndex === index ? { ...contact, ...patch } : contact,
      ),
    }))
  }

  function addContact() {
    setCreateForm((current) => ({ ...current, contacts: [...current.contacts, newContact()] }))
  }

  function removeContact(index: number) {
    setCreateForm((current) => ({
      ...current,
      contacts: current.contacts.length === 1 ? [newContact()] : current.contacts.filter((_, currentIndex) => currentIndex !== index),
    }))
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro mestre de consignatarios. Importe a base antes dos manifestos para vinculo automatico por CNPJ/CPF."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} />
              Importar base
            </Button>
            <Button variant="secondary" onClick={handleExportBase}>
              <Download size={16} />
              Exportar base
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              Novo Cliente
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-5">
        <MetricCard label="Clientes" value={String(summary?.totalCustomers ?? 0)} />
        <MetricCard label="B/Ls vinculados" value={String(summary?.totalBls ?? 0)} />
        <MetricCard label="Taxas pendentes" value={String(summary?.chargePending ?? 0)} />
        <MetricCard label="Pronto faturar" value={String(summary?.chargeReady ?? 0)} />
        <MetricCard label="Saldo pendente" value={formatBRL(summary?.pendingBalance ?? 0)} />
      </div>

      <div className="mb-5">
        <Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Buscar por nome ou CNPJ">
              <Input
                value={filters.search}
                onChange={(event) => setFilterField('search', event.target.value)}
                placeholder="Razao social, fantasia ou documento"
              />
            </Field>
            <Field label="E-mails vinculados">
              <Select
                value={filters.emailStatus}
                onChange={(event) => setFilterField('emailStatus', event.target.value as '' | 'with' | 'without')}
              >
                <option value="">Todos</option>
                <option value="with">Com e-mails</option>
                <option value="without">Sem e-mails</option>
              </Select>
            </Field>
            <Field label="BLs vinculados">
              <Select
                value={filters.blStatus}
                onChange={(event) => setFilterField('blStatus', event.target.value as '' | 'with' | 'without')}
              >
                <option value="">Todos</option>
                <option value="with">Com B/Ls</option>
                <option value="without">Sem B/Ls</option>
              </Select>
            </Field>
            <Field label="Valores pendentes">
              <Select
                value={filters.pendingStatus}
                onChange={(event) => setFilterField('pendingStatus', event.target.value as '' | 'with' | 'without')}
              >
                <option value="">Todos</option>
                <option value="with">Com saldo pendente</option>
                <option value="without">Sem saldo pendente</option>
              </Select>
            </Field>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar clientes." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[880px] table-fixed text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="w-[31%] px-4 py-3">Cliente</th>
                <th className="w-[17%] px-4 py-3">Contatos</th>
                <th className="w-[22%] px-4 py-3">Operacao</th>
                <th className="w-[16%] px-4 py-3">Financeiro</th>
                <th className="w-[14%] px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Carregando clientes...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyState title="Nenhum cliente encontrado." description="Importe uma base de clientes ou cadastre manualmente." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => {
                const summary = summarizeCustomerCharges(row.bls ?? [])
                const hasPendingBalance = Number(row.pending_balance ?? 0) > 0
                return (
                  <tr key={row.id} className="hover:bg-[#21262d]/60">
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value" title={row.name}>
                          {truncateCustomerName(row.name, 64)}
                        </div>
                        <div className="app-table__cell-meta">{formatCnpjCpf(row.cnpj_cpf)}</div>
                        <div className="app-table__cell-meta">
                          {[row.trade_name, row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state]
                            .filter(Boolean)
                            .join(' • ') || 'Sem complemento cadastral'}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value">{row.customer_contacts?.length ?? 0} contato(s)</div>
                        <div className="app-table__cell-meta">
                          {(row.customer_contacts?.length ?? 0) > 0 ? 'Base pronta para notificacao' : 'Sem e-mails cadastrados'}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value">{row.bls?.length ?? 0} B/L(s) vinculados</div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="yellow">Pend {summary.pending}</Badge>
                          <Badge tone="green">Pronto {summary.ready}</Badge>
                          <Badge tone="slate">Isento {summary.exempt}</Badge>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value app-table__cell-value--financial">
                          {formatBRL(row.pending_balance)}
                        </div>
                        <div className="app-table__cell-meta">
                          {hasPendingBalance ? 'Com saldo em aberto' : 'Sem pendencia financeira'}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link className="app-table__action" to={`/clientes/${row.cnpj_cpf}`}>
                          Abrir ficha
                        </Link>
                        <Link className="app-table__action" to={`/faturamento?customer=${row.id}`}>
                          Faturamento
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-[#30363d] px-4 py-3 text-sm text-slate-400">
            <span>
              Pagina {filters.page + 1} de {totalPages} ({data?.totalCount ?? 0} clientes)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={filters.page === 0}
                onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                disabled={filters.page >= totalPages - 1}
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
              >
                Proxima
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Modal open={createOpen} onClose={resetCreateModal} title="Novo Cliente">
        <div className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="CNPJ/CPF" error={createErrors.cnpjCpf}>
              <Input value={createForm.cnpjCpf} onChange={(event) => updateCreateField('cnpjCpf', event.target.value)} />
            </Field>
            <Field label="Razao Social" error={createErrors.name}>
              <Input value={createForm.name} onChange={(event) => updateCreateField('name', event.target.value)} />
            </Field>
            <Field label="Nome fantasia">
              <Input
                value={createForm.tradeName}
                onChange={(event) => updateCreateField('tradeName', event.target.value)}
              />
            </Field>
            <Field label="Endereco">
              <Input value={createForm.address} onChange={(event) => updateCreateField('address', event.target.value)} />
            </Field>
            <Field label="Cidade">
              <Input value={createForm.city} onChange={(event) => updateCreateField('city', event.target.value)} />
            </Field>
            <Field label="UF">
              <Input
                value={createForm.state}
                onChange={(event) => updateCreateField('state', event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="CEP">
              <Input value={createForm.zip} onChange={(event) => updateCreateField('zip', event.target.value)} />
            </Field>
          </div>

          <Field label="Notas">
            <Textarea value={createForm.notes} onChange={(event) => updateCreateField('notes', event.target.value)} />
          </Field>

          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Contatos do cliente</div>
                <div className="text-sm text-slate-400">Voce pode cadastrar os contatos principais ja na criacao.</div>
              </div>
              <Button variant="secondary" onClick={addContact}>
                <Plus size={16} />
                Adicionar contato
              </Button>
            </div>

            <div className="grid gap-4">
              {createForm.contacts.map((contact, index) => (
                <div key={contact._id} className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="font-semibold text-white">Contato {index + 1}</div>
                    <Button variant="ghost" onClick={() => removeContact(index)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="Nome">
                      <Input value={contact.name} onChange={(event) => updateContact(index, { name: event.target.value })} />
                    </Field>
                    <Field label="Email">
                      <Input
                        type="email"
                        value={contact.email}
                        onChange={(event) => updateContact(index, { email: event.target.value })}
                      />
                    </Field>
                    <Field label="Telefone">
                      <Input value={contact.phone} onChange={(event) => updateContact(index, { phone: event.target.value })} />
                    </Field>
                    <Field label="Finalidade">
                      <Select
                        value={contact.purpose}
                        onChange={(event) =>
                          updateContact(index, { purpose: event.target.value as ContactForm['purpose'] })
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
                        value={contact.is_primary ? 'sim' : 'nao'}
                        onChange={(event) => updateContact(index, { is_primary: event.target.value === 'sim' })}
                      >
                        <option value="nao">Nao</option>
                        <option value="sim">Sim</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetCreateModal}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={handleCreateCustomer}>
              Cadastrar cliente
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={importOpen} onClose={resetImportModal} title="Importar Base de Clientes">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">Modelo padrao da base</div>
            <div className="mt-2">
              As colunas obrigatorias do arquivo sao <span className="font-semibold text-white">CNPJ/CPF</span> e{' '}
              <span className="font-semibold text-white">Razao Social</span>. As colunas opcionais sao Nome Fantasia,
              Endereco, Cidade, UF, CEP e Email.
            </div>
            <div className="mt-2 text-slate-400">
              Se o mesmo CNPJ/CPF aparecer em mais de uma linha com e-mails distintos, todos os e-mails serao criados
              como contatos do cliente.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/base-clientes-modelo.xlsx"
                download="base-clientes-modelo.xlsx"
              >
                <Download size={16} />
                Baixar modelo .xlsx
              </a>
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
                href="/templates/base-clientes-modelo.csv"
                download="base-clientes-modelo.csv"
              >
                <Download size={16} />
                Baixar modelo .csv
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
            Quando um manifesto trouxer o mesmo CNPJ/CPF, o B/L passa a usar o cliente desta base como cadastro
            oficial.
          </div>

          <Field label="Arquivo .xlsx, .xls ou .csv">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleBaseFile} />
          </Field>

          {baseFileName ? <div className="text-sm text-slate-400">Arquivo selecionado: {baseFileName}</div> : null}
          {parsingBase ? <div className="text-sm text-slate-400">Lendo base com SheetJS...</div> : null}

          {parsedBase ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewBox label="Clientes validos" value={parsedBase.rows.length} />
                <PreviewBox label="Linhas ignoradas" value={parsedBase.rowErrors.length} />
                <PreviewBox
                  label="Emails detectados"
                  value={parsedBase.rows.reduce((sum, row) => sum + row.emails.length, 0)}
                />
              </div>

              {parsedBase.rowErrors.length ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {parsedBase.rowErrors.length} linha(s) não puderam ser aproveitadas. As primeiras divergências estão
                  listadas abaixo.
                </div>
              ) : null}

              <div className="app-table-scroll max-h-72 rounded-xl border border-[#30363d]">
                <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">CNPJ/CPF</th>
                      <th className="px-3 py-2">Nome</th>
                      <th className="px-3 py-2">Emails</th>
                      <th className="px-3 py-2">Cidade/UF</th>
                      <th className="px-3 py-2">Endereco</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {parsedBase.rows.slice(0, 15).map((row) => (
                      <tr key={row.cnpj_cpf}>
                        <td className="px-3 py-2">{formatCnpjCpf(row.cnpj_cpf)}</td>
                        <td className="px-3 py-2 font-semibold text-white">{row.name}</td>
                        <td className="px-3 py-2">
                          <span className="app-table__truncate app-table__truncate--xl" title={row.emails.join('; ')}>
                            {row.emails.length ? row.emails.join('; ') : '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {row.city ?? '-'} / {row.state ?? '-'}
                        </td>
                        <td className="px-3 py-2">{row.address ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsedBase.rowErrors.length ? (
                <div className="grid gap-2 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
                  {parsedBase.rowErrors.slice(0, 8).map((rowError) => (
                    <div key={`${rowError.row}-${rowError.message}`}>
                      Linha {rowError.row}: {rowError.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetImportModal}>
              Cancelar
            </Button>
            <Button disabled={!parsedBase?.rows.length} loading={importingBase} onClick={handleImportBase}>
              Importar base
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

function truncateCustomerName(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}...`
}

function summarizeCustomerCharges(bls: Array<{ charge_status?: string | null }>) {
  return {
    pending: bls.filter((bl) => bl.charge_status === 'review_required' || bl.charge_status === 'not_calculated').length,
    ready: bls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
    exempt: bls.filter((bl) => bl.charge_status === 'exempt').length,
  }
}
