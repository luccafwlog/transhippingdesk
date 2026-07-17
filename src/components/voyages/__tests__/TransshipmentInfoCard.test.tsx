// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mutateAsync, useVoyageTransshipments, useUpdateVoyageOmission } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useVoyageTransshipments: vi.fn(),
  useUpdateVoyageOmission: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useTransshipments', () => ({ useVoyageTransshipments, useUpdateVoyageOmission }))

import { TransshipmentInfoCard } from '../TransshipmentInfoCard'

describe('TransshipmentInfoCard', () => {
  afterEach(cleanup)
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined)
    useUpdateVoyageOmission.mockReturnValue({ mutateAsync, isPending: false, isError: false })
    useVoyageTransshipments.mockReturnValue({
      data: {
        omissions: [{
          id: 9,
          voyageId: 2,
          omittedPod: 'VITÓRIA',
          dischargePod: 'SANTOS',
          reason: null,
          onwardVesselName: 'COSCO STAR',
          onwardCarrier: null,
          onwardVoyageNumber: 'T-1',
          onwardEtd: null,
          onwardEta: '2026-07-25T00:00:00Z',
        }],
        transshipments: [],
      },
    })
  })

  it('exibe os dados globais e mantém campos desconhecidos visíveis como travessão', () => {
    render(<TransshipmentInfoCard voyageId={2} />)

    expect(screen.getByText('Informações de Transbordo')).toBeTruthy()
    expect(screen.getByText('COSCO STAR')).toBeTruthy()
    expect(screen.getByText('T-1')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('abre edição e complementa o registro global', async () => {
    render(<TransshipmentInfoCard voyageId={2} />)

    fireEvent.click(screen.getByRole('button', { name: 'Complementar' }))
    fireEvent.change(screen.getByLabelText('Armador de Transbordo'), { target: { value: 'COSCO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      omissionId: 9,
      onwardCarrier: 'COSCO',
      changedBy: 'user-1',
    })))
  })
})
