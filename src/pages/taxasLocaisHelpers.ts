// Validação/normalização pura dos formulários de Taxas Locais. As mensagens de
// erro são exibidas ao usuário, então devem permanecer estáveis.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

function toAmount(value: string) {
  return Number(String(value).replace(',', '.'))
}

// Override por cliente.

export type OverrideInput = {
  customerId: string
  chargeItemId: string
  overrideValue: string
  validFrom: string
  validTo: string
  notes: string
}

export type OverridePayload = {
  customerId: number
  chargeItemId: number
  overrideValue: number
  validFrom: string | null
  validTo: string | null
  notes: string | null
}

export function validateOverrideInput(form: OverrideInput): ValidationResult<OverridePayload> {
  const customerId = Number(form.customerId)
  const chargeItemId = Number(form.chargeItemId)
  const overrideValue = toAmount(form.overrideValue)

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return { ok: false, error: 'Selecione um cliente para salvar o override.' }
  }
  if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
    return { ok: false, error: 'Selecione um item de taxa para salvar o override.' }
  }
  if (!Number.isFinite(overrideValue) || overrideValue <= 0) {
    return { ok: false, error: 'Informe um valor de override valido (maior que zero).' }
  }
  if (form.validFrom && form.validTo && form.validTo < form.validFrom) {
    return { ok: false, error: 'A vigência final não pode ser anterior à vigência inicial.' }
  }

  return {
    ok: true,
    value: {
      customerId,
      chargeItemId,
      overrideValue,
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      notes: form.notes || null,
    },
  }
}

// Tabela de taxas.

export type TableInput = {
  name: string
  pod: string
  validFrom: string
  validTo: string
}

export function validateTableInput(form: TableInput): ValidationResult<{ validTo: string | null }> {
  if (!form.name.trim()) {
    return { ok: false, error: 'Informe o nome da tabela.' }
  }
  if (!form.pod.trim()) {
    return { ok: false, error: 'Informe o POD da tabela.' }
  }
  if (!form.validFrom) {
    return { ok: false, error: 'Informe a vigência inicial da tabela.' }
  }
  if (form.validTo && form.validTo < form.validFrom) {
    return { ok: false, error: 'Vigência final não pode ser anterior à inicial.' }
  }
  return { ok: true, value: { validTo: form.validTo || null } }
}

// Item de tabela de taxas.

export type TableItemInput = {
  chargeTableId: string
  name: string
  unitValue: string
  sortOrder: string
}

export function validateTableItemInput(
  form: TableItemInput,
): ValidationResult<{ chargeTableId: number; unitValue: number; sortOrder: number }> {
  const chargeTableId = Number(form.chargeTableId)
  const unitValue = toAmount(form.unitValue)
  const sortOrder = Number(form.sortOrder)

  if (!Number.isInteger(chargeTableId) || chargeTableId <= 0) {
    return { ok: false, error: 'Selecione a tabela do item.' }
  }
  if (!form.name.trim()) {
    return { ok: false, error: 'Informe o nome do item de taxa.' }
  }
  if (!Number.isFinite(unitValue) || unitValue < 0) {
    return { ok: false, error: 'Valor unitario invalido.' }
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, error: 'Sort order invalido.' }
  }
  return { ok: true, value: { chargeTableId, unitValue, sortOrder } }
}
