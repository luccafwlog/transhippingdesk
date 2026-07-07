import { describe, expect, it } from 'vitest'
import { portalErrorMessage } from '../portalErrorMessage'

describe('portalErrorMessage', () => {
  it('mapeia codigos e erros conhecidos sem vazar mensagens cruas', () => {
    expect(portalErrorMessage(Object.assign(new Error('raw limit'), { code: 'P0429' }), 'Falha generica.')).toBe(
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    )
    expect(portalErrorMessage(Object.assign(new Error('raw session'), { code: '28000' }), 'Falha generica.')).toBe(
      'Sua sessao expirou. Entre novamente para continuar.',
    )
    expect(portalErrorMessage(new Error('New password should be different from the old password.'), 'Falha generica.')).toBe(
      'A nova senha deve ser diferente da senha atual.',
    )
    expect(portalErrorMessage(new Error('detalhe interno do banco'), 'Falha generica.')).toBe('Falha generica.')
  })
})
