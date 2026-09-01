import { describe, expect, it } from 'vitest'
import {
  getEmailSuppressionReason,
  resolveCustomerCommunicationRecipients,
} from '../customerCommunications'
import type { CustomerContact } from '../../types/database'

function contact(id: number, email: string | null, purpose = 'demurrage'): CustomerContact {
  return {
    id,
    customer_id: 99,
    name: `Contato ${id}`,
    email,
    phone: null,
    purpose,
    is_primary: id === 1,
    created_at: '2026-09-01T00:00:00Z',
  }
}

describe('resolução pura de destinatários de Comunicados', () => {
  it('retorna os quatro motivos de exclusão e mantém os elegíveis', () => {
    const result = resolveCustomerCommunicationRecipients({
      nature: 'documentacao',
      contacts: [
        contact(1, 'desligado@example.com'),
        contact(2, null),
        contact(3, 'reclamou@example.com'),
        contact(4, 'bounce@example.com'),
        contact(5, 'valido@example.com'),
      ],
      preferences: [
        { contact_id: 1, nature: 'documentacao', enabled: false },
        { contact_id: 3, nature: 'documentacao', enabled: true },
        { contact_id: 4, nature: 'documentacao', enabled: true },
        { contact_id: 5, nature: 'documentacao', enabled: true },
      ],
      communicationSuppressions: [{ email: 'RECLAMOU@example.com', reason: 'complaint' }],
      portalSuppressions: [{ email: 'BOUNCE@example.com', reason: 'bounce_permanente' }],
    })

    expect(result.eligible.map((row) => row.id)).toEqual([5])
    expect(result.excluded.map((row) => [row.contact.id, row.reason])).toEqual([
      [1, 'preferencia_desligada'],
      [2, 'email_ausente'],
      [3, 'suprimido_complaint'],
      [4, 'suprimido_bounce'],
    ])
    expect(result.blocked).toBe(false)
  })

  it('marca o cliente como bloqueado quando nenhum contato sobra', () => {
    const result = resolveCustomerCommunicationRecipients({
      nature: 'avisos_gerais',
      contacts: [contact(1, 'sem-envio@example.com')],
      preferences: [{ contact_id: 1, nature: 'avisos_gerais', enabled: false }],
    })

    expect(result.blocked).toBe(true)
    expect(result.excluded).toHaveLength(1)
  })

  it('mantém a assimetria entre complaint de canal e bounce compartilhado', () => {
    const complaint = { email: 'cliente@example.com', reason: 'complaint' }
    const bounce = { email: 'cliente@example.com', reason: 'bounce_permanente' }

    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'comunicados',
      communicationSuppressions: [complaint],
    })).toBe('complaint')
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'portal',
      communicationSuppressions: [complaint],
    })).toBeNull()
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'portal',
      sharedSuppressions: [bounce],
    })).toBe('bounce_permanente')
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'comunicados',
      sharedSuppressions: [bounce],
    })).toBe('bounce_permanente')
  })

  it('usa Natureza, não purpose, para decidir o envio', () => {
    const row = contact(1, 'demurrage@example.com', 'demurrage')
    const result = resolveCustomerCommunicationRecipients({
      nature: 'documentacao',
      contacts: [row],
      preferences: [
        { contact_id: 1, nature: 'demurrage', enabled: false },
        { contact_id: 1, nature: 'documentacao', enabled: true },
      ],
    })

    expect(result.eligible).toEqual([row])
    expect(result.excluded).toEqual([])
    expect(row.purpose).toBe('demurrage')
  })
})
