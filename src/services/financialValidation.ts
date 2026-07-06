import { z } from 'zod'

import { toNumber } from '../lib/utils'

const paymentMethods = ['pix', 'ted', 'doc', 'boleto', 'outros'] as const
const discountTypes = ['comercial', 'datas', 'cortesia', 'acordo', 'erro'] as const
const discountModes = ['percent', 'fixed'] as const

function blankToNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function parseNumberInput(value: unknown) {
  return toNumber(value) ?? Number.NaN
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

const positiveNumberSchema = z.preprocess(
  parseNumberInput,
  z.number()
    .refine(Number.isFinite, 'Valor invalido.')
    .refine((value) => value > 0, 'Valor deve ser maior que zero.'),
)

const optionalNonNegativeNumberSchema = z.preprocess(
  (value) => (blankToNull(value) === null ? null : parseNumberInput(value)),
  z.number()
    .refine(Number.isFinite, 'Valor invalido.')
    .refine((value) => value >= 0, 'Valor nao pode ser negativo.')
    .nullable(),
)

const requiredDateSchema = z.string()
  .trim()
  .min(1, 'Data obrigatoria.')
  .refine(isValidDateOnly, 'Data invalida.')

const optionalDateSchema = z.preprocess(blankToNull, requiredDateSchema.nullable())

const nullableTextSchema = z.preprocess(
  (value) => String(value ?? '').trim(),
  z.string().transform((value) => value || null),
)

export const paymentFormSchema = z.object({
  amountBrl: positiveNumberSchema,
  paymentMethod: z.enum(paymentMethods),
  paidAt: requiredDateSchema,
})

export const manualInvoiceChargeSchema = z.object({
  description: z.string().trim().min(1, 'Descricao obrigatoria.'),
  quantity: positiveNumberSchema,
  unitValueBrl: positiveNumberSchema,
})

export const demurrageDiscountSchema = z.object({
  discount_type: z.preprocess(blankToNull, z.enum(discountTypes).nullable()),
  discount_value: optionalNonNegativeNumberSchema,
  discount_mode: z.enum(discountModes),
  discount_justification: nullableTextSchema,
  discount_approver: nullableTextSchema,
}).superRefine((value, ctx) => {
  if (value.discount_mode === 'percent' && value.discount_value != null && value.discount_value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['discount_value'],
      message: 'Percentual de desconto deve ficar entre 0 e 100.',
    })
  }
})

export const demurrageDatesSchema = z.object({
  discharge: requiredDateSchema,
  ret: optionalDateSchema,
}).refine((value) => !value.ret || value.ret >= value.discharge, {
  path: ['ret'],
  message: 'Data de devolucao nao pode ser anterior a descarga.',
})

export function formatValidationError(error: unknown, fallback = 'Dados invalidos.') {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback
  }
  if (error instanceof Error) return error.message || fallback
  return fallback
}
