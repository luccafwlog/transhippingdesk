import { useState } from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewCustomer, ReviewQueueItem } from '../../hooks/useReview'
import { canonicalizeValidCnpj, formatCnpj, normalizeCnpj } from '../../lib/cnpj'
import type { ReviewGroup } from '../../pages/revisaoHelpers'

type CustomerLookupResult = ReviewCustomer & { city?: string | null; state?: string | null }

export type ReviewCustomerOnboardingInput = {
  customerId: number | null
  cnpjCpf: string
  name: string
  email: string
  sendPortalInvite: boolean
}

export function ReviewCustomerOnboarding({
  group,
  existingCustomerId,
  existingCustomer,
  initialName,
  initialCnpj,
  initialEmail,
  saving,
  onSelectExistingCustomer,
  onSubmit,
}: {
  group: ReviewGroup
  existingCustomerId: number | null
  existingCustomer: ReviewCustomer | null
  initialName: string
  initialCnpj: string
  initialEmail: string
  saving: boolean
  onSelectExistingCustomer: (customer: ReviewCustomer) => void
  onSubmit: (input: ReviewCustomerOnboardingInput) => void
}) {
  const [name, setName] = useState(initialName)
  const [cnpj, setCnpj] = useState(initialCnpj)
  const [email, setEmail] = useState(initialEmail)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(existingCustomerId)
  const [selectedCustomer, setSelectedCustomer] = useState<ReviewCustomer | null>(existingCustomer)
  const [sendPortalInvite, setSendPortalInvite] = useState(false)
  const validCnpj = canonicalizeValidCnpj(cnpj)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const lookup = useCustomerLookup(group.identityKind === 'name' && !validCnpj ? '' : search)
  const canSubmit = Boolean(validCnpj && name.trim() && validEmail && !saving && group.items.some((item) => item.source === 'bl'))
  const count = group.items.filter((item) => item.source === 'bl').length
  const customerAlreadyHasEmail = Boolean(selectedCustomer?.customer_contacts?.some((contact) => contact.email?.trim()))

  function selectCustomer(customer: CustomerLookupResult) {
    const next: ReviewCustomer = { id: customer.id, name: customer.name, cnpj_cpf: customer.cnpj_cpf, customer_contacts: customer.customer_contacts ?? [] }
    setSelectedId(customer.id)
    setSelectedCustomer(next)
    setName(customer.name)
    setCnpj(customer.cnpj_cpf)
    onSelectExistingCustomer(next)
  }

  return (
    <Card className="grid gap-4 border-[#1f6feb]/40 bg-[#0d1117]">
      <div>
        <div className="font-semibold text-white">Cadastrar ou vincular cliente</div>
        <p className="mt-1 text-xs text-slate-400">A ação vale para {count} B/Ls deste grupo. O vínculo só ocorre depois da confirmação do CNPJ.</p>
      </div>
      <Field label="Buscar cliente existente">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite ao menos 2 caracteres" />
      </Field>
      {lookup.data?.length ? (
        <div className="grid gap-2">
          {lookup.data.map((customer) => <button key={customer.id} type="button" className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-left text-sm hover:border-[#1f6feb]" onClick={() => selectCustomer(customer as CustomerLookupResult)}><div className="font-semibold text-white">{customer.name}</div><div className="text-xs text-slate-400">{formatCnpj(customer.cnpj_cpf)}</div></button>)}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Razão social" required><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="CNPJ" required hint={validCnpj ? `Confirmado: ${formatCnpj(validCnpj)}` : 'Informe um CNPJ válido para liberar o vínculo.'}><Input placeholder="00.000.000/0000-00" value={cnpj} onChange={(event) => setCnpj(normalizeCnpj(event.target.value))} /></Field>
      </div>
      <Field label="E-mail principal do cliente" required hint={email.trim() ? `O convite será enviado para ${email.trim().toLowerCase()}.` : 'O cliente precisa ter pelo menos um e-mail cadastrado.'}>
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="financeiro@cliente.com.br" />
      </Field>
      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={sendPortalInvite} onChange={(event) => setSendPortalInvite(event.target.checked)} />
        <span>Enviar convite do Portal para este mesmo e-mail <span className="block text-xs text-slate-500">O envio será iniciado para {email.trim().toLowerCase() || 'o e-mail informado acima'}.</span></span>
      </label>
      {selectedId && selectedCustomer && customerAlreadyHasEmail ? <div className="text-xs text-emerald-300">Cliente existente selecionado. O e-mail informado será mantido como contato adicional se ainda não existir.</div> : null}
      <div className="flex justify-end">
        <Button disabled={!canSubmit} loading={saving} onClick={() => onSubmit({ customerId: selectedId, cnpjCpf: validCnpj!, name: name.trim(), email: email.trim().toLowerCase(), sendPortalInvite })}>
          {selectedId ? `Adicionar e-mail e vincular ${count} B/Ls` : `Criar cliente e vincular ${count} B/Ls`}
        </Button>
      </div>
    </Card>
  )
}

export type ReviewCustomerOnboardingItem = ReviewQueueItem
