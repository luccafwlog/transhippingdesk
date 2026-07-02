const ISO_CONTAINER_NUMBER = /^[A-Z]{4}\d{7}$/

export function normalizeIsoContainerNumber(value: string | null | undefined) {
  const normalized = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return ISO_CONTAINER_NUMBER.test(normalized) ? normalized : null
}
