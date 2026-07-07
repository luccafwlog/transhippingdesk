// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Modal } from '../Modal'

afterEach(cleanup)

it('inclui foco adicionado depois da abertura no ciclo de Tab e restaura foco ao fechar', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()

  function Harness() {
    const [open, setOpen] = useState(false)
    const [extra, setExtra] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Abrir</button>
        <Modal open={open} title="Teste" onClose={() => { onClose(); setOpen(false) }}>
          <button type="button" onClick={() => setExtra(true)}>Adicionar</button>
          {extra ? <button type="button">Botao async</button> : null}
        </Modal>
      </>
    )
  }

  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Abrir' }))
  await user.click(screen.getByRole('button', { name: 'Adicionar' }))
  screen.getByRole('button', { name: 'Botao async' }).focus()
  await user.tab()

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar modal' }))

  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir' }))
})
