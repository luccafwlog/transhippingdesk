import { describe, expect, it } from 'vitest'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../passwordPolicy'

describe('passwordPolicy', () => {
  it('aceita senha com 8+ caracteres, maiuscula, minuscula e numero', () => {
    expect(isValidPassword('Senha123')).toBe(true)
    expect(isValidPassword('umaSenhaLonga9')).toBe(true)
  })

  it('recusa senha curta demais', () => {
    expect(isValidPassword('Abc1234')).toBe(false)
  })

  it('recusa senha sem maiuscula, sem minuscula ou sem numero', () => {
    expect(isValidPassword('senha123')).toBe(false)
    expect(isValidPassword('SENHA123')).toBe(false)
    expect(isValidPassword('SenhaSemNumero')).toBe(false)
  })

  it('recusa entrada vazia', () => {
    expect(isValidPassword('')).toBe(false)
  })

  it('expoe a mensagem que a interface mostra', () => {
    expect(PASSWORD_RULE_MESSAGE).toContain('8')
  })
})
