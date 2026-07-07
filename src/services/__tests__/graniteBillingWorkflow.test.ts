import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calculate: vi.fn(),
  markReady: vi.fn(),
  createGranite: vi.fn(),
  createLocal: vi.fn(),
}))

vi.mock('../graniteCharges', () => ({
  calculateGraniteBlCharges: mocks.calculate,
}))
vi.mock('../charges/chargeOperationsService', () => ({
  markGraniteBlReady: mocks.markReady,
}))
vi.mock('../billing', () => ({
  createInvoiceFromGraniteBls: mocks.createGranite,
  createInvoiceFromBls: mocks.createLocal,
}))

const workflowModulePath = '../graniteBillingWorkflow'

async function loadWorkflow() {
  try {
    return await import(/* @vite-ignore */ workflowModulePath)
  } catch {
    return null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.calculate.mockResolvedValue([{ id: 1 }])
  mocks.markReady.mockResolvedValue(undefined)
  mocks.createGranite.mockResolvedValue({ invoice_id: 10 })
  mocks.createLocal.mockResolvedValue({ invoice_id: 20 })
})

describe('Granite billing workflow', () => {
  it('calculates, marks ready, then creates the Granite invoice in order', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    const result = await workflow!.calculateAndIssueGraniteInvoice({
      blId: 'GR-1',
      customerId: 7,
      actorId: 'user-1',
    })

    expect(mocks.calculate).toHaveBeenCalledWith('GR-1')
    expect(mocks.markReady).toHaveBeenCalledWith('GR-1')
    expect(mocks.createGranite).toHaveBeenCalledWith({
      graniteBlIds: ['GR-1'],
      customerId: 7,
      actorId: 'user-1',
    })
    expect(mocks.calculate.mock.invocationCallOrder[0]).toBeLessThan(mocks.markReady.mock.invocationCallOrder[0])
    expect(mocks.markReady.mock.invocationCallOrder[0]).toBeLessThan(mocks.createGranite.mock.invocationCallOrder[0])
    expect(result).toEqual({ lines: [{ id: 1 }], invoice: { invoice_id: 10 } })
  })

  it('routes a Granite operational row to the Granite invoice RPC', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    await workflow!.issueOperationalInvoice({
      blId: 'GR-2',
      cargoMode: 'granito',
      customerId: 8,
      actorId: 'user-2',
    })

    expect(mocks.createGranite).toHaveBeenCalledWith({
      graniteBlIds: ['GR-2'],
      customerId: 8,
      actorId: 'user-2',
    })
    expect(mocks.createLocal).not.toHaveBeenCalled()
  })

  it('routes non-Granite operational rows to the local ledger invoice RPC', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    await workflow!.issueOperationalInvoice({
      blId: 'BL-1',
      cargoMode: 'container',
      customerId: 9,
      actorId: 'user-3',
    })

    expect(mocks.createLocal).toHaveBeenCalledWith({
      blIds: ['BL-1'],
      customerId: 9,
      issueNow: true,
      actorId: 'user-3',
    })
    expect(mocks.createGranite).not.toHaveBeenCalled()
  })

  it('reports Granite review as unsupported instead of a false success', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    const result = await workflow!.runGraniteBatch(['GR-1', 'GR-2'], 'review')

    expect(result).toEqual({
      total: 2,
      successCount: 0,
      errorCount: 2,
      errors: [
        { blId: 'GR-1', message: 'Revisão em lote não é suportada para Granito.' },
        { blId: 'GR-2', message: 'Revisão em lote não é suportada para Granito.' },
      ],
    })
    expect(mocks.calculate).not.toHaveBeenCalled()
    expect(mocks.markReady).not.toHaveBeenCalled()
  })
})
