// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  functions: { invoke: vi.fn(() => Promise.resolve<{ data: unknown; error: unknown }>({ data: { confirmed: true }, error: null })) },
}))

vi.mock('../../services/supabase', () => ({ supabasePortal: { auth, functions: auth.functions } }))

import { PortalConfirmarEmail } from '../PortalConfirmarEmail'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('confirma o novo email sem exigir sessao do Portal', async () => {
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=TOKEN']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Email confirmado' })).toBeTruthy())
  expect(auth.functions.invoke).toHaveBeenCalledWith('portal-recovery-email-change', {
    body: { action: 'confirm', token: 'TOKEN' },
  })
})

it('aceita o parametro antigo confirm_email dos links ja enviados', async () => {
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?confirm_email=ANTIGO']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() =>
    expect(auth.functions.invoke).toHaveBeenCalledWith('portal-recovery-email-change', {
      body: { action: 'confirm', token: 'ANTIGO' },
    }),
  )
})

it('remove o token da URL apos a leitura, sem perder a confirmacao', async () => {
  function LocationProbe() {
    const location = useLocation()
    return <span data-testid="search">{location.search}</span>
  }

  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=TOKEN']}>
      <Routes>
        <Route
          path="/portal/confirmar-email"
          element={
            <>
              <PortalConfirmarEmail />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  expect(auth.functions.invoke).toHaveBeenCalledTimes(1)
})

it('link sem token mostra erro em vez de chamar a Edge Function', () => {
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  expect(screen.getByText(/Link de confirmacao invalido ou expirado/)).toBeTruthy()
  expect(auth.functions.invoke).not.toHaveBeenCalled()
})

it('token recusado pela Edge Function vira mensagem de link invalido', async () => {
  auth.functions.invoke.mockResolvedValueOnce({ data: null, error: { message: 'Link inválido ou expirado.' } })

  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=EXPIRADO']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText(/Link de confirmacao invalido ou expirado/)).toBeTruthy())
})
