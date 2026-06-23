import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCustomer } from '../customers'

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

describe('atomic customer creation', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('creates the customer and contacts through one transactional RPC', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 42,
        cnpj_cpf: '12345678000195',
        name: 'Cliente Teste',
      },
      error: null,
    })

    await expect(createCustomer({
      cnpjCpf: '12.345.678/0001-95',
      name: ' Cliente Teste ',
      state: 'es',
      contacts: [{
        name: ' Financeiro ',
        email: ' financeiro@example.com ',
        purpose: 'faturamento',
        is_primary: true,
      }],
    })).resolves.toEqual(expect.objectContaining({
      id: 42,
      cnpj_cpf: '12345678000195',
    }))

    expect(mockRpc).toHaveBeenCalledWith('create_customer_with_contacts', {
      p_customer: expect.objectContaining({
        cnpj_cpf: '12345678000195',
        name: 'Cliente Teste',
        state: 'ES',
      }),
      p_contacts: [{
        name: 'Financeiro',
        email: 'financeiro@example.com',
        phone: null,
        purpose: 'faturamento',
        is_primary: true,
      }],
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('has a migration that inserts customer and contacts in one function', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const migration = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find((sql) => sql.includes('create_customer_with_contacts'))

    expect(migration).toBeDefined()
    expect(migration).toMatch(/INSERT\s+INTO\s+public\.customers/i)
    expect(migration).toMatch(/INSERT\s+INTO\s+public\.customer_contacts/i)
    expect(migration).toMatch(/SECURITY\s+INVOKER/i)
    expect(migration).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC,\s*anon/i)
    expect(migration).toMatch(/GRANT\s+EXECUTE[\s\S]*TO\s+authenticated/i)
  })
})
