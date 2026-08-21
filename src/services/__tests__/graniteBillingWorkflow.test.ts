import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calculate: vi.fn(),
  markReady: vi.fn(),
}))

vi.mock('../graniteCharges', () => ({
  calculateGraniteBlCharges: mocks.calculate,
}))
vi.mock('../charges/chargeOperationsService', () => ({
  markGraniteBlReady: mocks.markReady,
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
})

describe('Granite billing workflow', () => {
  it('não expõe funções capazes de emitir invoice para Granito', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()
    expect(Object.keys(workflow!).sort()).toEqual(['runGraniteBatch'])
  })

  it('marks Granite as ready when requested', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    const result = await workflow!.runGraniteBatch(['GR-1', 'GR-2'], 'ready')

    expect(result).toEqual({ total: 2, successCount: 2, errorCount: 0, errors: [] })
    expect(mocks.calculate).not.toHaveBeenCalled()
    expect(mocks.markReady).toHaveBeenNthCalledWith(1, 'GR-1')
    expect(mocks.markReady).toHaveBeenNthCalledWith(2, 'GR-2')
  })

})
