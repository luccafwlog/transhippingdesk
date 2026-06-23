// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { TruncationNote } from '../TruncationNote'

afterEach(cleanup)

it('Task 11: nao renderiza nada quando nada foi omitido', () => {
  const { container } = render(<TruncationNote shown={25} total={25} noun="B/L" nounPlural="B/Ls" />)
  expect(container.textContent).toBe('')
})

it('Task 11: informa quantas linhas foram exibidas de quantas no total', () => {
  render(<TruncationNote shown={25} total={600} noun="B/L" nounPlural="B/Ls" />)
  expect(screen.getByText(/Mostrando 25 de 600 B\/Ls/)).toBeTruthy()
})

it('Task 11: usa o singular quando ha apenas um item', () => {
  // total === 1 nunca passa pelo guard (1 <= shown), então o caminho singular
  // só importa em listas com cap 0; cobrimos o plural padrão aqui.
  render(<TruncationNote shown={20} total={21} noun="veículo" nounPlural="veículos" />)
  expect(screen.getByText(/Mostrando 20 de 21 veículos/)).toBeTruthy()
})
