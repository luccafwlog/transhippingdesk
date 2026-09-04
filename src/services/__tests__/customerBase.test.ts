import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCustomerBaseRows, parseCustomerBaseRows } from '../customerBase'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

describe('customerBase import', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('reports row error when a row has no valid email', () => {
    const result = parseCustomerBaseRows([
      {
        CNPJ: '12.345.678/0001-95',
        'Razao Social': 'Empresa Sem Email',
        email: '',
      },
      {
        CNPJ: '12.345.678/0001-95',
        'Razao Social': 'Empresa Com Email',
        email: 'contato@empresa.com',
      },
    ])

    expect(result.rowErrors).toEqual([
      expect.objectContaining({
        row: 2,
        message: 'Linha sem e-mail válido.',
      }),
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].cnpj_cpf).toBe('12345678000195')
  })

  it('imports customer base and ensures contact email via RPC for each email', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [{ id: 101, cnpj_cpf: '12345678000195' }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'bls') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      return {}
    })

    mockRpc.mockResolvedValue({ data: true, error: null })

    const result = await importCustomerBaseRows([
      {
        cnpj_cpf: '12345678000195',
        name: 'Empresa Teste',
        trade_name: null,
        emails: ['contato1@empresa.com', 'contato2@empresa.com'],
        address: null,
        city: null,
        state: 'SP',
        zip: null,
      },
    ])

    expect(result.imported).toBe(1)
    expect(result.contactsCreated).toBe(2)
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith('ensure_customer_contact_email', {
      p_customer_id: 101,
      p_email: 'contato1@empresa.com',
      p_contact_name: 'Empresa Teste',
    })
    expect(mockRpc).toHaveBeenCalledWith('ensure_customer_contact_email', {
      p_customer_id: 101,
      p_email: 'contato2@empresa.com',
      p_contact_name: 'Empresa Teste',
    })
  })
})
