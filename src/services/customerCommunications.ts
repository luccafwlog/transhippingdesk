import type {
  CustomerCommunicationNature,
  CustomerContact,
  CustomerContactPreference,
} from '../types/database'

export const CUSTOMER_COMMUNICATION_NATURES: readonly CustomerCommunicationNature[] = [
  'avisos_gerais',
  'avisos_operacionais',
  'documentacao',
  'demurrage',
]

export type CustomerCommunicationExcludedReason =
  | 'preferencia_desligada'
  | 'email_ausente'
  | 'suprimido_complaint'
  | 'suprimido_bounce'

export type EmailSuppressionRow = {
  email: string
  reason?: string | null
}

export type RecipientSuppressionChannel = 'portal' | 'comunicados'

type SuppressionLookupInput = {
  channel: RecipientSuppressionChannel
  sharedSuppressions?: readonly EmailSuppressionRow[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
}

export type ExcludedCustomerCommunicationRecipient = {
  contact: CustomerContact
  reason: CustomerCommunicationExcludedReason
}

export type CustomerCommunicationRecipients = {
  eligible: CustomerContact[]
  excluded: ExcludedCustomerCommunicationRecipient[]
  blocked: boolean
}

type Preference = Pick<CustomerContactPreference, 'contact_id' | 'nature' | 'enabled'>

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase()
}

function hasSuppression(
  email: string,
  suppressions: readonly EmailSuppressionRow[] | undefined,
  reason?: string,
): boolean {
  return (suppressions ?? []).some((suppression) =>
    normalizedEmail(suppression.email) === email &&
    (reason === undefined || suppression.reason === reason),
  )
}

export function getEmailSuppressionReason(
  email: string,
  input: SuppressionLookupInput,
): 'bounce_permanente' | 'complaint' | null {
  const normalized = normalizedEmail(email)

  // Bounce is global because the mailbox does not exist. A legacy complaint
  // row in the shared Portal table must not leak into Comunicados: complaints
  // are channel-specific from this foundation onward.
  if (hasSuppression(normalized, input.sharedSuppressions, 'bounce_permanente')) {
    return 'bounce_permanente'
  }

  if (
    input.channel === 'comunicados' &&
    hasSuppression(normalized, input.communicationSuppressions, 'complaint')
  ) {
    return 'complaint'
  }

  if (
    input.channel === 'portal' &&
    hasSuppression(normalized, input.sharedSuppressions, 'complaint')
  ) {
    return 'complaint'
  }

  return null
}

export function resolveCustomerCommunicationRecipients(input: {
  contacts: readonly CustomerContact[]
  nature: CustomerCommunicationNature
  preferences: readonly Preference[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
  portalSuppressions?: readonly EmailSuppressionRow[]
}): CustomerCommunicationRecipients {
  const preferences = new Map(
    input.preferences
      .filter((preference) => preference.nature === input.nature)
      .map((preference) => [preference.contact_id, preference.enabled]),
  )
  const eligible: CustomerContact[] = []
  const excluded: ExcludedCustomerCommunicationRecipient[] = []

  for (const contact of input.contacts) {
    if (preferences.get(contact.id) === false) {
      excluded.push({ contact, reason: 'preferencia_desligada' })
      continue
    }

    const email = contact.email?.trim()
    if (!email) {
      excluded.push({ contact, reason: 'email_ausente' })
      continue
    }

    const suppression = getEmailSuppressionReason(email, {
      channel: 'comunicados',
      sharedSuppressions: input.portalSuppressions,
      communicationSuppressions: input.communicationSuppressions,
    })
    if (suppression === 'complaint') {
      excluded.push({ contact, reason: 'suprimido_complaint' })
      continue
    }
    if (suppression === 'bounce_permanente') {
      excluded.push({ contact, reason: 'suprimido_bounce' })
      continue
    }

    eligible.push(contact)
  }

  return { eligible, excluded, blocked: eligible.length === 0 }
}
