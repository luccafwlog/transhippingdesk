import { describe, expect, it } from 'vitest'
import { escapeFilterTerm } from '../utils'

describe('escapeFilterTerm', () => {
  it('mantém termos alfanuméricos normais intactos', () => {
    expect(escapeFilterTerm('CSC123')).toBe('CSC123')
    expect(escapeFilterTerm('  ACME  ')).toBe('ACME')
  })

  it('remove curingas do LIKE para evitar enumeração/DoS', () => {
    expect(escapeFilterTerm('%')).toBe('')
    expect(escapeFilterTerm('_')).toBe('')
    expect(escapeFilterTerm('a%b_c')).toBe('a b c')
  })

  it('neutraliza caracteres que quebram o parser de filtros do PostgREST', () => {
    // vírgula, parênteses, ponto, dois-pontos, aspas, asterisco e barra
    expect(escapeFilterTerm('a,b')).toBe('a b')
    expect(escapeFilterTerm('id.ilike.(x)')).toBe('id ilike  x')
    expect(escapeFilterTerm('a:b"c*d\\e')).toBe('a b c d e')
  })

  it('input puramente malicioso colapsa para string vazia', () => {
    expect(escapeFilterTerm('%(),.:"*\\_')).toBe('')
  })
})
