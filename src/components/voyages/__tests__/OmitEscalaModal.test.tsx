// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mutateAsync, useAuthMock } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('../../../hooks/useTransshipments', () => ({
  useOmitEscala: () => ({ mutateAsync, isError: false, isPending: false }),
}))

import { OmitEscalaModal } from '../OmitEscalaModal'

afterEach(cleanup)

describe('OmitEscalaModal', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1' } })
    mutateAsync.mockResolvedValue(undefined)
  })

  it('exibe o resumo e só executa a omissão após confirmação explícita', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <OmitEscalaModal
        open
        onClose={onClose}
        voyageId={7}
        omittedPod="Salvador"
        candidateDischargePods={["Vitória"]}
        blCount={3}
      />,
    )

    await user.type(screen.getByLabelText('Motivo (opcional)'), 'Armador alterou a rota')
    await user.click(screen.getByRole('button', { name: 'Omitir escala' }))

    expect(mutateAsync).not.toHaveBeenCalled()
    const confirmButton = screen.getByRole('button', { name: 'Confirmar omissão' })
    expect(screen.getByText('Salvador → Vitória · 3 B/Ls afetados · clientes com vínculo serão notificados')).toBeTruthy()
    expect(document.activeElement).toBe(confirmButton)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    const omitButton = screen.getByRole('button', { name: 'Omitir escala' })
    expect(document.activeElement).toBe(omitButton)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    await user.click(omitButton)
    await user.click(screen.getByRole('button', { name: 'Confirmar omissão' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      voyageId: 7,
      omittedPod: 'Salvador',
      dischargePod: 'Vitória',
      reason: 'Armador alterou a rota',
      onwardVesselName: null,
      onwardCarrier: null,
      onwardVoyageNumber: null,
      onwardEtd: null,
      onwardEta: null,
      changedBy: 'user-1',
    }))
    expect(onClose).toHaveBeenCalled()
  })
})
