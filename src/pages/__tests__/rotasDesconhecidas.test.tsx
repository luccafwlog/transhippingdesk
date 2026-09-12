// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { NaoEncontrado } from '../NaoEncontrado'
import { ADMIN_TABS, DEFAULT_ADMIN_TAB, isAdminTab } from '../adminTabs'
import { routeTitle } from '../../lib/pageTitle'

afterEach(cleanup)

// Antes, o catch-all do App mandava qualquer rota desconhecida para /painel com
// `replace`: o usuário era realocado sem aviso e nem o Back devolvia a URL.
describe('rota desconhecida', () => {
  it('identifica o endereço acessado em vez de realocar em silêncio', () => {
    render(
      <MemoryRouter initialEntries={['/rota-que-nao-existe']}>
        <Routes>
          <Route path="*" element={<NaoEncontrado />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Página não encontrada')).toBeTruthy()
    expect(screen.getByText('/rota-que-nao-existe')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voltar para o Painel' }).getAttribute('href')).toBe('/painel')
  })
})

describe('abas de Administração em sub-rota', () => {
  it('reconhece todos os slugs publicados e recusa os demais', () => {
    for (const { slug } of ADMIN_TABS) expect(isAdminTab(slug)).toBe(true)
    expect(isAdminTab('usuários')).toBe(false) // acentuado: era a chave antiga
    expect(isAdminTab('inexistente')).toBe(false)
    expect(isAdminTab(undefined)).toBe(false)
    expect(isAdminTab(DEFAULT_ADMIN_TAB)).toBe(true)
  })

  it('usa slugs seguros para URL', () => {
    for (const { slug } of ADMIN_TABS) {
      expect(slug).toBe(encodeURIComponent(slug))
    }
  })

  it('dá título próprio a cada aba e à tela sem sufixo', () => {
    expect(routeTitle('/admin')).toBe('Administração · Transhipping Desk')
    for (const { slug, label } of ADMIN_TABS) {
      expect(routeTitle(`/admin/${slug}`)).toBe(`Administração · ${label} · Transhipping Desk`)
    }
  })
})
