import { useEffect, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, FileText, MoreHorizontal, Plus, ReceiptText, Trash2, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { PreviewBox } from '../components/ui/PreviewBox'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { filterCustomerRowsByClientSideFilters, useCustomers, useCustomerSummary } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf, onlyDigits } from '../lib/utils'
import {
  buildCustomerBillingUrl,
  getCustomerFilterChips,
  getCustomerNextAction,
  summarizeContactsForDisplay,
  type CustomerSortKey,
  type SortDirection,
} from '../lib/customerTableViewModel'
import { importCustomerBaseRows, parseCustomerBaseFile, type ParsedCustomerBase } from '../services/customerBase'
import { checkCustomerDependencies, createCustomer, deleteCustomers, fetchIssuedInvoiceBalanceByCustomer } from '../services/customers'
import { formatBlockedSummary } from '../services/deleteDependencies'
import { exportCustomerBaseWorkbook } from '../services/exports'
import { supabase } from '../services/supabase'
import type { CustomerContact, CustomerListItem } from '../types/database'

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
  purpose: NonNullable<CustomerContact['purpose']>
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
  const confirm = useConfirm()
  const { can, isAdmin, user } = useAuth()
  const canEditCustomers = can ? can('customers_edit') : isAdmin
  const [deleting, setDeleting] = useState(false)
  const [actionsMenu, setActionsMenu] = useState<
    { id: number; top: number; left: number; name: string; cnpj: string; email: string | null } | null
  >(null)
  const [filters, setFilters] = useState({
    search: '',
    contactEmail: '',
    emailStatus: '' as '' | 'with' | 'without',
    blStatus: '' as '' | 'with' | 'without',
    pendingStatus: '' as '' | 'with' | 'without',
    sortKey: 'name' as CustomerSortKey,
    sortDirection: 'asc' as SortDirection,
    page: 0,
    pageSize: 50,
  })
  const selectionScope = [
    filters.search,
    filters.contactEmail,
    filters.emailStatus,
    filters.blStatus,
    filters.pendingStatus,
    filters.sortKey,
    filters.sortDirection,
    filters.page,
    filters.pageSize,
  ].join('|')
  const selection = useRowSelection<number>(selectionScope)

  function setFilterField<K extends 'search' | 'contactEmail' | 'emailStatus' | 'blStatus' | 'pendingStatus'>(
    field: K,
    value: typeof filters[K],
  ) {
    setFilters((current) => ({ ...current, [field]: value, page: 0 }))
  }
  const activeFilterCount = (['search', 'contactEmail', 'emailStatus', 'blStatus', 'pendingStatus'] as const)
    .filter((key) => String(filters[key] ?? '').trim() !== '').length
  function clearFilters() {
    setFilters((current) => ({ ...current, search: '', contactEmail: '', emailStatus: '', blStatus: '', pendingStatus: '', page: 0 }))
  }
  function toggleSort(sortKey: CustomerSortKey) {
    setFilters((current) => ({
      ...current,
      sortKey,
      sortDirection: current.sortKey === sortKey && current.sortDirection === 'asc' ? 'desc' : 'asc',
      page: 0,
    }))
  }
  const filterChips = getCustomerFilterChips(filters)
  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value)
    showToast(`${label} copiado.`, 'success')
    setActionsMenu(null)
  }
  function openActionsMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    row: { id: number; name: string; cnpj_cpf: string; email: string | null },
  ) {
    if (actionsMenu?.id === row.id) {
      setActionsMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setActionsMenu({ id: row.id, top: rect.bottom + 6, left: rect.right, name: row.name, cnpj: row.cnpj_cpf, email: row.email })
  }
  // O menu flutua via position:fixed para escapar do recorte do container de scroll
  // da tabela; por isso precisa fechar quando o usuario rola, redimensiona ou clica fora.
  useEffect(() => {
    if (!actionsMenu) return
    const close = () => setActionsMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-actions-menu]')) close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [actionsMenu])
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
  const { data: summary } = useCustomerSummary(filters)

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
      navigate(`/clientes/${encodeURIComponent(customer.cnpj_cpf)}`)
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
      const linkedMsg = result.blsLinked ? ` ${formatCountLabel(result.blsLinked, 'B/L vinculado', 'B/Ls vinculados')} automaticamente.` : ''
      showToast(
        `Base importada: ${formatCountLabel(result.imported, 'novo', 'novos')}, ${formatCountLabel(result.updated, 'atualizado', 'atualizados')}, ${formatCountLabel(result.contactsCreated, 'contato', 'contatos')}.${linkedMsg}`,
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
      let query = supabase
        .from('customers')
        .select('*, bls(id, charge_status), customer_contacts(id, email, purpose, is_primary)')
        .order('name', { ascending: true })

      if (filters.search) {
        query = query.or(
          `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,cnpj_cpf.ilike.%${filters.search}%`,
        )
      }

      const { data, error } = await query
      if (error) throw error

      const rowsWithBalances = (data ?? []) as unknown as CustomerListItem[]
      const balances = await fetchIssuedInvoiceBalanceByCustomer(rowsWithBalances.map((row) => row.id))
      const rows = filterCustomerRowsByClientSideFilters(
        rowsWithBalances.map((row) => ({ ...row, pending_balance: balances.get(row.id) ?? 0 })),
        filters,
      )

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

  async function runCustomerDelete(ids: number[]) {
    setDeleting(true)
    try {
      const report = await checkCustomerDependencies(ids)
      if (report.deletableIds.length === 0) {
        showToast(`Nenhum cliente pode ser excluido. ${formatBlockedSummary(report.blockedIds)}`, 'error')
        return
      }

      const parts = [
        `Excluir ${report.deletableIds.length} cliente(s)? Os contatos e overrides de tarifa serao excluidos junto. Esta acao e irreversivel.`,
      ]
      if (report.blockedIds.length) parts.push(formatBlockedSummary(report.blockedIds))
      const ok = await confirm({ message: parts.join('\n\n'), tone: 'danger', confirmLabel: 'Excluir' })
      if (!ok) return

      await deleteCustomers(report.deletableIds, user?.id)
      selection.clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customers-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
      ])
      showToast(`${report.deletableIds.length} cliente(s) excluido(s).`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir cliente(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const pageCustomerIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageCustomerIds.length > 0 && pageCustomerIds.every((id) => selection.isSelected(id))

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
        description="Cadastro mestre de consignatários. Importe a base antes dos manifestos para vínculo automático por CNPJ/CPF."
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

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Saldo pendente" value={formatBRL(summary?.pendingBalance ?? 0)} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Clientes" value={String(summary?.totalCustomers ?? 0)} />
          <MetricCard label="B/Ls vinculados" value={String(summary?.totalBls ?? 0)} />
          <MetricCard label="Taxas pendentes" value={String(summary?.chargePending ?? 0)} />
          <MetricCard label="Faturados" value={String(summary?.chargeReady ?? 0)} />
        </div>
      </div>

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Buscar por nome ou CNPJ">
            <Input
              value={filters.search}
              onChange={(event) => setFilterField('search', event.target.value)}
              placeholder="Razao social, fantasia ou documento"
            />
          </Field>
          <Field label="Buscar por e-mail do contato">
            <Input
              type="email"
              value={filters.contactEmail}
              onChange={(event) => setFilterField('contactEmail', event.target.value)}
              placeholder="email@cliente.com"
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
      </FilterBar>

      {filterChips.length ? (
        <div className="app-filter-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="app-filter-chip"
              onClick={() => setFilterField(chip.key, '' as never)}
            >
              {chip.label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {canEditCustomers ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => runCustomerDelete([...selection.selected])}
          deleting={deleting}
          noun={['cliente', 'clientes']}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar clientes." /> : null}
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact app-table--sticky-actions min-w-[1140px] table-fixed text-left text-sm">
            <thead className="text-xs uppercase tracking-wider">
              <tr>
                {canEditCustomers ? (
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os clientes da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageCustomerIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="w-[30%] px-4 py-3">
                  <button type="button" className="app-table__sort" onClick={() => toggleSort('name')}>
                    Cliente
                    {renderSortIcon(filters, 'name')}
                  </button>
                </th>
                <th scope="col" className="w-[18%] px-4 py-3">Contatos</th>
                <th scope="col" className="w-[20%] px-4 py-3">
                  <button type="button" className="app-table__sort" onClick={() => toggleSort('bls')}>
                    Operação
                    {renderSortIcon(filters, 'bls')}
                  </button>
                </th>
                <th scope="col" className="w-[16%] px-4 py-3">
                  <button type="button" className="app-table__sort" onClick={() => toggleSort('pendingBalance')}>
                    Financeiro
                    {renderSortIcon(filters, 'pendingBalance')}
                  </button>
                </th>
                <th scope="col" className="w-[236px] px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={canEditCustomers ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                    Carregando clientes...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={canEditCustomers ? 6 : 5} className="p-0">
                    <EmptyState title="Nenhum cliente encontrado." description="Importe uma base de clientes ou cadastre manualmente." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => {
                const summary = summarizeCustomerCharges(row.bls ?? [])
                const hasPendingBalance = Number(row.pending_balance ?? 0) > 0
                const customerComplement = [
                  row.trade_name,
                  row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state,
                ].filter(Boolean).join(' • ')
                const contactSummary = summarizeContactsForDisplay(row.customer_contacts)
                const nextAction = getCustomerNextAction({
                  hasEmail: !contactSummary.empty,
                  readyCount: summary.ready,
                  pendingCount: summary.pending,
                  pendingBalance: Number(row.pending_balance ?? 0),
                })
                return (
                  <tr key={row.id}>
                    {canEditCustomers ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar cliente ${row.name}`}
                          checked={selection.isSelected(row.id)}
                          onChange={() => selection.toggle(row.id)}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value" title={row.name}>
                          {truncateCustomerName(row.name, 64)}
                        </div>
                        <div className="app-table__cell-meta">{formatCnpjCpf(row.cnpj_cpf)}</div>
                        {customerComplement ? <div className="app-table__cell-meta">{customerComplement}</div> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value">{formatCountLabel(contactSummary.count, 'contato', 'contatos')}</div>
                        {contactSummary.primaryEmail ? (
                          <span className="app-table__truncate app-table__truncate--md" title={contactSummary.primaryEmail}>
                            {contactSummary.primaryEmail}
                          </span>
                        ) : (
                          <span className="app-cell-flag app-cell-flag--warn">Sem e-mail</span>
                        )}
                        {contactSummary.purposeLabel ? (
                          <span className="app-cell-flag">{contactSummary.purposeLabel}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value">{formatCountLabel(row.bls?.length ?? 0, 'B/L vinculado', 'B/Ls vinculados')}</div>
                        {summary.pending > 0 || summary.ready > 0 || summary.exempt > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {summary.pending > 0 ? <Badge tone="yellow">Pend {summary.pending}</Badge> : null}
                            {summary.ready > 0 ? <Badge tone="green">Pronto {summary.ready}</Badge> : null}
                            {summary.exempt > 0 ? <span className="app-cell-flag">Isento {summary.exempt}</span> : null}
                          </div>
                        ) : (
                          <span className="app-cell-flag">Sem taxas</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <div className="app-table__cell-value app-table__cell-value--financial">
                          {formatBRL(row.pending_balance)}
                        </div>
                        <Badge tone={nextAction.tone}>{nextAction.label}</Badge>
                        {hasPendingBalance ? <div className="app-table__cell-meta">Com saldo em aberto</div> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="app-customer-row-actions">
                        <Link
                          className="app-table__action app-table__action--compact"
                          to={`/clientes/${encodeURIComponent(row.cnpj_cpf)}`}
                          title="Abrir ficha do cliente"
                        >
                          <FileText size={14} />
                          Ficha
                        </Link>
                        <Link
                          className="app-table__icon-button app-table__icon-button--sm"
                          to={buildCustomerBillingUrl(row)}
                          title="Ver faturas do cliente"
                          aria-label={`Ver faturas de ${row.name}`}
                        >
                          <ReceiptText size={15} />
                        </Link>
                        <button
                          type="button"
                          data-actions-menu
                          className="app-table__icon-button app-table__icon-button--sm"
                          title="Mais ações"
                          aria-label={`Mais ações para ${row.name}`}
                          aria-haspopup="menu"
                          aria-expanded={actionsMenu?.id === row.id}
                          onClick={(event) =>
                            openActionsMenu(event, { id: row.id, name: row.name, cnpj_cpf: row.cnpj_cpf, email: contactSummary.primaryEmail })
                          }
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <TableFooterPagination
            page={filters.page}
            pageBase={0}
            pageSize={filters.pageSize}
            totalCount={data?.totalCount ?? 0}
            totalPages={totalPages}
            countLabel={`${data?.totalCount ?? 0} clientes`}
            onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
          />
        ) : null}
      </Card>

      {actionsMenu ? (
        <div
          data-actions-menu
          className="app-floating-menu"
          role="menu"
          style={{ top: actionsMenu.top, left: actionsMenu.left }}
        >
          <button type="button" role="menuitem" onClick={() => void copyText(formatCnpjCpf(actionsMenu.cnpj), 'CNPJ/CPF')}>
            <Copy size={14} />
            Copiar CNPJ/CPF
          </button>
          {actionsMenu.email ? (
            <button type="button" role="menuitem" onClick={() => void copyText(actionsMenu.email!, 'E-mail principal')}>
              <Copy size={14} />
              Copiar e-mail
            </button>
          ) : null}
          {canEditCustomers ? (
            <button
              type="button"
              role="menuitem"
              className="app-floating-menu__danger"
              disabled={deleting}
              onClick={() => {
                const id = actionsMenu.id
                setActionsMenu(null)
                void runCustomerDelete([id])
              }}
            >
              <Trash2 size={14} />
              Excluir cliente
            </button>
          ) : null}
        </div>
      ) : null}

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
            <Field label="Endereço">
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

          <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
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
                <div key={contact._id} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="font-semibold text-white">Contato {index + 1}</div>
                    <Button variant="ghost" onClick={() => removeContact(index)} aria-label="Remover contato">
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
          <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
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

          <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
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
                <PreviewBox variant="surface" label="Clientes validos" value={parsedBase.rows.length} />
                <PreviewBox variant="surface" label="Linhas ignoradas" value={parsedBase.rowErrors.length} />
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

              <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
                <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="px-3 py-2">CNPJ/CPF</th>
                      <th scope="col" className="px-3 py-2">Nome</th>
                      <th scope="col" className="px-3 py-2">Emails</th>
                      <th scope="col" className="px-3 py-2">Cidade/UF</th>
                      <th scope="col" className="px-3 py-2">Endereco</th>
                    </tr>
                  </thead>
                  <tbody>
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
              <TruncationNote shown={15} total={parsedBase.rows.length} noun="cliente" nounPlural="clientes" />

              {parsedBase.rowErrors.length ? (
                <div className="grid gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
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


function truncateCustomerName(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}...`
}

function renderSortIcon(
  filters: { sortKey: CustomerSortKey; sortDirection: SortDirection },
  key: CustomerSortKey,
) {
  if (filters.sortKey !== key) return <ArrowUpDown size={13} className="opacity-50" />
  return filters.sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
}

function summarizeCustomerCharges(bls: Array<{ charge_status?: string | null }>) {
  return {
    pending: bls.filter((bl) => bl.charge_status === 'review_required' || bl.charge_status === 'not_calculated').length,
    ready: bls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
    exempt: bls.filter((bl) => bl.charge_status === 'exempt').length,
  }
}

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}
