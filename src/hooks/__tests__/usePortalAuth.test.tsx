// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, signInWithPassword, signOut, portalResolveLogin } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  portalResolveLogin: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabasePortal: {
    auth: {
      getSession,
      signInWithPassword,
      signOut,
    },
    rpc: vi.fn(),
  },
}))

vi.mock('../../services/portalBilling', () => ({
  portalResolveLogin,
}))

import { PortalAuthProvider, usePortalAuth } from '../usePortalAuth'

function wrapper({ children }: { children: ReactNode }) {
  return <PortalAuthProvider>{children}</PortalAuthProvider>
}

describe('usePortalAuth', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } })
    signInWithPassword.mockReset()
    signOut.mockReset()
    portalResolveLogin.mockReset()
  })

  it('normaliza falha do resolver anonimo de CNPJ antes do login', async () => {
    const rawError = Object.assign(new Error('Nenhuma conta de portal encontrada para este CNPJ.'), { code: '28000' })
    portalResolveLogin.mockRejectedValue(rawError)

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.signIn('12.345.678/0001-95', 'senha-secreta')).rejects.toThrow(
      'Credenciais invalidas para o portal do cliente.',
    )
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('preserva codigo P0429 do resolver anonimo para a tela mostrar rate limit', async () => {
    const rateLimitError = Object.assign(new Error('Muitas tentativas.'), { code: 'P0429' })
    portalResolveLogin.mockRejectedValue(rateLimitError)

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.signIn('12.345.678/0001-95', 'senha-secreta')).rejects.toMatchObject({ code: 'P0429' })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })
})
