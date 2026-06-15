// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/usePortalAuth', () => ({
  usePortalAuth: () => ({
    overview: { customer_name: 'Cliente Portal', customer_cnpj_cpf: '12345678000195' },
    signOut: vi.fn(),
  }),
}))

vi.mock('../../../hooks/usePortalNotifications', () => ({
  usePortalUnreadCount: () => ({ data: 0 }),
  usePortalNotifications: () => ({ data: [], isLoading: false }),
  usePortalMarkRead: () => ({ mutate: vi.fn() }),
  usePortalMarkAllRead: () => ({ mutate: vi.fn() }),
}))

import { PortalLayout } from '../PortalLayout'

afterEach(cleanup)

describe('PortalLayout', () => {
  it('mostra navegacao para faturas e operacao', () => {
    render(
      <MemoryRouter initialEntries={['/portal/operacao']}>
        <PortalLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Faturas' }).getAttribute('href')).toBe('/portal/billing')
    expect(screen.getByRole('link', { name: 'Operacao' }).getAttribute('href')).toBe('/portal/operacao')
    expect(screen.getByRole('link', { name: 'Operacao' }).className).toContain('app-tab--active')
  })
})
