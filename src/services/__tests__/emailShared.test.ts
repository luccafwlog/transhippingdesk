import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from '../../../supabase/functions/_shared/email.ts'

const baseInput = {
  kind: 'convite',
  to: 'cliente@example.com',
  subject: 'Assunto',
  html: '<p>Mensagem</p>',
  text: 'Mensagem',
  idempotencyKey: 'convite:1',
  from: 'portal@example.com',
  replyTo: 'suporte@example.com',
  resendApiKey: 'resend-key',
  recordAttempt: vi.fn(async () => ({ id: 7 })),
  updateAttempt: vi.fn(async () => undefined),
  checkSuppression: vi.fn(async () => ({ suppressed: false })),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendEmail', () => {
  it.each([429, 500, 502, 503, 504])('repete status transitório %s com backoff', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }))
    const result = await sendEmail({ ...baseInput, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(baseInput.updateAttempt).toHaveBeenCalledWith(7, {
      providerMessageId: 'provider-1',
      retryCount: 1,
      status: 'aceito',
      lastError: undefined,
    })
  })

  it('não repete uma falha permanente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }))
    const result = await sendEmail({ ...baseInput, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(baseInput.updateAttempt).toHaveBeenCalledWith(7, {
      status: 'falha_permanente',
      retryCount: 0,
      lastError: 'HTTP 400',
    })
  })

  it('trata colisão de idempotência como sucesso sem chamar a Resend', async () => {
    const duplicateError = Object.assign(new Error('duplicate'), { code: '23505' })
    const recordAttempt = vi.fn().mockRejectedValue(duplicateError)
    const fetchMock = vi.fn()

    const result = await sendEmail({ ...baseInput, recordAttempt, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(baseInput.checkSuppression).toHaveBeenCalledWith('cliente@example.com')
  })

  it('aborta antes de registrar a tentativa quando o endereço está suprimido', async () => {
    const checkSuppression = vi.fn(async () => ({ suppressed: true, reason: 'bounce_permanente' }))
    const recordAttempt = vi.fn()
    const fetchMock = vi.fn()

    const result = await sendEmail({ ...baseInput, checkSuppression, recordAttempt, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: false })
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
