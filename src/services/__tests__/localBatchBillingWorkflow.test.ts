import { beforeEach, describe, expect, it, vi } from 'vitest'

const markReadyAndInvoice = vi.hoisted(() => vi.fn())

vi.mock('../billing', () => ({
  markBlsReadyAndCreateInvoice: markReadyAndInvoice,
}))

const modulePath = '../localBatchBillingWorkflow'

async function loadWorkflow() {
  return import(/* @vite-ignore */ modulePath).catch(() => null)
}

beforeEach(() => {
  vi.clearAllMocks()
  markReadyAndInvoice.mockResolvedValue({ invoice_id: 50, bl_count: 2 })
})

describe('atomic local batch billing', () => {
  it('groups B/Ls by customer and promotes plus invoices each group in one RPC', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    const result = await workflow!.runAtomicLocalBatchBilling([
      { id: 'BL-1', customerId: 7 },
      { id: 'BL-2', customerId: 7 },
      { id: 'BL-3', customerId: 8 },
    ], 'user-1')

    expect(markReadyAndInvoice).toHaveBeenCalledTimes(2)
    expect(markReadyAndInvoice).toHaveBeenCalledWith({
      blIds: ['BL-1', 'BL-2'],
      customerId: 7,
      actorId: 'user-1',
    })
    expect(markReadyAndInvoice).toHaveBeenCalledWith({
      blIds: ['BL-3'],
      customerId: 8,
      actorId: 'user-1',
    })
    expect(result).toEqual({
      total: 3,
      successCount: 3,
      errorCount: 0,
      errors: [],
      invoicedCount: 3,
    })
  })

  it('reports every B/L in a failed customer transaction without partial success', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()
    markReadyAndInvoice.mockRejectedValueOnce(new Error('invoice failed'))

    const result = await workflow!.runAtomicLocalBatchBilling([
      { id: 'BL-1', customerId: 7 },
      { id: 'BL-2', customerId: 7 },
    ], 'user-1')

    expect(result.successCount).toBe(0)
    expect(result.invoicedCount).toBe(0)
    expect(result.errors).toEqual([
      { blId: 'BL-1', message: 'invoice failed' },
      { blId: 'BL-2', message: 'invoice failed' },
    ])
  })
})
