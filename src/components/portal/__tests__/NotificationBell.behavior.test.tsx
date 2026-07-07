// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(() => Promise.resolve()),
  markAllRead: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../hooks/usePortalAuth', () => ({
  usePortalAuth: () => ({ overview: { customer_name: 'Cliente' } }),
}))
vi.mock('../../../hooks/usePortalNotifications', () => ({
  usePortalNotifications: () => ({
    data: [
      { id: 1, type: 'invoice_issued', title: 'Nova fatura', message: 'Abra a fatura.', link: '/portal/billing?invoice=10', read: false },
      { id: 2, type: 'dispute_responded', title: 'Disputa respondida', message: 'Veja a resposta.', link: null, read: true },
    ],
    isLoading: false,
  }),
  usePortalUnreadCount: () => ({ data: 3 }),
  usePortalMarkRead: () => ({ mutateAsync: mocks.markRead }),
  usePortalMarkAllRead: () => ({ mutateAsync: mocks.markAllRead }),
}))

import { NotificationBell } from '../NotificationBell'

function renderBell() {
  render(
    <MemoryRouter initialEntries={['/portal']}>
      <NotificationBell />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('US-173: mostra o contador de nao lidas e lista as notificacoes', async () => {
  const user = userEvent.setup()
  renderBell()

  // badge com a contagem
  expect(screen.getByRole('button', { name: 'Notificacoes (3 nao lidas)' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Notificacoes (3 nao lidas)' }))
  expect(screen.getByText('Nova fatura')).toBeTruthy()
  expect(screen.getByText('Disputa respondida')).toBeTruthy()
})

it('US-174: marca uma notificacao como lida ao seleciona-la', async () => {
  const user = userEvent.setup()
  renderBell()

  await user.click(screen.getByRole('button', { name: 'Notificacoes (3 nao lidas)' }))
  await user.click(screen.getByRole('button', { name: /Nova fatura/ }))

  expect(mocks.markRead).toHaveBeenCalledWith(1)
})

it('US-174: marca todas como lidas pelo cabecalho', async () => {
  const user = userEvent.setup()
  renderBell()

  await user.click(screen.getByRole('button', { name: 'Notificacoes (3 nao lidas)' }))
  await user.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))

  expect(mocks.markAllRead).toHaveBeenCalledTimes(1)
})

it('fecha o dropdown com Escape e expõe estado expandido', async () => {
  const user = userEvent.setup()
  renderBell()

  const button = screen.getByRole('button', { name: 'Notificacoes (3 nao lidas)' })
  expect(button.getAttribute('aria-haspopup')).toBe('menu')
  expect(button.getAttribute('aria-expanded')).toBe('false')

  await user.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Nova fatura')).toBeTruthy()

  await user.keyboard('{Escape}')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Nova fatura')).toBeNull()
})
