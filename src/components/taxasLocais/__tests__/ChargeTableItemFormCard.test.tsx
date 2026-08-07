// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChargeTableItemFormCard } from '../ChargeTableItemFormCard'
import { EMPTY_TABLE_ITEM_FORM } from '../chargeForms'

afterEach(cleanup)

// Achado 10 da review da PR 501: migration 264 sinaliza itens com
// applicationBasis='teu' como review_required, mas nao os remove do banco.
// Editar um item existente nesse estado precisa continuar mostrando um
// <select> valido (com a opção legada), em vez de ficar em branco/invalido.
describe('ChargeTableItemFormCard — opção TEU legada', () => {
  it('nao inclui a opcao teu quando o item atual nao e teu', () => {
    render(
      <ChargeTableItemFormCard
        tables={[]}
        tableItemForm={{ ...EMPTY_TABLE_ITEM_FORM, applicationBasis: 'bl' }}
        setTableItemForm={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />,
    )
    expect(screen.queryByRole('option', { name: /TEU/ })).toBeNull()
  })

  it('inclui uma opcao teu (desabilitada) quando o item atual e teu, para o select renderizar valido', () => {
    render(
      <ChargeTableItemFormCard
        tables={[]}
        tableItemForm={{ ...EMPTY_TABLE_ITEM_FORM, applicationBasis: 'teu' }}
        setTableItemForm={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />,
    )
    const option = screen.getByRole('option', { name: /TEU/ }) as HTMLOptionElement
    expect(option).toBeDefined()
    expect(option.disabled).toBe(true)
    const select = option.closest('select')
    expect(select?.value).toBe('teu')
  })
})
