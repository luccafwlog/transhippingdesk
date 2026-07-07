// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const updateProfile = vi.hoisted(() => vi.fn())
// Stable identities: PortalProfile's load effect depends on `overview`, so a fresh
// object per render would re-trigger the effect in a loop past test teardown.
const auth = vi.hoisted(() => ({ overview: { contact_email: 'fallback@example.com' }, refreshOverview: vi.fn() }))

vi.mock('../../hooks/usePortalAuth', () => ({
  usePortalAuth: () => auth,
}))
vi.mock('../../services/portalBilling', () => ({
  portalGetProfile: getProfile,
  portalUpdateProfile: updateProfile,
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

import { PortalProfile } from '../PortalProfile'

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PortalProfile />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getProfile.mockReset()
  updateProfile.mockReset()
  auth.refreshOverview.mockReset()
  auth.overview = { contact_email: 'fallback@example.com' }
})

it('shows a load error and disables editing when the profile cannot be loaded', async () => {
  getProfile.mockRejectedValueOnce(new Error('Perfil indisponivel'))
  renderProfile()

  await waitFor(() => expect(screen.getByText('Falha ao carregar perfil. Tente novamente em instantes.')).toBeTruthy())
  expect(screen.queryByText('Perfil indisponivel')).toBeNull()
  expect((screen.getByRole('button', { name: 'Salvar alteracoes' }) as HTMLButtonElement).disabled).toBe(true)
})

it('preserva edicao local quando o overview muda depois da hidratacao', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: '', city: '', state: '', zip: '' })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <PortalProfile />
    </QueryClientProvider>,
  )

  const email = await screen.findByDisplayValue('perfil@example.com')
  await user.clear(email)
  await user.type(email, 'editado@example.com')

  auth.overview = { contact_email: 'novo-overview@example.com' }
  rerender(
    <QueryClientProvider client={queryClient}>
      <PortalProfile />
    </QueryClientProvider>,
  )

  expect(screen.getByDisplayValue('editado@example.com')).toBeTruthy()
})
