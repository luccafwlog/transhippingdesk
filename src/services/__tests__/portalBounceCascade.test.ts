import { describe, expect, it } from 'vitest'
import { resolveBounceCascade, type BounceContact } from '../../../supabase/functions/_shared/portalBounceCascade.ts'

const primary: BounceContact = { id: 1, email: 'principal@example.com', is_primary: true }
const secondary: BounceContact = { id: 2, email: 'secundario@example.com', is_primary: false }
const alternate: BounceContact = { id: 3, email: 'alternativo@example.com', is_primary: false }

describe('cascata de bounce permanente', () => {
  it('avisa o principal quando o endereço secundário falha', () => {
    const result = resolveBounceCascade({
      contacts: [primary, secondary],
      bouncedEmail: secondary.email!,
    })

    expect(result.notificationRecipient).toEqual(primary)
    expect(result.shouldOpenAlert).toBe(false)
  })

  it('avisa o alternativo quando o endereço principal falha', () => {
    const result = resolveBounceCascade({
      contacts: [primary, alternate],
      bouncedEmail: primary.email!,
    })

    expect(result.notificationRecipient).toEqual(alternate)
    expect(result.shouldOpenAlert).toBe(false)
  })

  it('abre alerta quando não há outro contato válido', () => {
    const result = resolveBounceCascade({
      contacts: [primary, { ...alternate, email: null }, secondary],
      bouncedEmail: primary.email!,
      sharedBounceEmails: [secondary.email!],
    })

    expect(result.notificationRecipient).toBeNull()
    expect(result.shouldOpenAlert).toBe(true)
  })

  it('não escolhe contato suprimido pelo Portal como alternativa', () => {
    const result = resolveBounceCascade({
      contacts: [primary, alternate],
      bouncedEmail: primary.email!,
      portalSuppressedEmails: [alternate.email!],
    })

    expect(result.notificationRecipient).toBeNull()
    expect(result.shouldOpenAlert).toBe(true)
  })

  it('avisa contato válido quando o email em bounce não estava na lista de contatos', () => {
    const result = resolveBounceCascade({
      contacts: [primary, alternate],
      bouncedEmail: 'externo@example.com',
    })

    expect(result.notificationRecipient).toEqual(primary)
    expect(result.shouldOpenAlert).toBe(false)
  })

  it('avisa outro contato secundário quando o secundário falha e o principal já estava suprimido', () => {
    const result = resolveBounceCascade({
      contacts: [primary, secondary, alternate],
      bouncedEmail: secondary.email!,
      sharedBounceEmails: [primary.email!],
    })

    expect(result.notificationRecipient).toEqual(alternate)
    expect(result.shouldOpenAlert).toBe(false)
  })

  it('abre alerta quando o contato que originou o envio já não existe e não há contatos na lista', () => {
    const result = resolveBounceCascade({
      contacts: [],
      bouncedEmail: 'removido@example.com',
    })

    expect(result.notificationRecipient).toBeNull()
    expect(result.shouldOpenAlert).toBe(true)
  })
})

