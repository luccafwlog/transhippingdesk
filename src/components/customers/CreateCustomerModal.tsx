import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import type { CreateCustomerForm, CustomerContactForm, CustomerCreateErrors } from './customerCreateForm'
import { normalizeCnpj } from '../../lib/cnpj'

export function CreateCustomerModal({
  open,
  form,
  errors,
  saving,
  onClose,
  onSubmit,
  onFieldChange,
  onContactChange,
  onAddContact,
  onRemoveContact,
}: {
  open: boolean
  form: CreateCustomerForm
  errors: CustomerCreateErrors
  saving: boolean
  onClose: () => void
  onSubmit: () => void
  onFieldChange: <K extends keyof Omit<CreateCustomerForm, 'contacts'>>(field: K, value: CreateCustomerForm[K]) => void
  onContactChange: (index: number, patch: Partial<CustomerContactForm>) => void
  onAddContact: () => void
  onRemoveContact: (index: number) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Novo Cliente">
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="CNPJ" error={errors.cnpjCpf}>
            <Input maxLength={14} value={form.cnpjCpf} onChange={(event) => onFieldChange('cnpjCpf', normalizeCnpj(event.target.value))} />
          </Field>
          <Field label="Razao Social" error={errors.name}>
            <Input value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} />
          </Field>
          <Field label="Nome fantasia">
            <Input value={form.tradeName} onChange={(event) => onFieldChange('tradeName', event.target.value)} />
          </Field>
          <Field label="Endereço">
            <Input value={form.address} onChange={(event) => onFieldChange('address', event.target.value)} />
          </Field>
          <Field label="Cidade">
            <Input value={form.city} onChange={(event) => onFieldChange('city', event.target.value)} />
          </Field>
          <Field label="UF">
            <Input value={form.state} onChange={(event) => onFieldChange('state', event.target.value.toUpperCase())} />
          </Field>
          <Field label="CEP">
            <Input value={form.zip} onChange={(event) => onFieldChange('zip', event.target.value)} />
          </Field>
        </div>

        <Field label="Notas">
          <Textarea value={form.notes} onChange={(event) => onFieldChange('notes', event.target.value)} />
        </Field>

        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-white">Contatos do cliente</div>
              <div className="text-sm text-slate-400">Voce pode cadastrar os contatos principais ja na criacao.</div>
            </div>
            <Button variant="secondary" onClick={onAddContact}>
              <Plus size={16} />
              Adicionar contato
            </Button>
          </div>

          <div className="grid gap-4">
            {form.contacts.map((contact, index) => (
              <ContactForm
                key={contact._id}
                contact={contact}
                index={index}
                onChange={onContactChange}
                onRemove={onRemoveContact}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={onSubmit}>
            Cadastrar cliente
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ContactForm({
  contact,
  index,
  onChange,
  onRemove,
}: {
  contact: CustomerContactForm
  index: number
  onChange: (index: number, patch: Partial<CustomerContactForm>) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold text-white">Contato {index + 1}</div>
        <Button variant="ghost" onClick={() => onRemove(index)} aria-label="Remover contato">
          <Trash2 size={16} />
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Nome">
          <Input value={contact.name} onChange={(event) => onChange(index, { name: event.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={contact.email} onChange={(event) => onChange(index, { email: event.target.value })} />
        </Field>
        <Field label="Telefone">
          <Input value={contact.phone} onChange={(event) => onChange(index, { phone: event.target.value })} />
        </Field>
        <Field label="Finalidade">
          <Select value={contact.purpose} onChange={(event) => onChange(index, { purpose: event.target.value as CustomerContactForm['purpose'] })}>
            <option value="geral">Geral</option>
            <option value="operacional">Operacional</option>
            <option value="faturamento">Faturamento</option>
            <option value="financeiro">Financeiro</option>
          </Select>
        </Field>
        <Field label="Principal">
          <Select value={contact.is_primary ? 'sim' : 'nao'} onChange={(event) => onChange(index, { is_primary: event.target.value === 'sim' })}>
            <option value="nao">Nao</option>
            <option value="sim">Sim</option>
          </Select>
        </Field>
      </div>
    </div>
  )
}
