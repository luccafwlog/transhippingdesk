// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
// Stable identities: PortalProfile's load effect depends on `overview`, so a fresh
// object per render would re-trigger the effect in a loop past test teardown.
const auth = vi.hoisted(() => ({ overview: { contact_email: 'fallback@example.com' }, refreshOverview: vi.fn() }))

vi.mock('../../hooks/usePortalAuth', () => ({
  usePortalAuth: () => auth,
}))
vi.mock('../../services/portalBilling', () => ({
  portalGetProfile: getProfile,
  portalUpdateProfile: vi.fn(),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

import { PortalProfile } from '../PortalProfile'

it('shows a load error and disables editing when the profile cannot be loaded', async () => {
  getProfile.mockRejectedValueOnce(new Error('Perfil indisponivel'))
  render(<PortalProfile />)

  await waitFor(() => expect(screen.getByText('Perfil indisponivel')).toBeTruthy())
  expect((screen.getByRole('button', { name: 'Salvar alteracoes' }) as HTMLButtonElement).disabled).toBe(true)
})
