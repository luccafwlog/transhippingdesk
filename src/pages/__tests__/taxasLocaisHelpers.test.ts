import { describe, expect, it } from 'vitest'
import {
  validateOverrideInput,
  validateTableInput,
  validateTableItemInput,
} from '../taxasLocaisHelpers'

describe('validateOverrideInput', () => {
  const base = {
    customerId: '5',
    chargeItemId: '9',
    overrideValue: '12,5',
    validFrom: '',
    validTo: '',
    notes: '',
  }

  it('aceita entrada válida e normaliza valor (vírgula) e datas vazias', () => {
    const r = validateOverrideInput(base)
    expect(r).toEqual({
      ok: true,
      value: {
        customerId: 5,
        chargeItemId: 9,
        overrideValue: 12.5,
        validFrom: null,
        validTo: null,
        notes: null,
      },
    })
  })

  it('exige cliente, item e valor > 0 na ordem certa', () => {
    expect(validateOverrideInput({ ...base, customerId: '0' })).toMatchObject({
      ok: false,
      error: 'Selecione um cliente para salvar o override.',
    })
    expect(validateOverrideInput({ ...base, chargeItemId: '' })).toMatchObject({
      ok: false,
      error: 'Selecione um item de taxa para salvar o override.',
    })
    expect(validateOverrideInput({ ...base, overrideValue: '0' })).toMatchObject({
      ok: false,
      error: 'Informe um valor de override valido (maior que zero).',
    })
  })

  it('rejeita vigência final anterior à inicial', () => {
    expect(
      validateOverrideInput({ ...base, validFrom: '2026-02-01', validTo: '2026-01-01' }),
    ).toMatchObject({ ok: false })
  })

  it('preserva datas e notas quando informadas', () => {
    const r = validateOverrideInput({ ...base, validFrom: '2026-01-01', validTo: '2026-02-01', notes: 'x' })
    expect(r).toMatchObject({ ok: true, value: { validFrom: '2026-01-01', validTo: '2026-02-01', notes: 'x' } })
  })
})

describe('validateTableInput', () => {
  const base = { name: 'THC', pod: 'BRSSZ', validFrom: '2026-01-01', validTo: '' }

  it('aceita entrada válida e normaliza validTo vazio para null', () => {
    expect(validateTableInput(base)).toEqual({ ok: true, value: { validTo: null } })
  })

  it('exige nome, pod e vigência inicial', () => {
    expect(validateTableInput({ ...base, name: '  ' })).toMatchObject({ ok: false, error: 'Informe o nome da tabela.' })
    expect(validateTableInput({ ...base, pod: '' })).toMatchObject({ ok: false, error: 'Informe o POD da tabela.' })
    expect(validateTableInput({ ...base, validFrom: '' })).toMatchObject({
      ok: false,
      error: 'Informe a vigência inicial da tabela.',
    })
  })

  it('rejeita validTo anterior a validFrom', () => {
    expect(validateTableInput({ ...base, validTo: '2025-12-31' })).toMatchObject({ ok: false })
  })
})

describe('validateTableItemInput', () => {
  const base = { chargeTableId: '3', name: 'BL Fee', unitValue: '100,00', sortOrder: '10' }

  it('aceita entrada válida e converte números', () => {
    expect(validateTableItemInput(base)).toEqual({
      ok: true,
      value: { chargeTableId: 3, unitValue: 100, sortOrder: 10 },
    })
  })

  it('permite valor unitário zero, mas rejeita negativo', () => {
    expect(validateTableItemInput({ ...base, unitValue: '0' })).toMatchObject({ ok: true })
    expect(validateTableItemInput({ ...base, unitValue: '-1' })).toMatchObject({
      ok: false,
      error: 'Valor unitario invalido.',
    })
  })

  it('exige tabela, nome e sort order válido', () => {
    expect(validateTableItemInput({ ...base, chargeTableId: '0' })).toMatchObject({
      ok: false,
      error: 'Selecione a tabela do item.',
    })
    expect(validateTableItemInput({ ...base, name: '' })).toMatchObject({
      ok: false,
      error: 'Informe o nome do item de taxa.',
    })
    expect(validateTableItemInput({ ...base, sortOrder: '-2' })).toMatchObject({
      ok: false,
      error: 'Sort order invalido.',
    })
  })
})
