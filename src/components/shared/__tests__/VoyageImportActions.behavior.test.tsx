// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn() } }))

import { VoyageImportActions } from '../VoyageImportActions'

afterEach(cleanup)

it('US-223: renderiza as acoes de importacao rapida escopadas na viagem', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['cntr', 'bb', 'granite', 'baplie']}
    />,
  )

  expect(screen.getByRole('button', { name: /Manifesto CNTR/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Manifesto BB/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Manifesto Granito/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Baplie EDI/ })).toBeTruthy()
})
