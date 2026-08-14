import { describe, expect, it } from 'vitest'
import { ALLOWED_ORIGINS, corsHeaders } from '../../../supabase/functions/_shared/cors.ts'

// Auditoria 2026-08-14, achado A-05: devolver a string 'null' para origem fora da
// allowlist não nega — `null` é a origem real de iframe `sandbox`, documento
// `data:` e alguns redirecionamentos, e o navegador casa
// `Access-Control-Allow-Origin: null` com ela, liberando justamente o contexto
// mais anônimo. A negação correta em CORS é a ausência do header.
describe('corsHeaders das Edge Functions', () => {
  const allowed = 'https://portal.transhippingdesk.com.br'

  it('ecoa a origem quando ela está na allowlist', () => {
    expect(ALLOWED_ORIGINS.has(allowed)).toBe(true)
    expect(corsHeaders(allowed)['Access-Control-Allow-Origin']).toBe(allowed)
  })

  it('omite o header para origem fora da allowlist, em vez de devolver "null"', () => {
    const headers = corsHeaders('https://atacante.example')
    expect(headers).not.toHaveProperty('Access-Control-Allow-Origin')
    expect(Object.values(headers)).not.toContain('null')
  })

  it('omite o header também quando não há Origin na requisição', () => {
    expect(corsHeaders(null)).not.toHaveProperty('Access-Control-Allow-Origin')
  })

  // Sem Vary, um cache compartilhado poderia servir a resposta de uma origem
  // permitida para outra origem qualquer.
  it('declara Vary: Origin em todos os casos', () => {
    expect(corsHeaders(allowed).Vary).toBe('Origin')
    expect(corsHeaders('https://atacante.example').Vary).toBe('Origin')
    expect(corsHeaders(null).Vary).toBe('Origin')
  })

  it('mantém os métodos e cabeçalhos permitidos', () => {
    const headers = corsHeaders(allowed)
    expect(headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(headers['Access-Control-Allow-Headers']).toContain('authorization')
  })
})
