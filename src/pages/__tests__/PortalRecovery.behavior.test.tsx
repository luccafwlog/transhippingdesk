// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  functions: { invoke: vi.fn(() => Promise.resolve({ data: { message: 'ok' }, error: null })) },
}))

vi.mock('../../services/supabase', () => ({ supabasePortal: { auth, functions: auth.functions } }))

import { PortalForgotPassword } from '../PortalForgotPassword'
import { PortalResetPassword } from '../PortalResetPassword'

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

it('US-155: solicita recuperacao e confirma o envio do link', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )

  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperacao' }))

  await waitFor(() => expect(screen.getByText('Email enviado')).toBeTruthy())
  expect(auth.functions.invoke).toHaveBeenCalledWith('portal-password-recovery', { body: { cnpj: '12.345.678/0001-95' } })
})

it('US-156: link invalido sem tokens mostra erro', () => {
  render(
    <MemoryRouter>
      <PortalResetPassword />
    </MemoryRouter>,
  )
  expect(screen.getByText('Link de recuperacao invalido ou expirado.')).toBeTruthy()
})

it('US-156: aceita token de recovery na query string', async () => {
  render(
    <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
      <PortalResetPassword />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
})

it('US-157: atualiza a senha e volta para o login', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
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
  expect(auth.functions.invoke).toHaveBeenCalledWith('portal-password-reset', { body: { token: 'TOKEN', password: 'senhaSegura1' } })
})

it('US-157: rejeita senha sem composicao minima', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
      <PortalResetPassword />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
  await user.type(screen.getByPlaceholderText('Minimo 8 caracteres'), 'senhafraca')
  await user.type(screen.getByPlaceholderText('Repita a senha'), 'senhafraca')
  await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))

  expect(screen.getByText('A senha deve ter no minimo 8 caracteres, com letra maiuscula, minuscula e numero.')).toBeTruthy()
  expect(auth.functions.invoke).not.toHaveBeenCalledWith('portal-password-reset', expect.anything())
})
