import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calculate: vi.fn(),
}))

vi.mock('../graniteCharges', () => ({
  calculateGraniteBlCharges: mocks.calculate,
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
})

describe('Granite billing workflow', () => {
  it('não expõe funções capazes de emitir invoice para Granito', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()
    expect(Object.keys(workflow!).sort()).toEqual(['runGraniteBatch'])
  })

  it('recalcula apenas quantidades operacionais, sem marcar pronto para faturamento', async () => {
    const workflow = await loadWorkflow()
    expect(workflow).not.toBeNull()

    const result = await workflow!.runGraniteBatch(['GR-1', 'GR-2'])

    expect(result).toEqual({ total: 2, successCount: 2, errorCount: 0, errors: [] })
    expect(mocks.calculate).toHaveBeenNthCalledWith(1, 'GR-1')
    expect(mocks.calculate).toHaveBeenNthCalledWith(2, 'GR-2')
  })

  it('não expõe uma ação ready_for_billing nem um marcador financeiro', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../graniteBillingWorkflow.ts', import.meta.url), 'utf8'))

    expect(source).not.toContain('markGraniteBlReady')
    expect(source).not.toContain("'ready'")
    expect(source).not.toContain('ready_for_billing')
  })

})
