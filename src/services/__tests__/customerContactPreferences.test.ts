import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateCustomerContactPreference } from '../customerContactPreferences'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom },
}))

function builder(result: { data: unknown; error: unknown }) {
  const value = {
    update: vi.fn(() => value),
    eq: vi.fn(() => value),
    select: vi.fn(() => value),
    single: vi.fn(async () => result),
  }
  return value
}

describe('preferências de contato', () => {
  beforeEach(() => mockFrom.mockReset())

  it('altera a natureza selecionada e força source interno', async () => {
    const query = builder({
      data: { contact_id: 5, nature: 'demurrage', enabled: false, source: 'interno' },
      error: null,
    })
    mockFrom.mockReturnValue(query)

    await expect(updateCustomerContactPreference({ contactId: 5, nature: 'demurrage', enabled: false })).resolves.toMatchObject({
      contact_id: 5,
      nature: 'demurrage',
      enabled: false,
      source: 'interno',
    })
    expect(query.update).toHaveBeenCalledWith({ enabled: false, source: 'interno' })
    expect(query.eq).toHaveBeenNthCalledWith(1, 'contact_id', 5)
    expect(query.eq).toHaveBeenNthCalledWith(2, 'nature', 'demurrage')
  })

  it('propaga erro do banco', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: new Error('preference unavailable') }))

    await expect(updateCustomerContactPreference({ contactId: 5, nature: 'documentacao', enabled: true })).rejects.toThrow('preference unavailable')
  })
})
