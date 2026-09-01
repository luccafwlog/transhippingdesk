export type BounceContact = {
  id: number
  email: string | null
  is_primary: boolean
}

export type BounceCascadeDecision = {
  bouncedContact: BounceContact | null
  notificationRecipient: BounceContact | null
  shouldOpenAlert: boolean
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function resolveBounceCascade(input: {
  contacts: readonly BounceContact[]
  bouncedEmail: string
  sharedBounceEmails?: readonly string[]
  portalSuppressedEmails?: readonly string[]
}): BounceCascadeDecision {
  const bouncedEmail = normalizeEmail(input.bouncedEmail)
  const bouncedContact = input.contacts.find((contact) =>
    contact.email !== null && normalizeEmail(contact.email) === bouncedEmail,
  ) ?? null

  const bouncedEmails = new Set((input.sharedBounceEmails ?? []).map(normalizeEmail))
  const portalSuppressedEmails = new Set((input.portalSuppressedEmails ?? []).map(normalizeEmail))
  const isValidAlternative = (contact: BounceContact) =>
    (bouncedContact ? contact.id !== bouncedContact.id : true) &&
    contact.email !== null &&
    contact.email.trim() !== '' &&
    normalizeEmail(contact.email) !== bouncedEmail &&
    !bouncedEmails.has(normalizeEmail(contact.email)) &&
    !portalSuppressedEmails.has(normalizeEmail(contact.email))

  if (!bouncedContact) {
    const fallback = input.contacts.find((contact) => contact.is_primary && isValidAlternative(contact)) ??
      input.contacts.find(isValidAlternative) ?? null
    return {
      bouncedContact: null,
      notificationRecipient: fallback,
      shouldOpenAlert: fallback === null,
    }
  }

  if (!bouncedContact.is_primary) {
    const primary = input.contacts.find((contact) => contact.is_primary && isValidAlternative(contact)) ?? null
    const fallback = primary ?? input.contacts.find((contact) => !contact.is_primary && isValidAlternative(contact)) ?? null
    return {
      bouncedContact,
      notificationRecipient: fallback,
      shouldOpenAlert: fallback === null,
    }
  }

  // Prefer a secondary contact when the primary address itself failed. The
  // fallback also supports data sets with two primary flags from old imports.
  const alternate = input.contacts.find((contact) => !contact.is_primary && isValidAlternative(contact)) ??
    input.contacts.find(isValidAlternative) ?? null
  return {
    bouncedContact,
    notificationRecipient: alternate,
    shouldOpenAlert: alternate === null,
  }
}

