// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(() => Promise.resolve({ error: null })),
  setSession: vi.fn(() => Promise.resolve({ error: null })),
  updateUser: vi.fn(() => Promise.resolve({ error: null })),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
}))
const portal = vi.hoisted(() => ({ resolveLogin: vi.fn(() => Promise.resolve('resolvido@cliente.com')) }))

vi.mock('../../services/supabase', () => ({ supabasePortal: { auth } }))
vi.mock('../../services/portalBilling', () => ({ portalResolveLogin: portal.resolveLogin }))

import { PortalForgotPassword } from '../PortalForgotPassword'
import { PortalResetPassword } from '../PortalResetPassword'

beforeEach(() => {
  vi.clearAllMocks()
  window.location.hash = ''
})
afterEach(cleanup)

it('US-155: solicita recuperacao e confirma o envio do link', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )

  await user.type(screen.getByPlaceholderText('CNPJ ou email cadastrado'), 'cliente@empresa.com')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperacao' }))

  await waitFor(() => expect(screen.getByText('Email enviado')).toBeTruthy())
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('cliente@empresa.com', expect.any(Object))
})

it('US-156: link invalido sem tokens mostra erro', () => {
  render(
    <MemoryRouter>
      <PortalResetPassword />
    </MemoryRouter>,
  )
  expect(screen.getByText('Link de recuperacao invalido ou expirado.')).toBeTruthy()
})

it('US-156: estabelece a sessao de recovery a partir dos tokens do hash', async () => {
  window.location.hash = '#access_token=AT&refresh_token=RT&type=recovery'
  render(
    <MemoryRouter>
      <PortalResetPassword />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
  expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' })
})

it('US-157: atualiza a senha e volta para o login', async () => {
  const user = userEvent.setup()
  window.location.hash = '#access_token=AT&refresh_token=RT&type=recovery'
  render(
    <MemoryRouter initialEntries={['/portal/recuperar-senha']}>
      <Routes>
        <Route path="/portal/recuperar-senha" element={<PortalResetPassword />} />
        <Route path="/portal/login" element={<div>LOGIN PLACEHOLDER</div>} />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
  await user.type(screen.getByPlaceholderText('Minimo 8 caracteres'), 'senhaSegura1')
  await user.type(screen.getByPlaceholderText('Repita a senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))

  await waitFor(() => expect(screen.getByText('LOGIN PLACEHOLDER')).toBeTruthy())
  expect(auth.updateUser).toHaveBeenCalledWith({ password: 'senhaSegura1' })
  expect(auth.signOut).toHaveBeenCalled()
})

it('US-157: rejeita senha sem composicao minima', async () => {
  const user = userEvent.setup()
  window.location.hash = '#access_token=AT&refresh_token=RT&type=recovery'
  render(
    <MemoryRouter>
      <PortalResetPassword />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
  await user.type(screen.getByPlaceholderText('Minimo 8 caracteres'), 'senhafraca')
  await user.type(screen.getByPlaceholderText('Repita a senha'), 'senhafraca')
  await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))

  expect(screen.getByText('A senha deve ter no minimo 8 caracteres, com letra maiuscula, minuscula e numero.')).toBeTruthy()
  expect(auth.updateUser).not.toHaveBeenCalled()
})
