import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useCustomers } from '../hooks/useCustomers'
import { formatBRL, formatCnpjCpf } from '../lib/utils'
import { importCustomerBaseRows, parseCustomerBaseFile, type ParsedCustomerBase } from '../services/customerBase'
import { createCustomer } from '../services/customers'

export function Clientes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [filters, setFilters] = useState({ search: '', city: '' })
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [cnpjCpf, setCnpjCpf] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [baseFileName, setBaseFileName] = useState('')
  const [parsedBase, setParsedBase] = useState<ParsedCustomerBase | null>(null)
  const [parsingBase, setParsingBase] = useState(false)
  const [importingBase, setImportingBase] = useState(false)
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
      setCreateOpen(false)
      setCnpjCpf('')
      setName('')
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
      const message = error instanceof Error ? error.message : 'Nao foi possivel ler a base. Confira o layout do arquivo.'
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
      ])
      showToast(
        `Base importada: ${result.imported} novo(s) e ${result.updated} atualizado(s).`,
        'success',
      )
      resetImportModal()
    } catch {
      showToast('Falha ao importar base de clientes.', 'error')
    } finally {
      setImportingBase(false)
    }
  }

  function resetImportModal() {
    setImportOpen(false)
    setBaseFileName('')
    setParsedBase(null)
    setParsingBase(false)
    setImportingBase(false)
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
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              Novo Cliente
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Clientes" value={String(totals.customers)} />
        <MetricCard label="B/Ls vinculados" value={String(totals.bls)} />
        <MetricCard label="Saldo pendente" value={formatBRL(totals.pendingBalance)} />
      </div>

      <Card className="mb-5">
        <div className="mb-4 rounded-xl border border-[#1f6feb]/30 bg-[#1f6feb]/10 p-4 text-sm text-slate-200">
          <div className="font-semibold text-white">Nova regra de cadastro</div>
          <div className="mt-2">
            Manifestos nao criam clientes automaticamente. O sistema vincula o B/L ao cadastro mestre quando o
            CNPJ/CPF do manifesto ja existe nesta base.
          </div>
          <div className="mt-2 text-slate-400">
            Importe a base antes dos manifestos. Nesta versao, B/Ls antigos sem vinculo nao sao religados de forma
            retroativa.
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Buscar por nome ou CNPJ">
            <Input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </Field>
          <Field label="Cidade">
            <Input
              value={filters.city}
              onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))}
            />
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
                <th className="px-4 py-3">Saldo pendente</th>
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

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo Cliente">
        <div className="grid gap-4">
          <Field label="CNPJ/CPF">
            <Input value={cnpjCpf} onChange={(event) => setCnpjCpf(event.target.value)} />
          </Field>
          <Field label="Nome">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
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
            <div className="font-semibold text-white">Como esta importacao funciona</div>
            <div className="mt-2">
              As colunas obrigatorias do arquivo sao <span className="font-semibold text-white">CNPJ/CPF</span> e{' '}
              <span className="font-semibold text-white">Razao Social</span>. As colunas opcionais sao Nome Fantasia,
              Endereco, Cidade, UF e CEP.
            </div>
            <div className="mt-2 text-slate-400">
              Quando um manifesto trouxer o mesmo CNPJ/CPF, o B/L passa a usar o cliente desta base como cadastro
              oficial.
            </div>
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
                  label="Prontos para vinculo"
                  value={parsedBase.rows.filter((row) => Boolean(row.cnpj_cpf)).length}
                />
              </div>

              {parsedBase.rowErrors.length ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {parsedBase.rowErrors.length} linha(s) nao puderam ser aproveitadas. As primeiras divergencias estao
                  listadas abaixo.
                </div>
              ) : null}

              <div className="max-h-72 overflow-auto rounded-xl border border-[#30363d]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">CNPJ/CPF</th>
                      <th className="px-3 py-2">Nome</th>
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
