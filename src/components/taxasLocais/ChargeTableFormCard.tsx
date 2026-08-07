import type { Dispatch, SetStateAction } from 'react'
import { Save, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { EMPTY_TABLE_FORM, type ChargeTableForm } from './chargeForms'

type ChargeTableFormCardProps = {
  tableForm: ChargeTableForm
  setTableForm: Dispatch<SetStateAction<ChargeTableForm>>
  onSave: () => void
  saving: boolean
}

export function ChargeTableFormCard({ tableForm, setTableForm, onSave, saving }: ChargeTableFormCardProps) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="app-table__cell-stack">
          <h2 className="app-panel__title">{tableForm.id ? 'Editar tabela' : 'Nova tabela'}</h2>
          <div className="app-table__cell-meta">Defina o escopo principal da tarifa antes de publicar itens.</div>
        </div>
        {tableForm.id ? (
          <Button variant="ghost" type="button" onClick={() => setTableForm(EMPTY_TABLE_FORM)}>
            <X size={15} />
            Cancelar edição
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome da tabela">
          <Input
            value={tableForm.name}
            onChange={(event) => setTableForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ex: Vitoria CNTR 2026"
          />
        </Field>
        <Field label="Modo de carga">
          <Select
            value={tableForm.cargoMode}
            onChange={(event) =>
              setTableForm((current) => ({
                ...current,
                cargoMode: event.target.value as 'container' | 'carga_solta' | 'granito',
              }))
            }
          >
            <option value="container">Container</option>
            <option value="carga_solta">Carga Solta</option>
            <option value="granito">Granito</option>
          </Select>
        </Field>
        <Field label="POD">
          <Input
            value={tableForm.pod}
            onChange={(event) =>
              setTableForm((current) => ({
                ...current,
                pod: event.target.value.toUpperCase(),
              }))
            }
            placeholder="BRVIT / BRSSA"
          />
        </Field>
        <Field label="Ativa">
          <Select
            value={tableForm.active ? '1' : '0'}
            onChange={(event) =>
              setTableForm((current) => ({
                ...current,
                active: event.target.value === '1',
              }))
            }
          >
            <option value="1">Sim</option>
            <option value="0">Nao</option>
          </Select>
        </Field>
        <div className="md:col-span-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-xs text-[var(--app-muted)]">
          A vigência é informativa (ADR 0040): não decide qual tabela o cálculo
          de taxas usa. O motor aplica a tabela <strong>ativa</strong> do mesmo
          POD e modo de carga — para tirar uma tabela do ar, inative-a.
        </div>
        <Field label="Vigencia inicial">
          <Input
            type="date"
            value={tableForm.validFrom}
            onChange={(event) =>
              setTableForm((current) => ({
                ...current,
                validFrom: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Vigencia final">
          <Input
            type="date"
            value={tableForm.validTo}
            onChange={(event) =>
              setTableForm((current) => ({
                ...current,
                validTo: event.target.value,
              }))
            }
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Observações">
            <Textarea
              value={tableForm.notes}
              onChange={(event) =>
                setTableForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Escopo da tabela, versão, premissas"
            />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={onSave} loading={saving}>
          <Save size={15} />
          {tableForm.id ? 'Salvar tabela' : 'Criar tabela'}
        </Button>
      </div>
    </Card>
  )
}
