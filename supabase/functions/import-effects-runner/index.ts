// S05 — runner da fila de efeitos de import.
//
// O contrato de claim/complete ja e seguro no banco. O runner fica pausado ate
// que os consumidores de cada effect_kind tenham sido ligados e validados em
// Preview; uma chamada enquanto pausado nao toma lease nem altera a fila.

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const expectedSecret = Deno.env.get('IMPORT_EFFECTS_CRON_SECRET') ?? ''
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return json(401, { error: 'unauthorized' })
  }

  // Keep this fail-closed until handlers for physical flags, provisional
  // charges and billing are enabled together. In particular, Demurrage is not
  // emitted automatically before its server-side snapshot contract (S08-B).
  if (Deno.env.get('IMPORT_EFFECTS_RUNNER_ENABLED') !== 'true') {
    return json(503, { status: 'paused', reason: 'consumers_not_activated' })
  }

  return json(503, { status: 'paused', reason: 'consumer_handlers_pending' })
})
