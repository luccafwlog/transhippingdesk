import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateCustomerWithAudit } from '../customers'

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

const original = {
  name: 'Cliente Antigo',
  trade_name: null,
  address: null,
  city: 'Santos',
  state: 'SP',
  zip: null,
  notes: null,
  payment_terms_days: 10,
  discount_pct: 0,
  commercial_notes: null,
}

describe('atomic customer update with audit', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('uses one transactional RPC for the customer update and audit rows', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null })

    await expect(updateCustomerWithAudit({
      customerId: 42,
      original,
      values: { ...original, name: 'Cliente Novo', payment_terms_days: 20 },
      changedBy: '11111111-1111-1111-1111-111111111111',
      justification: 'Atualizacao cadastral',
    })).resolves.toBe(true)

    expect(mockRpc).toHaveBeenCalledWith('update_customer_with_audit', {
      p_customer_id: 42,
      p_updates: {
        name: 'Cliente Novo',
        payment_terms_days: 20,
      },
      p_changed_by: '11111111-1111-1111-1111-111111111111',
      p_justification: 'Atualizacao cadastral',
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('has a migration that performs the update and audit insert in one function', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const migration = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find((sql) => sql.includes('update_customer_with_audit'))

    expect(migration).toBeDefined()
    expect(migration).toMatch(/UPDATE\s+public\.customers/i)
    expect(migration).toMatch(/INSERT\s+INTO\s+public\.audit_logs/i)
    expect(migration).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC,\s*anon/i)
    expect(migration).toMatch(/GRANT\s+EXECUTE[\s\S]*TO\s+authenticated/i)
  })
})
