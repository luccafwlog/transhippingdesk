import { describe, expect, it } from 'vitest'
import { valorSugerido } from '../depots'

describe('valorSugerido', () => {
  const local = { id: 'd1' }
  const generic = { id: 's1', depot_id: 'd1', rate_brl: 10, active: true, container_type: null, route_destino_id: null, condition: null }
  const specific = { ...generic, id: 's1', rate_brl: 25, container_type: '40HC', route_destino_id: 'd2', condition: 'material' }

  it('prefere o catálogo mais específico', () => {
    expect(valorSugerido({ local, servico: generic, tipo: '40HC', rota: 'd2', condicao: 'material', catalogo: [generic, specific] })).toBe(25)
  })

  it('retorna null quando não há combinação', () => {
    expect(valorSugerido({ local, servico: generic, tipo: '20DV', rota: 'd3', condicao: 'vazio', catalogo: [] })).toBeNull()
  })
})
