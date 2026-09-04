import { describe, expect, it, vi, beforeEach } from 'vitest'

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

import {
  fetchCustomerContactConfiguration,
  internalSaveCustomerContactConfiguration,
  deactivateCustomerContact,
  reactivateCustomerContact,
} from '../customerContactConfiguration'

describe('customerContactConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchCustomerContactConfiguration', () => {
    it('carrega contatos, caixas ativas, vínculos e supressões corretamente', async () => {
      const mockBoxes = [
        { code: 'documentacao_operacao', label: 'Documentação e Operação', sort_order: 1, active: true },
        { code: 'financeiro', label: 'Financeiro', sort_order: 2, active: true },
        { code: 'demurrage', label: 'Demurrage', sort_order: 3, active: true },
      ]
      const mockContacts = [
        {
          id: 1,
          customer_id: 10,
          name: 'Principal Contato',
          email: 'principal@empresa.com',
          phone: '11999999999',
          is_primary: true,
          deactivated_at: null,
          origin: 'interno',
        },
        {
          id: 2,
          customer_id: 10,
          name: 'Contato Suprimido',
          email: 'bounce@empresa.com',
          phone: null,
          is_primary: false,
          deactivated_at: null,
          origin: 'portal',
        },
        {
          id: 3,
          customer_id: 10,
          name: 'Contato Inativo',
          email: 'inativo@empresa.com',
          phone: null,
          is_primary: false,
          deactivated_at: '2026-08-01T12:00:00Z',
          origin: 'bl_automatico',
        },
      ]
      const mockLinks = [
        { contact_id: 1, box_code: 'documentacao_operacao' },
        { contact_id: 1, box_code: 'financeiro' },
        { contact_id: 1, box_code: 'demurrage' },
        { contact_id: 2, box_code: 'financeiro' },
        { contact_id: 3, box_code: 'documentacao_operacao' },
      ]
      const mockPortalSuppressions = [
        { email: 'bounce@empresa.com', reason: 'bounce_permanente' },
      ]
      const mockCommSuppressions = [
        { email: 'outro@empresa.com', reason: 'complaint' },
      ]

      mockFrom.mockImplementation((table: string) => {
        if (table === 'customer_communication_boxes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockBoxes, error: null }),
          }
        }
        if (table === 'customer_contacts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockContacts, error: null }),
            }),
          }
        }
        if (table === 'customer_contact_box_links') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: mockLinks, error: null }),
          }
        }
        if (table === 'portal_suppressed_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: mockPortalSuppressions, error: null }),
          }
        }
        if (table === 'customer_communication_suppressions') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: mockCommSuppressions, error: null }),
          }
        }
        throw new Error(`Tabela não mockada: ${table}`)
      })

      const config = await fetchCustomerContactConfiguration(10)

      expect(config.boxes).toHaveLength(3)
      expect(config.contacts).toHaveLength(3)

      const c1 = config.contacts.find((c) => c.id === 1)!
      expect(c1.is_primary).toBe(true)
      expect(c1.active).toBe(true)
      expect(c1.sendable).toBe(true)
      expect(c1.suppression_reason).toBeNull()
      expect(c1.box_codes).toEqual(['documentacao_operacao', 'financeiro', 'demurrage'])

      const c2 = config.contacts.find((c) => c.id === 2)!
      expect(c2.is_primary).toBe(false)
      expect(c2.active).toBe(true)
      expect(c2.sendable).toBe(false)
      expect(c2.suppression_reason).toBe('suprimido_bounce')
      expect(c2.box_codes).toEqual(['financeiro'])

      const c3 = config.contacts.find((c) => c.id === 3)!
      expect(c3.is_primary).toBe(false)
      expect(c3.active).toBe(false)
      expect(c3.sendable).toBe(false)
      expect(c3.origin).toBe('bl_automatico')
    })
  })

  describe('internalSaveCustomerContactConfiguration', () => {
    it('chama RPC com payload mapeado e justificativa', async () => {
      const mockResult = { boxes: [], contacts: [] }
      mockRpc.mockResolvedValue({ data: mockResult, error: null })

      const drafts = [
        {
          id: 1,
          name: ' Contato 1 ',
          email: ' contato1@acme.com ',
          phone: ' 1199999999 ',
          isPrimary: true,
          active: true,
          origin: 'interno',
          boxCodes: ['documentacao_operacao', 'financeiro', 'demurrage'],
        },
        {
          id: null,
          name: 'Novo Contato',
          email: 'novo@acme.com',
          phone: null,
          isPrimary: false,
          active: true,
          origin: 'interno',
          boxCodes: ['financeiro'],
        },
      ]

      await internalSaveCustomerContactConfiguration(42, drafts, 'Ajuste de faturamento')

      expect(mockRpc).toHaveBeenCalledWith('internal_save_customer_contact_configuration', {
        p_customer_id: 42,
        p_contacts: [
          {
            id: 1,
            name: 'Contato 1',
            email: 'contato1@acme.com',
            phone: '1199999999',
            is_primary: true,
            active: true,
            box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          },
          {
            id: null,
            name: 'Novo Contato',
            email: 'novo@acme.com',
            phone: null,
            is_primary: false,
            active: true,
            box_codes: ['financeiro'],
          },
        ],
        p_justification: 'Ajuste de faturamento',
      })
    })

    it('propaga erro retornado pelo banco (ex. duplicidade ou integridade de caixas)', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'E-mail ja cadastrado para o contato 1' },
      })

      await expect(
        internalSaveCustomerContactConfiguration(42, [
          {
            id: null,
            name: 'Dup',
            email: 'dup@acme.com',
            phone: null,
            isPrimary: false,
            active: true,
            origin: 'interno',
            boxCodes: ['financeiro'],
          },
        ]),
      ).rejects.toMatchObject({ code: '23505' })
    })
  })

  describe('deactivateCustomerContact e reactivateCustomerContact', () => {
    it('desativa contato marcando active: false sem remover do payload', async () => {
      mockRpc.mockResolvedValue({ data: { boxes: [], contacts: [] }, error: null })

      const current = [
        {
          id: 1,
          name: 'Principal',
          email: 'p@acme.com',
          phone: null,
          isPrimary: true,
          active: true,
          origin: 'interno',
          boxCodes: ['documentacao_operacao', 'financeiro', 'demurrage'],
        },
        {
          id: 2,
          name: 'Adicional',
          email: 'a@acme.com',
          phone: null,
          isPrimary: false,
          active: true,
          origin: 'interno',
          boxCodes: ['financeiro'],
        },
      ]

      await deactivateCustomerContact(42, 2, current, 'Contato saiu da empresa')

      expect(mockRpc).toHaveBeenCalledWith('internal_save_customer_contact_configuration', expect.objectContaining({
        p_customer_id: 42,
        p_contacts: expect.arrayContaining([
          expect.objectContaining({ id: 2, active: false }),
        ]),
        p_justification: 'Contato saiu da empresa',
      }))
    })

    it('reativa contato marcando active: true no mesmo id', async () => {
      mockRpc.mockResolvedValue({ data: { boxes: [], contacts: [] }, error: null })

      const current = [
        {
          id: 1,
          name: 'Principal',
          email: 'p@acme.com',
          phone: null,
          isPrimary: true,
          active: true,
          origin: 'interno',
          boxCodes: ['documentacao_operacao', 'financeiro', 'demurrage'],
        },
        {
          id: 2,
          name: 'Adicional Retornou',
          email: 'a@acme.com',
          phone: null,
          isPrimary: false,
          active: false,
          origin: 'interno',
          boxCodes: ['financeiro'],
        },
      ]

      await reactivateCustomerContact(42, 2, current, 'Contato retornou')

      expect(mockRpc).toHaveBeenCalledWith('internal_save_customer_contact_configuration', expect.objectContaining({
        p_customer_id: 42,
        p_contacts: expect.arrayContaining([
          expect.objectContaining({ id: 2, active: true }),
        ]),
        p_justification: 'Contato retornou',
      }))
    })
  })
})
