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
  it('mostra navegacao para Painel, Faturas, BLs e Containers e Perfil', () => {
    render(
      <MemoryRouter initialEntries={['/portal/operacao']}>
        <PortalLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('href')).toBe('/portal')
    expect(screen.getByRole('link', { name: 'Faturas' }).getAttribute('href')).toBe('/portal/billing')
    expect(screen.getByRole('link', { name: 'BLs e Containers' }).getAttribute('href')).toBe('/portal/operacao')
    // "Perfil" aparece no header (icone) e na navegacao; ambos apontam para /portal/perfil
    expect(screen.getAllByRole('link', { name: 'Perfil' }).every((l) => l.getAttribute('href') === '/portal/perfil')).toBe(true)
    expect(screen.getByRole('link', { name: 'BLs e Containers' }).className).toContain('active')
  })
})
