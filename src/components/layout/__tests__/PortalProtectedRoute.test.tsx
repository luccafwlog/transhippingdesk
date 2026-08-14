// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const portalAuth = vi.hoisted(() => ({ state: { isAuthenticated: false, loading: false } }))

vi.mock('../../../hooks/usePortalAuth', () => ({ usePortalAuth: () => portalAuth.state }))

import { PortalProtectedRoute } from '../PortalProtectedRoute'

function Destino() {
  const location = useLocation()
  return <span data-testid="destino">{`${location.pathname}${location.search}`}</span>
}

function renderEm(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route element={<PortalProtectedRoute />}>
          <Route path="/portal/perfil" element={<span data-testid="protegido">perfil</span>} />
        </Route>
        <Route path="/portal/login" element={<Destino />} />
        <Route path="/portal/confirmar-email" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  portalAuth.state = { isAuthenticated: false, loading: false }
})
afterEach(cleanup)

it('sem sessao, manda para o login', () => {
  renderEm('/portal/perfil')
  expect(screen.getByTestId('destino').textContent).toBe('/portal/login')
})

// Convites de 48h ja enviados apontam para /portal/perfil?confirm_email=. Sem
// este ramo o guard navegava para o login sem a query string e o token sumia em
// silencio -- exatamente para quem le o Email de Recuperacao sem ter a senha.
it('link antigo de confirmacao de email preserva o token na rota publica', () => {
  renderEm('/portal/perfil?confirm_email=TOKEN-ANTIGO')
  expect(screen.getByTestId('destino').textContent).toBe('/portal/confirmar-email?confirm_email=TOKEN-ANTIGO')
})

it('com sessao, o link antigo continua sendo tratado dentro do perfil', () => {
  portalAuth.state = { isAuthenticated: true, loading: false }
  renderEm('/portal/perfil?confirm_email=TOKEN-ANTIGO')
  expect(screen.getByTestId('protegido')).toBeTruthy()
})
