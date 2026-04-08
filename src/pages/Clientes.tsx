import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useCustomers } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf } from '../lib/utils'
import { createCustomer } from '../services/customers'

export function Clientes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [filters, setFilters] = useState({ search: '', city: '' })
  const [open, setOpen] = useState(false)
  const [cnpjCpf, setCnpjCpf] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const { data, isLoading, error } = useCustomers(filters)

  const totals = useMemo(
    () => ({
      customers: data?.rows.length ?? 0,
      bls: data?.rows.reduce((sum, row) => sum + (row.bls?.length ?? 0), 0) ?? 0,
      pendingBalance: data?.rows.reduce((sum, row) => sum + Number(row.pending_balance ?? 0), 0) ?? 0,
    }),
    [data],
  )

  async function handleCreateCustomer() {
    if (!cnpjCpf.trim() || !name.trim()) {
      showToast('Informe CNPJ/CPF e nome para criar o cliente.', 'error')
      return
    }

    setSaving(true)
    try {
      const customer = await createCustomer({ cnpjCpf, name })
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      showToast('Cliente cadastrado com sucesso.', 'success')
      setOpen(false)
      setCnpjCpf('')
      setName('')
      navigate(`/clientes/${customer.cnpj_cpf}`)
    } catch {
      showToast('Falha ao cadastrar cliente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro mestre de consignatarios, com historico operacional e saldo pendente consolidado."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Novo Cliente
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Clientes" value={String(totals.customers)} />
        <MetricCard label="B/Ls vinculados" value={String(totals.bls)} />
        <MetricCard label="Saldo pendente" value={formatBRL(totals.pendingBalance)} />
      </div>

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Buscar por nome ou CNPJ">
            <Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
          </Field>
          <Field label="Cidade">
            <Input value={filters.city} onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))} />
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar clientes.</div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">CNPJ/CPF</th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Cidade/UF</th>
                <th className="px-4 py-3">No. B/Ls</th>
                <th className="px-4 py-3">Saldo Pendente</th>
                <th className="px-4 py-3">Acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Carregando clientes...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3">{formatCnpjCpf(row.cnpj_cpf)}</td>
                  <td className="px-4 py-3 font-semibold text-white">{row.name}</td>
                  <td className="px-4 py-3">
                    {row.city ?? '-'} / {row.state ?? '-'}
                  </td>
                  <td className="px-4 py-3">{row.bls?.length ?? 0}</td>
                  <td className="px-4 py-3">{formatBRL(row.pending_balance)}</td>
                  <td className="px-4 py-3">
                    <Link className="text-[#58a6ff] hover:underline" to={`/clientes/${row.cnpj_cpf}`}>
                      Abrir ficha
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo Cliente">
        <div className="grid gap-4">
          <Field label="CNPJ/CPF">
            <Input value={cnpjCpf} onChange={(event) => setCnpjCpf(event.target.value)} />
          </Field>
          <Field label="Nome">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={handleCreateCustomer}>
              Cadastrar cliente
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
