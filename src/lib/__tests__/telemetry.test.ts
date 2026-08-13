import { afterEach, describe, expect, it, vi } from 'vitest'

import { redactUrlQueryString, reportBestEffortFailure, scrubEventValue, scrubPii } from '../telemetry'

afterEach(() => vi.restoreAllMocks())

describe('reportBestEffortFailure', () => {
  it('loga um warning estruturado sem lançar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      reportBestEffortFailure('criar alerta', new Error('boom'), { type: 'overdue' }),
    ).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    const [label, detail] = warn.mock.calls[0]
    expect(label).toBe('[best-effort] criar alerta')
    expect(detail).toMatchObject({
      type: 'overdue',
      error: { name: 'Error', message: 'boom' },
    })
  })

  it('normaliza erros do PostgREST (message/code)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportBestEffortFailure('persistir', { message: 'duplicate key', code: '23505' })
    expect(warn.mock.calls[0][1]).toMatchObject({
      error: { message: 'duplicate key', code: '23505' },
    })
  })

  it('aceita ausência de metadados', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => reportBestEffortFailure('ctx', 'falha textual')).not.toThrow()
    expect(warn.mock.calls[0][1]).toMatchObject({ error: 'falha textual' })
  })
})

describe('scrubPii', () => {
  it('redige CNPJ formatado', () => {
    expect(scrubPii('Cliente 12.345.678/0001-95 bloqueado')).toBe('Cliente [cnpj] bloqueado')
  })

  it('redige CPF formatado', () => {
    expect(scrubPii('Documento 123.456.789-09 duplicado')).toBe('Documento [cpf] duplicado')
  })

  it('redige email em mensagem estilo Postgres', () => {
    const message = 'duplicate key value violates unique constraint Key (email)=(a@b.com) already exists'
    const scrubbed = scrubPii(message)

    expect(scrubbed).toContain('[email]')
    expect(scrubbed).not.toContain('a@b.com')
  })

  it('redige sequencias nuas de 14 e 11 digitos', () => {
    expect(scrubPii('docs 12345678000195 e 12345678909')).toBe('docs [digits14] e [digits11]')
  })

  it('preserva texto sem PII', () => {
    const message = 'Erro no job 12345 para id 550e8400-e29b-41d4-a716-446655440000'
    expect(scrubPii(message)).toBe(message)
  })
})

describe('redactUrlQueryString', () => {
  // Achado 3.3 (auditoria 2026-08-12): httpContextIntegration grava
  // event.request.url = location.href antes do beforeSend rodar; telas de
  // reset/ativacao do Portal carregam o token na query string.
  it('remove a query string de uma URL com token', () => {
    expect(redactUrlQueryString('https://portal.transhippingdesk.com.br/portal/recuperar-senha?token=SEGREDO')).toBe(
      'https://portal.transhippingdesk.com.br/portal/recuperar-senha',
    )
  })

  it('preserva URL sem query string', () => {
    expect(redactUrlQueryString('https://portal.transhippingdesk.com.br/portal/login')).toBe(
      'https://portal.transhippingdesk.com.br/portal/login',
    )
  })
})

describe('scrubEventValue', () => {
  it('redige objetos aninhados e preserva escalares', () => {
    expect(scrubEventValue({
      meta: { note: 'CPF 123.456.789-09' },
      count: 2,
      ok: false,
      empty: null,
    })).toEqual({
      meta: { note: 'CPF [cpf]' },
      count: 2,
      ok: false,
      empty: null,
    })
  })
})
