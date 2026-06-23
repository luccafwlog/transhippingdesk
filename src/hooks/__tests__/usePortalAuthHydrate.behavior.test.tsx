// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const supa = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }))

vi.mock('../../services/supabase', () => ({
  supabasePortal: {
    auth: { getSession: supa.getSession, signInWithPassword: vi.fn() },
    rpc: supa.rpc,
  },
}))
vi.mock('../../services/supabaseAuth', () => ({ signOutSupabaseClient: vi.fn() }))
vi.mock('../../services/portalBilling', () => ({ portalResolveLogin: vi.fn() }))

import { PortalAuthProvider, usePortalAuth } from '../usePortalAuth'

function Probe() {
  const { overview, loading, isAuthenticated } = usePortalAuth()
  return <div data-testid="state">{loading ? 'loading' : isAuthenticated ? `auth:${overview?.customer_name}` : 'anon'}</div>
}

function renderProvider() {
  render(
    <PortalAuthProvider>
      <Probe />
    </PortalAuthProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('US-153: hidrata a sessao e carrega o overview do cliente', async () => {
  supa.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } })
  supa.rpc.mockResolvedValue({ data: { customer_id: 5, customer_name: 'ACME LTDA' }, error: null })

  renderProvider()

  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('auth:ACME LTDA'))
  expect(supa.rpc).toHaveBeenCalledWith('portal_get_session_overview_v2')
})

it('US-153: sem sessao Supabase permanece nao autenticado', async () => {
  supa.getSession.mockResolvedValue({ data: { session: null } })

  renderProvider()

  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('anon'))
  expect(supa.rpc).not.toHaveBeenCalled()
})
