import { describe, expect, it } from 'vitest'
import { voyageDisplayName, voyageLabel } from '../utils'

// `voyages.id` e chave surrogate: quem le a tela reconhece "navio / viagem".
// Este helper e o formato compartilhado por /alertas, /embarquevazios e a
// selecao de faturas consolidadas.
describe('voyageLabel', () => {
  it('monta a chave natural navio / numero da viagem', () => {
    expect(voyageLabel('MSC LUCIA', '24W', 1)).toBe('MSC LUCIA / 24W')
    expect(voyageDisplayName('MSC LUCIA', '24W')).toBe('MSC LUCIA / 24W')
  })

  it('usa o que existir quando so um dos dois veio', () => {
    expect(voyageLabel('MSC LUCIA', null, 1)).toBe('MSC LUCIA')
    expect(voyageLabel(null, '24W', 1)).toBe('24W')
    expect(voyageLabel('  MSC LUCIA  ', '  24W  ', 1)).toBe('MSC LUCIA / 24W')
  })

  it('cai no id quando nao ha chave natural, e nunca devolve vazio', () => {
    expect(voyageLabel(null, null, 1)).toBe('Viagem 1')
    expect(voyageLabel('', '   ', 42)).toBe('Viagem 42')
    expect(voyageLabel(null, null, null)).toBe('Viagem')
    expect(voyageDisplayName(null, null)).toBeNull()
  })
})
