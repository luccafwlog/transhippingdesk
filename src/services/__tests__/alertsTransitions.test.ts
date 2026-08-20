import { beforeEach, expect, it, vi } from 'vitest'
import {
  createAlert,
  dismissAlertItem,
  FINANCIAL_ALERT_EVENTS,
  FINANCIAL_ALERT_TYPES,
  alertEntityLink,
  getEffectiveAlertType,
  getAlertTypeLabel,
  listFinancialAlerts,
  resolveAlertItem,
} from '../alerts'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => { rpcMock.mockReset() })

it('envia dispensa temporária ao RPC central com motivo e revisão futura', async () => {
  rpcMock.mockResolvedValue({ data: { id: 12 }, error: null })

  await expect(dismissAlertItem(12, 'aguardar retorno do armador', '2026-08-22T12:00:00Z')).resolves.toBeUndefined()
  expect(rpcMock).toHaveBeenCalledWith('dismiss_alert_item', {
    p_item_id: 12,
    p_reason: 'aguardar retorno do armador',
    p_review_at: '2026-08-22T12:00:00Z',
  })
})

it('lista os tipos financeiros ativos e exclui Portal/Demurrage após a fila real', async () => {
  const realQueuePayload = [
    { id: 1, type: 'billing_calculation_blocked', entity_type: 'bl' },
    { id: 2, type: 'billing_auto_issue_failed', entity_type: 'bl' },
    { id: 3, type: 'invoice_overdue', entity_type: 'invoice' },
    { id: 4, type: 'pix_unreconciled', entity_type: 'pix_transaction' },
    { id: 5, type: 'portal_dispute_opened', entity_type: 'demurrage_invoice' },
    { id: 6, type: 'portal_excecao_critica_fatura', entity_type: 'bl' },
    { id: 7, type: 'demurrage', entity_type: 'container' },
  ]
  rpcMock.mockResolvedValue({ data: realQueuePayload, error: null })

  await expect(listFinancialAlerts()).resolves.toEqual(realQueuePayload.slice(0, 4))
  expect(rpcMock).toHaveBeenCalledWith('list_alert_queue', { p_filter: 'active' })
})

it('expõe somente os tipos financeiros ativos do contrato', () => {
  expect(FINANCIAL_ALERT_TYPES).toEqual([
    'billing_calculation_blocked',
    'billing_auto_issue_failed',
    'invoice_overdue',
    'pix_unreconciled',
  ])

  expect(FINANCIAL_ALERT_EVENTS).toEqual({
    billing_calculation_blocked: {
      audience: ['documentacao'],
      unit: 'bl',
    },
    billing_auto_issue_failed: {
      audience: ['documentacao'],
      unit: 'bl',
    },
    invoice_overdue: {
      audience: ['documentacao'],
      unit: 'invoice',
    },
    pix_unreconciled: {
      audience: ['documentacao', 'equipamentos'],
      unit: 'pix_transaction',
    },
    portal_dispute_opened: {
      audience: ['equipamentos'],
      unit: 'demurrage_invoice',
    },
  })
  expect(FINANCIAL_ALERT_TYPES).not.toContain('portal_dispute_opened')
  expect(FINANCIAL_ALERT_TYPES).not.toContain('demurrage')
})

it('usa o upsert/resolver da fundação, com metadata opcional, para manter idempotência', async () => {
  rpcMock.mockResolvedValue({ data: { item_id: 9 }, error: null })

  await createAlert({
    type: 'invoice_overdue',
    entityType: 'invoice',
    entityId: '42',
    message: 'Fatura vencida',
    metadata: { invoice_id: 42 },
  })
  await resolveAlertItem({
    type: 'invoice_overdue',
    entityType: 'invoice',
    entityId: '42',
  })

  expect(rpcMock).toHaveBeenNthCalledWith(1, 'upsert_alert_item', {
    p_type: 'invoice_overdue',
    p_entity_type: 'invoice',
    p_entity_id: '42',
    p_message: 'Fatura vencida',
    p_source: 'client_compatibility',
    p_metadata: { invoice_id: 42 },
  })
  expect(rpcMock).toHaveBeenNthCalledWith(2, 'resolve_alert_item', {
    p_type: 'invoice_overdue',
    p_entity_type: 'invoice',
    p_entity_id: '42',
    p_source: 'client_compatibility',
    p_metadata: {},
  })
})

it('rotula eventos ativos e preserva o rótulo legado sem tratá-lo como produtor', () => {
  expect(getAlertTypeLabel(getEffectiveAlertType({ type: 'aggregate', item_type: 'pix_unreconciled' }))).toBe('PIX sem conciliação segura')
  expect(getAlertTypeLabel(getEffectiveAlertType({ type: 'demurrage' }))).toBe('Demurrage')
})

it('resolve destinos pela unidade do evento e pelo identificador canônico da invoice', () => {
  expect(alertEntityLink({ type: 'portal_dispute_opened', entity_type: 'demurrage_invoice', entity_id: '77' })).toBe('/demurrage')
  expect(alertEntityLink({ type: 'billing_calculation_blocked', entity_type: 'bl', entity_id: 'BL-77' })).toBe('/taxas-locais')
  expect(alertEntityLink({ type: 'billing_auto_issue_failed', entity_type: 'bl', entity_id: 'BL-78' })).toBe('/taxas-locais')
  expect(alertEntityLink({
    type: 'portal_excecao_critica_fatura',
    entity_type: 'bl',
    entity_id: 'BL/77',
    metadata: { invoice_id: 42 },
  })).toBe('/manifestos/BL%2F77?tab=faturamento')
  expect(alertEntityLink({
    type: 'invoice_overdue',
    entity_type: 'invoice',
    entity_id: 'INV-2026-0007',
    metadata: { invoice_id: 42, invoice_number: 'INV-2026-0007' },
  })).toBe('/taxas-locais?invoice=42')
  expect(alertEntityLink({ type: 'invoice_overdue', entity_type: 'invoice', entity_id: 'INV-2026-0007' })).toBe('/taxas-locais')
})

it('prefere item_type no payload da fundação e cai para type em payload legado', () => {
  expect(getEffectiveAlertType({ type: 'invoice_overdue' })).toBe('invoice_overdue')
  expect(getEffectiveAlertType({ type: 'aggregate', item_type: 'invoice_overdue' })).toBe('invoice_overdue')
  expect(getEffectiveAlertType({ type: 'demurrage', item_type: null })).toBe('demurrage')
  expect(getEffectiveAlertType({ type: 'demurrage' })).toBe('demurrage')
})

it('usa item_type legado para filtrar um alerta financeiro na fila', async () => {
  rpcMock.mockResolvedValue({
    data: [
      { id: 10, type: 'aggregate', item_type: 'billing_auto_issue_failed', entity_type: 'bl' },
      { id: 11, type: 'aggregate', item_type: 'portal_excecao_critica_fatura', entity_type: 'bl' },
    ],
    error: null,
  })

  await expect(listFinancialAlerts()).resolves.toEqual([
    { id: 10, type: 'aggregate', item_type: 'billing_auto_issue_failed', entity_type: 'bl' },
  ])
})
