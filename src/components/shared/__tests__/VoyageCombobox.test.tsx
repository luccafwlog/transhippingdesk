// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

const mocks = vi.hoisted(() => ({
  useVoyageOptions: vi.fn(),
}))

vi.mock('../../../hooks/useBls', () => ({
  useVoyageOptions: mocks.useVoyageOptions,
}))

import { VoyageCombobox } from '../VoyageCombobox'

const voyages = [
  { id: 7, voyage_number: '123N', vessel: { name: 'NAVIO VERDE' } },
  { id: 8, voyage_number: '456S', vessel: { name: 'NAVIO AZUL' } },
]

beforeEach(() => {
  mocks.useVoyageOptions.mockReturnValue({ data: voyages })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VoyageCombobox', () => {
  it('filtra por navio e seleciona a viagem', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<VoyageCombobox required onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'verde')

    const option = await screen.findByText('NAVIO VERDE / 123N')
    expect(screen.queryByText('NAVIO AZUL / 456S')).toBeNull()

    await user.click(option)

    expect(onSelect).toHaveBeenCalledWith(7)
  })

  it('em modo clearable, limpar o campo seleciona todas as viagens', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<VoyageCombobox clearable initialValue="NAVIO VERDE / 123N" onSelect={onSelect} />)

    await user.clear(screen.getByRole('combobox'))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })

  it('em modo required, editar o texto invalida a viagem selecionada', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<VoyageCombobox required onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'verde')
    await user.click(await screen.findByText('NAVIO VERDE / 123N'))
    expect(onSelect).toHaveBeenCalledWith(7)

    await user.clear(screen.getByRole('combobox'))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })

  it('refaz sugestoes quando as viagens chegam depois da digitacao', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mocks.useVoyageOptions.mockReturnValue({ data: [] })

    const { rerender } = render(<VoyageCombobox required onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'verde')
    await screen.findByText(/Nenhuma/)

    mocks.useVoyageOptions.mockReturnValue({ data: voyages })
    rerender(<VoyageCombobox required onSelect={onSelect} />)

    expect(await screen.findByText('NAVIO VERDE / 123N')).toBeTruthy()
  })

  it('pre-semeia o texto pelo selectedVoyageId', () => {
    const onSelect = vi.fn()

    render(<VoyageCombobox clearable selectedVoyageId={8} onSelect={onSelect} />)

    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('NAVIO AZUL / 456S')
  })

  it('preserva a digitacao ao invalidar uma selecao existente', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    function Harness() {
      const [selectedVoyageId, setSelectedVoyageId] = useState<number | null>(8)
      return (
        <VoyageCombobox
          clearable
          selectedVoyageId={selectedVoyageId}
          onSelect={(nextVoyageId) => {
            onSelect(nextVoyageId)
            setSelectedVoyageId(nextVoyageId)
          }}
        />
      )
    }

    render(<Harness />)

    const input = screen.getByRole('combobox') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'verde')

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('verde')
  })
})
